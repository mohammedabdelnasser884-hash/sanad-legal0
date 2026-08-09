import { test, expect } from '@playwright/test';
import { login, createStandaloneSession, expectToast } from './utils';

// المرحلة 2 من خطة تنفيذ اختبارات E2E المقسمة — الجلسة المستقلة
// (NewStandaloneSessionModal.tsx + StandaloneSessionDetailModal.tsx).
// كل تست بيبدأ بتسجيل دخول منفصل (فولباك نفس أسلوب باقي ملفات
// المرحلة 1) عشان التستات تفضل مستقلة عن بعض وترتيبها ميأثرش على نتيجتها.

// 🗑️ (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، المرحلة 5، 9 أغسطس
// 2026): 4 تستات اتحذفت بالكامل من الملف ده لأنها بتغطي واجهات اتشالت
// فعليًا في المراحل 1-3 (تاب "قضية موجودة"، زرار "إضافة الموكل لقائمة
// الموكلين فقط"، "🔗 ربط" بالكامل، دروب-داون الربط بموكل موجود) — الترقيم
// اتعاد بالكامل بعد الحذف عشان يفضل متسلسل من غير فجوات:
//   القديم 3 "ربط جلسة بقضية موجودة"                  → محذوف
//   القديم 4 "مودال تحويل لقضية؟"                       → الجديد 3
//   القديم 5 "إضافة الموكل لقائمة الموكلين فقط"         → محذوف
//   القديم 6 "حفظ الجلسة المستقلة أوفلاين"               → الجديد 4
//   القديم 7 "عرض تفاصيل جلسة مستقلة موجودة"            → الجديد 5
//   القديم 8 "تعديل جلسة مستقلة بنجاح"                  → الجديد 6
//   القديم 9 "ربط الجلسة بقضية جديدة من شاشة التفاصيل"  → محذوف
//   القديم 10 "ربط طرف من جلسة مستقلة بموكل موجود"      → محذوف

// هيلبر محلي — فتح اليوم بتاريخ النهاردة في شبكة التقويم (نفس نمط
// session-date-day في sessions.spec.ts)، بيفترض إن المستخدم واقف
// بالفعل في تبويب الجلسات (tab === 'calendar').
async function openTodayInCalendar(page: import('@playwright/test').Page) {
  const today = new Date().getDate().toString();
  await page.getByTestId('calendar-day').filter({ hasText: new RegExp(`^${today}$`) }).first().click();
}

test('1) إنشاء جلسة مستقلة بطرف واحد وظهورها', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - جلسة مستقلة 1 - ${Date.now()}`;
  await createStandaloneSession(page, title);

  await openTodayInCalendar(page);
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await expect(card.first()).toBeVisible({ timeout: 10_000 });
});

test('2) إنشاء جلسة مستقلة بأكتر من طرف — فاليديشن المسمى القانوني', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - جلسة مستقلة 2 - ${Date.now()}`;

  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-new-session-button').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-session-title').fill(title);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId('new-session-date').fill(today);

  // طرف مدعي واحد بس (⭐ موكلنا) — كافي لفاليديشن الحفظ العامة.
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-session-plaintiff-0-star').click();
  await page.getByTestId('new-session-plaintiff-0-name').fill('موكل اختبار E2E متعدد');
  await page.getByTestId('new-session-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-session-plaintiff-0-national-id').fill('11111111111111');
  await page.getByTestId('new-session-plaintiff-subform-save').click();

  // إضافة مدعى عليه تاني — من غير ما نملأ "المسمى القانوني" الجامع،
  // عشان نتأكد إن فاليديشن قاعدة 6 (إلزامية المسمى القانوني عند ≥٢
  // أشخاص) بتمنع الـsubform-save (الفورم الفرعي) من قفل الكارت بصمت —
  // العنصر بيفضل موجود على الشاشة (subform مقفلش) لحد ما نملأ الحقل.
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-session-defendant-0-name').fill('مدعى عليه أول E2E');
  await page.getByTestId('new-session-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-session-add-defendant').click();
  await page.getByTestId('new-session-defendant-1-name').fill('مدعى عليه ثاني E2E');
  await page.getByTestId('new-session-defendant-1-capacity').fill('مدعى عليه');

  // زرار الحفظ العام للجلسة لازم يفشل (توست تحذير) طول ما المسمى
  // القانوني الجامع لجهة المدعى عليهم فاضي.
  await page.getByTestId('new-session-defendant-subform-save').click();
  await page.getByTestId('new-session-save').click();
  // 🔄 casePartiesValidation.ts دلوقتي بيرجّع رسالة أدق لكل جهة بدل الرسالة
  // العامة القديمة (راجع validateParties → قاعدة 6).
  await expectToast(page, '⚠️ الطرف الثاني (المدعى عليه) فيه أكثر من شخص — لازم تكتب "المسمى القانوني" الجامع لهذا الطرف');

  // نرجع نملأ المسمى القانوني الجامع ونحفظ تاني — لازم ينجح دلوقتي.
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-session-defendant-legal-title').fill('ورثة المرحوم علي إبراهيم');
  await page.getByTestId('new-session-defendant-subform-save').click();
  await page.getByTestId('new-session-save').click();
  await page.getByTestId('new-session-postsave-idle-close').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'hidden', timeout: 10_000 });

  await openTodayInCalendar(page);
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await expect(card.first()).toBeVisible({ timeout: 10_000 });
});

