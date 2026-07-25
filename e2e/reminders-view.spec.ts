import { test, expect } from '@playwright/test';
import { login, createReminder } from './utils';

// المرحلة 8 (Smoke) — AddReminderForm.tsx + ViewReminderModal.tsx. الفورم
// عنده testid بالفعل (أثر جانبي من مرحلة 7)، لكن كان محتاج تست Smoke
// مخصص بدل ما يفضل مغطّى ضمنيًا بس كخطوة تجهيز جوّه تست تاني. نفس نطاق
// Smoke: مسار واحد بلا تفرّع خطر — إنشاء تذكير → فتحه من القائمة → قفل العرض.
test('التذكيرات: إنشاء تذكير، فتحه من القائمة، وقفل العرض من غير كسر', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - تذكير - ${Date.now()}`;
  await createReminder(page, title);

  // فتح التذكير من الكارت في القائمة (الكارت نفسه هو زرار الفتح)
  const card = page.locator('[data-testid^="reminder-card-"]').filter({ hasText: title });
  await card.first().click();

  // مودال العرض يفتح ويعرض بيانات التذكير الحقيقية
  await page.getByTestId('view-reminder-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.getByTestId('view-reminder-modal')).toContainText(title);

  // قفل العرض من غير كسر — التأكد إن التطبيق رجع لحالته الطبيعية
  await page.getByTestId('view-reminder-close').click();
  await page.getByTestId('view-reminder-modal').waitFor({ state: 'hidden', timeout: 5_000 });
  await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 5_000 });
});
