import { test, expect } from '@playwright/test';
import { login, createReminder, expectToast } from './utils';

// المرحلة 7 (باقي Tier 2) — بند 4: EditReminderModal.tsx.
//
// قرار تضييق نطاق متعمد (نفس مبدأ بند 3 — SessionUpdateModal، 24 يوليو):
// الخطة الأصلية صنّفت البند على أساس "تعارض تعديل تذكير"، لكن آلية
// القفل التفاؤلي (safeUpdate + knownUpdatedAt) كود مشترك 100% مع
// الجلسات، ومغطّاة E2E فعلاً في case-parties-and-sessions.spec.ts
// ("تعارض تعديل جلسة عند التحديث المتزامن من صفحتين"). وفوق كده، منطق
// handleEdit نفسه (فاليديشن + نجاح + فشل + تعارض) مغطّى بالكامل على
// مستوى الـhook في useRemindersTab.test.ts (safeUpdate مموّه) — تكرار
// تست تعارض E2E هنا هيبقى تكرار لتغطية موجودة فعلاً، مش فرع كود جديد.
//
// الفجوة الحقيقية غير المغطاة خالص (لا unit ولا E2E): ميزة reminders
// كلها كانت من غير أي تستيد أو تغطية E2E قبل كده. التستات هنا بتغطي
// الوصلة الحقيقية غير المختبرة: فاليديشن على مستوى الواجهة (مش استدعاء
// الدالة مباشرة زي التست الوحدوي)، وربط زرار التعديل بالكارت → تعبئة
// المودال → الحفظ → تحديث الواجهة فعليًا بعد نجاح الحفظ.

test('فاليديشن: منع حفظ تعديل التذكير من غير تاريخ', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - فاليديشن تعديل تذكير - ${Date.now()}`;
  await createReminder(page, title);

  const card = page.locator('[data-testid^="reminder-card-"]').filter({ hasText: title });
  await card.first().locator('[data-testid^="reminder-edit-btn-"]').click();
  await page.getByTestId('reminder-edit-modal').waitFor({ state: 'visible', timeout: 10_000 });

  // مسح التاريخ (كان متعبى مسبقًا من بيانات التذكير الحالية)
  await page.getByTestId('reminder-edit-date-trigger').click();
  await page.getByTestId('reminder-edit-date-clear').click();

  await page.getByTestId('reminder-edit-save').click();
  await expectToast(page, 'يرجى إدخال العنوان والتاريخ');
  // المودال يفضل مفتوح — مفيش حفظ حصل
  await expect(page.getByTestId('reminder-edit-modal')).toBeVisible();
});

test('تعديل تذكير — الحفظ بينعكس فعليًا على الواجهة (عنوان وملاحظات جديدين)', async ({ page }) => {
  await login(page);
  const originalTitle = `اختبار E2E - تعديل تذكير أصلي - ${Date.now()}`;
  const updatedTitle = `اختبار E2E - تذكير بعد التعديل - ${Date.now()}`;
  const updatedNotes = `ملاحظة محدّثة - ${Date.now()}`;
  await createReminder(page, originalTitle);

  const card = page.locator('[data-testid^="reminder-card-"]').filter({ hasText: originalTitle });
  await card.first().locator('[data-testid^="reminder-edit-btn-"]').click();
  await page.getByTestId('reminder-edit-modal').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByTestId('reminder-edit-title').fill(updatedTitle);
  await page.getByTestId('reminder-edit-notes').fill(updatedNotes);
  // تاريخ المهمة بيفضل زي ما هو (اليوم) — التركيز هنا على وصلة
  // الحفظ↔تحديث الواجهة، مش على منطق due_date المختبر أصلاً بالـhook.
  await page.getByTestId('reminder-edit-save').click();

  await expectToast(page, '✅ تم تعديل المهمة');
  await expect(page.getByTestId('reminder-edit-modal')).not.toBeVisible({ timeout: 10_000 });

  // الكارت بالعنوان الجديد لازم يظهر، والقديم يختفي — دليل إن الحفظ
  // فعليًا اترسل واتقرا تاني من قاعدة البيانات (fetchReminders)، مش بس
  // نجاح توست شكلي.
  const updatedCard = page.locator('[data-testid^="reminder-card-"]').filter({ hasText: updatedTitle });
  await expect(updatedCard.first()).toBeVisible({ timeout: 10_000 });
  await expect(updatedCard.first()).toContainText(updatedNotes);
  await expect(page.locator('[data-testid^="reminder-card-"]').filter({ hasText: originalTitle })).toHaveCount(0);
});