// 🗑️ (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، المرحلة 5، 9 أغسطس
// 2026): تست "ربط جلسة بقضية موجودة بدل مستقلة" اتحذف بالكامل — تاب
// "قضية موجودة" (`linkMode`/`new-session-mode-existing`) اتشال من
// NewStandaloneSessionModal.tsx في المرحلة 1. مفيش بديل: الجلسة
// المستقلة النهاردة معندهاش وضع "existing" خالص، الإنشاء دايمًا standalone.

test('3) مودال "تحويل لقضية؟" — إنشاء قضية من بيانات الجلسة بعد الحفظ', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - جلسة تتحول لقضية - ${Date.now()}`;
  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-new-session-button').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-session-title').fill(title);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId('new-session-date').fill(today);
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-session-plaintiff-0-star').click();
  await page.getByTestId('new-session-plaintiff-0-name').fill(`اختبار E2E - موكل تحويل ${Date.now()}`);
  await page.getByTestId('new-session-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-session-plaintiff-0-national-id').fill(`3${Date.now()}`.slice(0, 14));
  await page.getByTestId('new-session-plaintiff-subform-save').click();
  // 🔒 FIX (نفس باج تست 4 تحت — usePartyFields.ts بيبدأ دايمًا بطرف مدعى-عليه
  // فاضي افتراضيًا حتى لو مالمسناهوش، وفاليديشن casePartiesValidation.ts
  // بترفض الحفظ لو اسمه فاضي. من غير الملء ده، new-session-save كان بيرجّع
  // توست تحذير بدل ما يفتح مودال "تحويل لقضية؟"، فـpostsave-create-case
  // كان بيفضل مستني 60 ثانية من غير ما يظهر أصلاً.
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-session-defendant-0-name').fill(`خصم تحويل E2E ${Date.now()}`);
  await page.getByTestId('new-session-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-session-defendant-subform-save').click();
  await page.getByTestId('new-session-save').click();

  // خطوة idle من مودال "تحويل لقضية؟" — الضغط على "إنشاء ملف قضية"
  // بيعمل INSERT مباشر (useClientLinking.handleLinkCase)، وبعدين بينتقل
  // لخطوة found/notfound (موكل مش موجود مسبقًا لأن الرقم القومي فريد
  // لكل تشغيل هنا) — بنكمل لحد "done".
  await page.getByTestId('new-session-postsave-create-case').click();
  // 🔒 FIX: زرار "إضافة الموكل وربطه بالقضية" بقى (خطة توحيد إنشاء الموكل،
  // Phase 2 — handleAddAndLinkClient في useClientLinking.ts) بيفتح
  // NewClientModal الموحّد بدل INSERT مباشر يوصّل لـ"تم بنجاح" على طول
  // (نفس نمط فتح NewClientModal الموحّد المستخدم في باقي مسارات إنشاء
  // الموكل بالملف ده). الاسم والرقم القومي بييجوا متعبيين تلقائيًا من
  // بيانات الطرف، لكن الهاتف لأ فلازم نتعباه يدوي قبل الحفظ.
  await page.getByTestId('new-session-postsave-add-and-link-notfound').click({ timeout: 10_000 });
  await page.getByTestId('new-client-name').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-client-phone').fill('01000000000');
  await page.getByTestId('save-client-button').click();
  await expect(page.getByTestId('new-client-name')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('تم بنجاح')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('new-session-postsave-done-close').click();

  // التأكد إن القضية اتعملت فعلًا وظهرت في تبويب القضايا.
  await page.getByTestId('nav-cases').click();
  const caseCard = page.getByTestId('case-card').filter({ hasText: title });
  await expect(caseCard.first()).toBeVisible({ timeout: 15_000 });
});

test('4) حفظ الجلسة المستقلة أوفلاين', async ({ page, context }) => {
  await login(page);
  const title = `اختبار E2E - جلسة أوفلاين - ${Date.now()}`;

  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-new-session-button').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-session-title').fill(title);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId('new-session-date').fill(today);
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-session-plaintiff-0-star').click();
  await page.getByTestId('new-session-plaintiff-0-name').fill('موكل أوفلاين E2E');
  await page.getByTestId('new-session-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-session-plaintiff-0-national-id').fill(`5${Date.now()}`.slice(0, 14));
  await page.getByTestId('new-session-plaintiff-subform-save').click();
  // ⚠️ FIX (تحليل لوجز E2E — 26 يوليو 2026): usePartyFields.ts بيبدأ
  // دايمًا بطرف مدعى-عليه فاضي افتراضيًا حتى لو التست ملوش قصد يضيفه —
  // وفاليديشن casePartiesValidation.ts بترفض الحفظ لو اسمه فاضي (نفس
  // قاعدة "اسم الطرف مطلوب" لأي طرف في الـarray). كان التست بيملى
  // المدعي بس، فبيقع دايمًا على توست "اسم الطرف مطلوب" بدل توست
  // الأوفلاين المتوقع. لازم نملى المدعى عليه برضو قبل الحفظ.
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-session-defendant-0-name').fill('خصم أوفلاين E2E');
  await page.getByTestId('new-session-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-session-defendant-subform-save').click();

  await context.setOffline(true);
  try {
    await page.getByTestId('new-session-save').click();
    await expectToast(page, '📥 الجلسة المستقلة محفوظة محلياً — ستُضاف فور عودة الإنترنت');
    // أونلاين وضع "standalone" بيفتح مودال "تحويل لقضية؟"، لكن أوفلاين
    // (offline && queued) بيقفل المودال فورًا (راجع handleSave) — بلا
    // فقد بيانات، الجلسة اتقيّدت في طابور الأوفلاين.
    await page.getByTestId('new-session-modal').waitFor({ state: 'hidden', timeout: 10_000 });
  } finally {
    await context.setOffline(false);
  }
});

test('5) عرض تفاصيل جلسة مستقلة موجودة', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - عرض تفاصيل - ${Date.now()}`;
  await createStandaloneSession(page, title);

  await openTodayInCalendar(page);
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await card.first().click();

  await expect(page.getByTestId('standalone-session-detail-modal')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('standalone-session-detail-modal')).toContainText(title);
  await page.getByTestId('standalone-session-footer-close').click();
  await expect(page.getByTestId('standalone-session-detail-modal')).not.toBeVisible();
});

