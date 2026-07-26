import { test, expect } from '@playwright/test';
import { login, createCase, createAndOpenCase, addCaseSession, expectToast } from './utils';

// المرحلة 3 من خطة تنفيذ اختبارات E2E المقسمة — القضايا (أطراف متعددة).
// ملحوظة: تست "إنشاء قضية بطرف واحد" و"إضافة جلسة جديدة" اتغطوا بالفعل
// في cases.spec.ts وsessions.spec.ts (مرحلة سابقة) — الملف ده بيغطي بس
// الحالات الناقصة حسب جدول المرحلة 3 في الخطة: تعدد الأطراف (المسمى
// القانوني)، دبل-كليك (إضافة وتعديل)، إضافة/حذف طرف في التعديل، وتبويب
// الجلسات (تعديل/حذف/تعارض تعديل/أوفلاين).

// ══════════════════════════════════════════════════════════════
//  NewCaseModal — تعدد الأطراف + دبل-كليك
// ══════════════════════════════════════════════════════════════

test('إنشاء قضية بأكتر من مدعي واحد — فاليديشن المسمى القانوني الجامع', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - قضية تعدد أطراف - ${Date.now()}`;

  await page.getByTestId('nav-cases').click();
  await page.getByTestId('new-case-button').click();
  await page.getByTestId('new-case-title').fill(caseTitle);

  // مدعي أول (موكلنا ⭐) + مدعي تاني (مش موكل، بلا رقم قومي مطلوب)
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-0-star').click();
  await page.getByTestId('new-case-plaintiff-0-name').fill('موكل اختبار E2E تعدد');
  await page.getByTestId('new-case-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-case-plaintiff-0-national-id').fill('12345678901235');
  await page.getByTestId('new-case-add-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-1-name').fill('وريث اختبار E2E');
  await page.getByTestId('new-case-plaintiff-1-capacity').fill('وريث');
  // مسك المسمى القانوني فاضي عمدًا — التست ده هيتأكد من رفض الحفظ
  await page.getByTestId('new-case-plaintiff-subform-save').click();

  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-case-defendant-0-name').fill('خصم اختبار E2E تعدد');
  await page.getByTestId('new-case-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-case-defendant-subform-save').click();

  // 1) محاولة حفظ من غير مسمى قانوني → رفض بتوست واضح، والمودال يفضل مفتوح
  await page.getByTestId('new-case-save').click();
  await expectToast(page, '⚠️ الطرف الأول (المدعي) فيه أكثر من شخص — لازم تكتب "المسمى القانوني" الجامع لهذا الطرف');
  await expect(page.getByTestId('new-case-save')).toBeVisible();
  await expect(page.getByTestId('case-card').filter({ hasText: caseTitle })).toHaveCount(0);

  // 2) نكتب المسمى القانوني ونحفظ تاني → ينجح
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-legal-title').fill('ورثة المرحوم اختبار E2E');
  await page.getByTestId('new-case-plaintiff-subform-save').click();
  await page.getByTestId('new-case-save').click();

  const newCaseCard = page.getByTestId('case-card').filter({ hasText: caseTitle });
  await expect(newCaseCard.first()).toBeVisible({ timeout: 15_000 });
});

test('ضغط زرار حفظ القضية الجديدة مرتين بسرعة (دبل-كليك) — قضية واحدة بس تتسجل', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - دبل كليك قضية - ${Date.now()}`;

  await page.getByTestId('nav-cases').click();
  await page.getByTestId('new-case-button').click();
  await page.getByTestId('new-case-title').fill(caseTitle);
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-0-star').click();
  await page.getByTestId('new-case-plaintiff-0-name').fill('موكل اختبار E2E دبل كليك');
  await page.getByTestId('new-case-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-case-plaintiff-0-national-id').fill(`3${Date.now()}`.slice(0, 14));
  await page.getByTestId('new-case-plaintiff-subform-save').click();
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-case-defendant-0-name').fill('خصم اختبار E2E دبل كليك');
  await page.getByTestId('new-case-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-case-defendant-subform-save').click();

  // نفس أسلوب تست الدبل-كليك في clients.spec.ts (مرحلة 1) — ضغطتين جوه
  // نفس الـtask عشان نحاكي السباق الفعلي بدل الاعتماد على توقيت Playwright.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="new-case-save"]') as HTMLButtonElement | null;
    btn?.click();
    btn?.click();
  });

  const newCaseCard = page.getByTestId('case-card').filter({ hasText: caseTitle });
  await expect(newCaseCard.first()).toBeVisible({ timeout: 15_000 });
  await expect(newCaseCard).toHaveCount(1);
});

