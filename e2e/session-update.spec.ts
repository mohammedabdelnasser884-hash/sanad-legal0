import { test, expect } from '@playwright/test';
import { login, createStandaloneSession, expectToast } from './utils';

// المرحلة 7 (باقي Tier 2) — بند 3: SessionUpdateModal.tsx.
//
// ملحوظة مهمة: SessionUpdateModal.tsx كان أصلاً معمول عليه data-testid
// بالكامل (على عكس Notes/Docs)، والمسار الأساسي (تحديث جلسة قضية حقيقية
// + تعارض القفل التفاؤلي) مغطّى بالفعل في case-parties-and-sessions.spec.ts
// (تستات "تحديث آخر جلسة (⚡)" و"تعارض تعديل جلسة"). التستات هنا بتغطي
// بس الفجوات الحقيقية غير المغطاة قبل كده — نفس مبدأ تضييق النطاق
// المتفق عليه (24 يوليو): فرع كود حقيقي (isStandalone وlinkedClient في
// useCaseDetailActions السطور 61-101) يستاهل تغطية، مش تكرار لنفس آلية
// القفل التفاؤلي (كود مشترك اتغطى فعلاً).

// هيلبر محلي — فتح يوم معيّن في شبكة التقويم (نفس نمط openTodayInCalendar
// في standalone-sessions.spec.ts، بس بيقبل رقم يوم مش النهاردة بس).
async function openDayInCalendar(page: import('@playwright/test').Page, day: number) {
  await page.getByTestId('calendar-day').filter({ hasText: new RegExp(`^${day}$`) }).first().click();
}

// نفس هيلبر case-parties-and-sessions.spec.ts — يومين مختلفين في نفس
// الشهر الحالي بلا تنقل بين الشهور في الـDatePicker.
function twoDaysInCurrentMonth(): { earlierDay: number; laterDay: number } {
  const today = new Date();
  const todayDay = today.getDate();
  const otherDay = todayDay === 1 ? 2 : todayDay - 1;
  return { earlierDay: Math.min(todayDay, otherDay), laterDay: Math.max(todayDay, otherDay) };
}

test('فاليديشن: منع الحفظ من غير تاريخ الجلسة القادمة', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - فاليديشن تحديث - ${Date.now()}`;
  await createStandaloneSession(page, title);

  await page.getByTestId('calendar-day').filter({ hasText: new RegExp(`^${new Date().getDate()}$`) }).first().click();
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await card.first().click();
  await page.getByTestId('standalone-session-update-trigger').click();
  await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });

  // من غير ما نختار تاريخ الجلسة القادمة أصلاً
  await page.getByTestId('session-update-save').click();
  await expectToast(page, '⚠️ حدد تاريخ الجلسة القادمة');
  // المودال يفضل مفتوح — مفيش جلسة جديدة اتعملت
  await expect(page.getByTestId('session-update-modal')).toBeVisible();
});

test('تحديث جلسة مستقلة (بلا موكل مربوط) — الجلسة القادمة بترث العنوان والأطراف', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - تحديث مستقلة - ${Date.now()}`;
  await createStandaloneSession(page, title);
  // createStandaloneSession بتستخدم أسماء ثابتة للأطراف (راجع utils.ts):
  // 'موكل جلسة مستقلة E2E' / 'خصم جلسة مستقلة E2E' — بلا ربط موكل.

  const { earlierDay } = twoDaysInCurrentMonth();
  const today = new Date().getDate();

  await openDayInCalendar(page, today);
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await card.first().click();
  await page.getByTestId('standalone-session-update-trigger').click();
  await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByTestId('session-update-next-date-trigger').click();
  await page.getByTestId('session-update-next-date-day').filter({ hasText: new RegExp(`^${earlierDay}$`) }).click();
  await page.getByTestId('session-update-save').click();

  await expectToast(page, '✅ تم تحديث الجلسة وإنشاء الجلسة القادمة');
  // بعد الحفظ الناجح، شاشة تفاصيل الجلسة المستقلة بتقفل هي كمان (onDone
  // بيندي onClose الأب) — نرجع للتقويم مباشرة.
  await expect(page.getByTestId('standalone-session-detail-modal')).not.toBeVisible({ timeout: 10_000 });

  // الجلسة القادمة (يوم earlierDay) لازم تحمل نفس العنوان — دليل نسخ
  // بيانات الجلسة المستقلة (title/plaintiff/defendant) في الفرع
  // isStandalone بدل ما تتولد فاضية.
  await openDayInCalendar(page, earlierDay);
  const nextCard = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await expect(nextCard.first()).toBeVisible({ timeout: 10_000 });

  await nextCard.first().click();
  await expect(page.getByTestId('standalone-session-detail-modal')).toContainText('موكل جلسة مستقلة E2E');
  await expect(page.getByTestId('standalone-session-detail-modal')).toContainText('خصم جلسة مستقلة E2E');
});