test('6) تعديل جلسة مستقلة بنجاح', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - قبل التعديل - ${Date.now()}`;
  const newTitle = `اختبار E2E - بعد التعديل - ${Date.now()}`;
  await createStandaloneSession(page, title);

  await openTodayInCalendar(page);
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await card.first().click();
  await page.getByTestId('standalone-session-edit-trigger').click();

  await page.getByTestId('edit-standalone-session-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('edit-standalone-session-title').fill(newTitle);
  await page.getByTestId('edit-standalone-session-save').click();
  await page.getByTestId('edit-standalone-session-modal').waitFor({ state: 'hidden', timeout: 10_000 });

  // 🔒 FIX (تحليل لوجز E2E — 30 يوليو 2026): كان فيه دوسة تانية هنا على
  // openTodayInCalendar، بافتراض إن الأكورديون بيتقفل بعد الحفظ. ده كان
  // بيسبب فشل حقيقي: CalendarTab.tsx كان بيقفل selectedDay (accordion)
  // تلقائيًا مع أي refetch حتى لو السبب refreshKey بس (تعديل/ربط/حذف)،
  // مش تنقل شهر حقيقي — واتصلح (راجع تعليق useEffect في CalendarTab.tsx).
  // دلوقتي اليوم المفتوح بيفضل مفتوح بعد الحفظ، فالدوسة التانية كانت
  // هتقفله (toggle) بدل ما "تفتحه" زي ما التست كان مفترض. الكارت
  // المحدَّث المفروض يظهر مباشرة من غير حاجة لإعادة فتح اليوم.
  const updatedCard = page.getByTestId('calendar-session-card').filter({ hasText: newTitle });
  await expect(updatedCard.first()).toBeVisible({ timeout: 10_000 });
});
