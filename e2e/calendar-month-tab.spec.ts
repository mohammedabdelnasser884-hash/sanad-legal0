import { test, expect } from '@playwright/test';
import { login, createAndOpenCase, addCaseSession } from './utils';

// المرحلة 8 (Smoke) — MonthListTab.tsx (تبويب "الشهر" في شاشة التقويم).
// الشاشة نفسها كانت من غير testid مباشر، لكنها بتفوّض العرض لـ
// MonthWeekView.tsx اللي بيستخدم SessionCard المشترك (عنده testid بالفعل
// `calendar-session-card` من عمل سابق). نطاق Smoke: مسار واحد — قضية فيها
// جلسة النهاردة، تبويب "الشهر" بيعرضها، الضغط عليها يفتح القضية.
test('تبويب الشهر: جلسة النهاردة تظهر في القائمة وفتحها يوصل لتفاصيل القضية', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تبويب الشهر - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);
  await addCaseSession(page, new Date().getDate(), 'جلسة اختبار E2E - تبويب الشهر');

  // الرجوع لشاشة التقويم والانتقال لتبويب "الشهر"
  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-subtab-month').click();

  const card = page.getByTestId('calendar-session-card').filter({ hasText: caseTitle });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
  await card.first().click();

  await page.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.getByTestId('case-detail-view')).toContainText(caseTitle);
});