// ══════════════════════════════════════════════════════════════
//  EditCaseModal — تعديل ناجح، إضافة/حذف طرف، دبل-كليك
// ══════════════════════════════════════════════════════════════

test('تعديل بيانات قضية موجودة بنجاح', async ({ page }) => {
  await login(page);
  const originalTitle = `اختبار E2E - قضية قبل التعديل - ${Date.now()}`;
  await createAndOpenCase(page, originalTitle);

  const newTitle = `اختبار E2E - قضية بعد التعديل - ${Date.now()}`;
  await page.getByTestId('edit-case-trigger').click();
  await page.getByTestId('edit-case-title').fill(newTitle);
  await page.getByTestId('edit-case-save').click();

  await expect(page.getByTestId('edit-case-title')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('case-detail-title')).toHaveText(newTitle);
});

test('إضافة طرف ثاني في التعديل (يوجب مسمى قانوني) ثم حذفه تاني', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - إضافة وحذف طرف - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('edit-case-trigger').click();

  // إضافة مدعى عليه تاني (فيه فحص الاسم الثلاثي لأنه مش موكل)
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('edit-case-add-defendant').click();
  await page.getByTestId('edit-case-defendant-1-name').fill('خصم ثاني اختبار E2E');
  await page.getByTestId('edit-case-defendant-1-capacity').fill('مدعى عليه ثاني');
  await page.getByTestId('edit-case-defendant-legal-title').fill('ورثة الخصم الأصلي');
  await page.getByTestId('edit-case-defendant-subform-save').click();
  await page.getByTestId('edit-case-save').click();

  await expect(page.getByTestId('edit-case-title')).not.toBeVisible({ timeout: 10_000 });

  // نرجع نفتح التعديل تاني، نتأكد إن الطرف الثاني اتحفظ، ونحذفه
  await page.getByTestId('edit-case-trigger').click();
  await page.getByTestId('party-side-card-defendant').click();
  await expect(page.getByTestId('edit-case-defendant-1-name')).toHaveValue('خصم ثاني اختبار E2E');
  await page.getByTestId('edit-case-defendant-1-remove').click();
  await page.getByTestId('edit-case-defendant-subform-save').click();
  await page.getByTestId('edit-case-save').click();

  await expect(page.getByTestId('edit-case-title')).not.toBeVisible({ timeout: 10_000 });
});

test('ضغط زرار حفظ التعديلات مرتين بسرعة (دبل-كليك) — بلا تعارض أو كراش', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - دبل كليك تعديل - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  const newTitle = `اختبار E2E - دبل كليك تعديل بعد - ${Date.now()}`;
  await page.getByTestId('edit-case-trigger').click();
  await page.getByTestId('edit-case-title').fill(newTitle);

  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="edit-case-save"]') as HTMLButtonElement | null;
    btn?.click();
    btn?.click();
  });

  await expect(page.getByTestId('edit-case-title')).not.toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('case-detail-title')).toHaveText(newTitle);
});

// ══════════════════════════════════════════════════════════════
//  CaseDetailView — تبويب الجلسات (تعديل/حذف/تعارض/أوفلاين)
//  ملحوظة: "إضافة جلسة" نفسها مغطاة بالفعل في sessions.spec.ts.
// ══════════════════════════════════════════════════════════════

