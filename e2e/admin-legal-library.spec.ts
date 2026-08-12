import { test, expect } from '@playwright/test';
import { login } from './utils';

// المرحلة 6 (الأدمن) — دفعة 1 (أقل خطورة): المكتبة القانونية.
//
// ⚠️ تحديث (12 أغسطس 2026): "المكتبة القانونية" و"بوابة إدارة المكاتب"
// بقوا مقصورين بالكامل على حساب السوبر أدمن الوحيد (SUPER_ADMIN_EMAIL
// في AdminPanel.tsx) على مستوى الواجهة نفسها — الزرارين مش بيتعملهم
// render خالص لأي حساب تاني، مش مجرد معطّلين. حساب E2E_TEST_EMAIL هو
// owner/admin لمكتب تجريبي عادي (مش سوبر أدمن)، فالتستات دي بقت بتتأكد
// من إن القسمين دول مش ظاهرين له خالص في لوحة الإدارة، بدل ما تتأكد
// (زي قبل كده) من رفض الـRLS بعد فتحهم فعليًا — دلوقتي حساب زي ده أصلاً
// مش بيقدر يوصل لهم من الواجهة عشان يجرب.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner، وإلا
// nav-more-admin مش هيظهر أصلًا (نفس ملحوظة admin-archive-lifecycle.spec.ts).

test('حساب مكتب عادي (مش سوبر أدمن) → قسم "المكتبة القانونية" مش ظاهر في لوحة الإدارة', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-admin').click();

  await expect(page.getByTestId('admin-section-legal_library')).toHaveCount(0);
});

test('حساب مكتب عادي (مش سوبر أدمن) → "بوابة إدارة المكاتب" مش ظاهرة في لوحة الإدارة', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-admin').click();

  await expect(page.getByTestId('admin-offices-portal-link')).toHaveCount(0);
});