test('تحديث جلسة مستقلة مربوطة بموكل — الجلسة القادمة بتاخد بيانات الموكل الحية مش نسخة الجلسة القديمة', async ({ page }) => {
  await login(page);
  const sessionTitle = `اختبار E2E - تحديث بموكل مربوط - ${Date.now()}`;
  const originalClientName = `موكل تحديث E2E ${Date.now()}`;
  const updatedClientName = `اسم موكل مختلف تمامًا بعد التعديل - ${Date.now()}`;
  const nationalId = `7${Date.now()}`.slice(0, 14);

  // 1) إنشاء جلسة مستقلة بطرف مدعي واحد (⭐)
  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-new-session-button').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-session-title').fill(sessionTitle);
  const todayIso = new Date().toISOString().slice(0, 10);
  await page.getByTestId('new-session-date').fill(todayIso);
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-session-plaintiff-0-star').click();
  await page.getByTestId('new-session-plaintiff-0-name').fill(originalClientName);
  await page.getByTestId('new-session-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-session-plaintiff-0-national-id').fill(nationalId);
  await page.getByTestId('new-session-plaintiff-subform-save').click();
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-session-defendant-0-name').fill('خصم موكل مربوط E2E');
  await page.getByTestId('new-session-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-session-defendant-subform-save').click();
  await page.getByTestId('new-session-save').click();

  // 2) من خطوة idle: "إضافة الموكل لقائمة الموكلين فقط" — دي بترتبط
  // فعليًا بـ case_sessions.client_id (راجع useClientLinking.ts —
  // handleAddClientOnlyForParty)، مش مجرد إضافة لقائمة الموكلين.
  const addButton = page.locator('[data-testid^="new-session-postsave-add-client-only"]').first();
  await addButton.click();
  await expect(page.getByText('تم بنجاح')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('new-session-postsave-done-close').click();

  // 3) نعدّل اسم الموكل من قائمة الموكلين — عشان نفرّق بين "نسخة الجلسة
  // القديمة" (لسه فيها الاسم الأصلي) و"الموكل الحي" (فيه الاسم الجديد).
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-clients').click();
  const clientCard = page.getByTestId('client-card').filter({ hasText: originalClientName });
  await clientCard.first().waitFor({ state: 'visible', timeout: 15_000 });
  await clientCard.first().click();
  await page.getByTestId('client-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('client-edit-trigger').click();
  await page.getByTestId('edit-client-name').fill(updatedClientName);
  await page.getByTestId('save-client-edit-button').click();
  await expect(page.getByTestId('save-client-edit-button')).not.toBeVisible({ timeout: 10_000 });

  // 4) نرجع للتقويم، نفتح الجلسة، ونستخدم "⚡ تحديث الجلسة"
  const { earlierDay } = twoDaysInCurrentMonth();
  const today = new Date().getDate();
  await openDayInCalendar(page, today);
  const sessionCard = page.getByTestId('calendar-session-card').filter({ hasText: sessionTitle });
  await sessionCard.first().click();
  await page.getByTestId('standalone-session-update-trigger').click();
  await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('session-update-next-date-trigger').click();
  await page.getByTestId('session-update-next-date-day').filter({ hasText: new RegExp(`^${earlierDay}$`) }).click();
  await page.getByTestId('session-update-save').click();
  await expectToast(page, '✅ تم تحديث الجلسة وإنشاء الجلسة القادمة');

  // 5) الجلسة القادمة لازم تحمل الاسم المُحدَّث للموكل (من linkedClient
  // الحي) مش الاسم الأصلي المخزّن في نسخة الجلسة القديمة.
  await openDayInCalendar(page, earlierDay);
  const nextCard = page.getByTestId('calendar-session-card').filter({ hasText: sessionTitle });
  await nextCard.first().waitFor({ state: 'visible', timeout: 10_000 });
  await nextCard.first().click();

  await expect(page.getByTestId('standalone-session-detail-modal')).toContainText(updatedClientName);
  await expect(page.getByTestId('standalone-session-detail-modal')).not.toContainText(originalClientName);
});
