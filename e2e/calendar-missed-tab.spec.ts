import { test, expect } from '@playwright/test';
import { login, createAndOpenCase, addMissedSession } from './utils';

// المرحلة 8 (Smoke) — MissedTab.tsx. الشاشة كانت من غير أي testid على
// حالة الفراغ ولا كارت الجلسة الفائتة (عكس CalendarTab/SessionCard اللي
// كانوا متغطين بالفعل من عمل سابق). نطاق Smoke: مسار واحد — جلسة تاريخها
// فات بدون قرار (result/next_action)، بتظهر في تبويب "الفائتة"، والضغط
// عليها يفتح القضية المرتبطة.
//
// هيلبر addMissedSession (جديد في utils.ts) بيستخدم date-picker-prev-month
// (testid جديد على زرار التنقل في DatePicker.tsx المشترك) عشان يسجّل
// الجلسة بتاريخ الشهر السابق بنفس رقم اليوم — مضمون فوات التاريخ ومضمون
// وجود اليوم في أي شهر (Math.min مع 28).
test('تبويب الفائتة: جلسة بدون قرار تظهر وفتحها يوصل لتفاصيل القضية', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تبويب الفائتة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);
  await addMissedSession(page, 'جلسة اختبار E2E - فائتة');

  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-subtab-missed').click();

  const card = page.getByTestId('missed-session-card').filter({ hasText: caseTitle });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
  await card.first().click();

  await page.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.getByTestId('case-detail-view')).toContainText(caseTitle);
});
