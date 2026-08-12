import { test, expect } from '@playwright/test';
import { login } from './utils';

// المرحلة 6 (الأدمن) — دفعة 1 (أقل خطورة): المكتبة القانونية.
//
// ⚠️ تحديث (12 أغسطس 2026): بعد إخفاء زرار "المكتبة القانونية" نفسه في
// AdminPanel.tsx (isSuperAdminUser && React.createElement('button', {...
// 'data-testid':'admin-section-legal_library' ...})) لغير سوبر أدمن
// المنصة، الزرار بقى مش موجود في الـ DOM خالص لحساب مكتب عادي — مش مجرد
// مخفي بـ CSS. التصميم القديم (قبل كده) كان يعتمد إن الزرار ظاهر لأي
// أدمن، والـ RLS في الداتابيز هي اللي بترفض الإضافة/التعديل فعليًا، فكان
// فيه تستين بيحاولوا يفتحوا القسم ويجربوا إضافة/تعديل/حذف قانون ويتأكدوا
// من رفض RLS. دلوقتي أي محاولة فتح للقسم أصلًا مستحيلة (مفيش زرار نضغط
// عليه)، فالتستين اتدمجوا في تست واحد بيتأكد من نقطة المنع الحقيقية
// الوحيدة اللي حساب عادي ممكن يوصلها: غياب الزرار نفسه.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner (وإلا
// nav-more-admin مش هيظهر أصلًا)، لكن مش سوبر أدمن على مستوى المنصة —
// نفس ملحوظة admin-archive-lifecycle.spec.ts.
test('زرار المكتبة القانونية مش ظاهر لحساب مكتب عادي (مش سوبر أدمن)', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-admin').click();

  // الزرار مش بيتعمله render أصلًا لغير سوبر أدمن (مش مجرد إخفاء بصري) —
  // toHaveCount(0) بتعبّر عن ده بالظبط، بدل toBeVisible() الشرطية.
  await expect(page.getByTestId('admin-section-legal_library')).toHaveCount(0);
});