// بنحسب يومين مختلفين في نفس الشهر الحالي (بلا تنقل بين الشهور في
// الـDatePicker — نفس قيد addCaseSession) عشان نتحكم في ترتيب الجلستين:
// case_sessions بترجع مرتبة تنازليًا بالتاريخ (session_date DESC)، فالجلسة
// بالتاريخ الأحدث بتبقى index 0 ("آخر جلسة" — زرار تحديث بس)، والتانية
// (الأقدم) بتاخد زراير تعديل/حذف اللي التست ده محتاجها.
function twoDaysInCurrentMonth(): { earlierDay: number; laterDay: number } {
  const today = new Date();
  const todayDay = today.getDate();
  const otherDay = todayDay === 1 ? 2 : todayDay - 1;
  return { earlierDay: Math.min(todayDay, otherDay), laterDay: Math.max(todayDay, otherDay) };
}

test('تعديل جلسة غير الأخيرة في تبويب الجلسات', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تعديل جلسة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  const { earlierDay, laterDay } = twoDaysInCurrentMonth();
  const targetDesc = `جلسة هدف التعديل - ${Date.now()}`;
  const latestDesc = `جلسة الأحدث - ${Date.now()}`;
  await addCaseSession(page, earlierDay, targetDesc);
  await addCaseSession(page, laterDay, latestDesc);

  const targetCard = page.getByTestId('session-card').filter({ hasText: targetDesc });
  await expect(targetCard.first()).toBeVisible();

  const newDescription = `جلسة بعد التعديل - ${Date.now()}`;
  await targetCard.first().getByTestId('session-edit-trigger').click();
  await page.getByTestId('session-edit-description').fill(newDescription);
  await page.getByTestId('session-edit-save').click();

  await expect(page.getByTestId('session-card').filter({ hasText: newDescription }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('session-card').filter({ hasText: targetDesc })).toHaveCount(0);
});

test('حذف جلسة غير الأخيرة في تبويب الجلسات', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - حذف جلسة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  const { earlierDay, laterDay } = twoDaysInCurrentMonth();
  const targetDesc = `جلسة هدف الحذف - ${Date.now()}`;
  const latestDesc = `جلسة الأحدث - ${Date.now()}`;
  await addCaseSession(page, earlierDay, targetDesc);
  await addCaseSession(page, laterDay, latestDesc);

  const targetCard = page.getByTestId('session-card').filter({ hasText: targetDesc });
  await expect(targetCard.first()).toBeVisible();
  await targetCard.first().getByTestId('session-delete-trigger').click();

  await page.getByTestId('confirm-delete-session-yes').click();
  await expect(page.getByTestId('session-card').filter({ hasText: targetDesc })).toHaveCount(0, { timeout: 15_000 });
  // الجلسة الأحدث لسه موجودة — التأكد إن الحذف كان دقيق (جلسة واحدة بس)
  await expect(page.getByTestId('session-card').filter({ hasText: latestDesc })).toHaveCount(1);
});

test('تحديث آخر جلسة (⚡) — إنشاء جلسة قادمة بنجاح', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تحديث جلسة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  const { earlierDay, laterDay } = twoDaysInCurrentMonth();
  const sessionDesc = `جلسة أولى للتحديث - ${Date.now()}`;
  // الجلسة الوحيدة الحالية بتاريخ laterDay — عشان تبقى index 0 (آخر جلسة)
  // فور إضافتها، ويظهر زرار "⚡ تحديث" عليها.
  await addCaseSession(page, laterDay, sessionDesc);

  const card = page.getByTestId('session-card').filter({ hasText: sessionDesc });
  await card.first().click();
  await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });

  const whatHappened = `تم سماع المرافعة - ${Date.now()}`;
  await page.getByTestId('session-update-what-happened').fill(whatHappened);

  // تاريخ الجلسة القادمة: أي يوم مختلف في نفس الشهر (مفيش داعي يكون
  // أحدث من laterDay — الجلسة القادمة مجرد صف جديد في case_sessions).
  await page.getByTestId('session-update-next-date-trigger').click();
  await page.getByTestId('session-update-next-date-day').filter({ hasText: new RegExp(`^${earlierDay}$`) }).click();

  await page.getByTestId('session-update-save').click();
  await expect(page.getByTestId('session-update-modal')).not.toBeVisible({ timeout: 15_000 });

  // جلستين دلوقتي: القديمة (بقت من غير زرار تحديث) + الجديدة القادمة
  await expect(page.getByTestId('session-card').filter({ hasText: sessionDesc }).first()).toBeVisible();
});

test('تعارض تعديل جلسة عند التحديث المتزامن من صفحتين (Optimistic Lock)', async ({ page, browser }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تعارض تعديل - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  const { earlierDay, laterDay } = twoDaysInCurrentMonth();
  const sessionDesc = `جلسة تعارض - ${Date.now()}`;
  await addCaseSession(page, laterDay, sessionDesc);

  // سياق/صفحة تانية تمامًا (نفس بيانات الدخول) بتفتح نفس القضية — عشان
  // تشوف نفس نسخة الجلسة (نفس updated_at الأصلي) اللي صفحة 1 هتغيّرها.
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  try {
    await login(page2);
    await page2.getByTestId('nav-cases').click();
    await page2.getByTestId('case-card').filter({ hasText: caseTitle }).first().click();
    await page2.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });

    const card1 = page.getByTestId('session-card').filter({ hasText: sessionDesc });
    const card2 = page2.getByTestId('session-card').filter({ hasText: sessionDesc });
    await expect(card1.first()).toBeVisible();
    await expect(card2.first()).toBeVisible();

    // صفحة 1: تفتح مودال "تحديث الجلسة" وتحفظ أول واحدة — بتنجح فعليًا
    // وتغيّر updated_at الحقيقي في قاعدة البيانات.
    await card1.first().click();
    await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('session-update-what-happened').fill('حدث من صفحة 1');
    await page.getByTestId('session-update-next-date-trigger').click();
    await page.getByTestId('session-update-next-date-day').filter({ hasText: new RegExp(`^${earlierDay}$`) }).click();
    await page.getByTestId('session-update-save').click();
    await expect(page.getByTestId('session-update-modal')).not.toBeVisible({ timeout: 15_000 });

    // صفحة 2: لسه معاها النسخة القديمة من الجلسة (قبل حفظ صفحة 1) في
    // الـstate المحلي — بتحاول تحدّث بنفس الجلسة، ولازم تاخد رسالة تعارض
    // واضحة بدل ما تكتب فوق تعديل صفحة 1 بصمت.
    await card2.first().click();
    await page2.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });
    await page2.getByTestId('session-update-what-happened').fill('حدث من صفحة 2 (المفروض يترفض)');
    await page2.getByTestId('session-update-next-date-trigger').click();
    await page2.getByTestId('session-update-next-date-day').filter({ hasText: new RegExp(`^${earlierDay}$`) }).click();
    await page2.getByTestId('session-update-save').click();

    await expectToast(page2, '⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة');
    // المودال لسه مفتوح عند صفحة 2 (الحفظ اتردّ، مفيش فقد بيانات)
    await expect(page2.getByTestId('session-update-save')).toBeVisible();
  } finally {
    await context2.close();
  }
});

test('حفظ جلسة جديدة أوفلاين في تبويب الجلسات', async ({ page, context }) => {
  await login(page);
  const caseTitle = `اختبار E2E - جلسة أوفلاين - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  const sessionDesc = `جلسة أوفلاين - ${Date.now()}`;
  await page.getByTestId('add-session-button').click();
  await page.getByTestId('session-date-trigger').click();
  const today = new Date().getDate().toString();
  await page.getByTestId('session-date-day').filter({ hasText: new RegExp(`^${today}$`) }).click();
  await page.getByTestId('session-description').fill(sessionDesc);

  await context.setOffline(true);
  try {
    await page.getByTestId('save-session-button').click();
    await expectToast(page, '📥 الجلسة محفوظة محلياً — ستُزامن عند عودة الإنترنت');
    await expect(page.getByTestId('session-description')).not.toBeVisible({ timeout: 10_000 });
  } finally {
    await context.setOffline(false);
  }
});
