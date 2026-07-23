import { test, expect } from '@playwright/test';
import { login } from './utils';

// خطوة 2 من مرحلة 7 (E2E) — فتح/إنشاء قضية.
// زي ما اتقرر في التقرير: بيانات القضية (العنوان) اللي بنكتبها إحنا في
// التست نفسه مش نص واجهة ثابت — فمفيش مشكلة إننا نلاقيها بالنص، لأن
// التست هو مصدر النص ده مش الواجهة. العناصر التفاعلية (الزراير/الحقول)
// بتتلاقى بـ data-testid زي خطوة 1 بالظبط.

test('إنشاء قضية جديدة والتأكد من ظهورها في القايمة وإمكانية فتحها', async ({ page }) => {
  await login(page);

  // عنوان فريد لكل تشغيل، عشان نقدر نميّز القضية دي عن أي قضايا
  // تانية موجودة في التينانت التجريبي من تشغيلات سابقة.
  const caseTitle = `اختبار E2E - قضية ${Date.now()}`;

  // 1) الانتقال لتبويب القضايا
  await page.getByTestId('nav-cases').click();

  // 2) فتح مودال "تقييد قضية" وملء العنوان + أطراف الدعوى (بقوا إلزاميين)
  // — راجع خطة تعدد الأطراف (مرحلة 4): طرف مدعي واحد عليه ⭐ "موكلنا"
  // بدل حقل "الموكل" المفرد القديم.
  await page.getByTestId('new-case-button').click();
  await page.getByTestId('new-case-title').fill(caseTitle);
  // ⚡ CHANGED (خطة "تطوير أطراف الدعوى" — مرحلة 4، 23 يوليو 2026): حقول
  // كل طرف بقت جوه نموذج فرعي (PartySubform) بيتفتح من كارت مطوي، مش
  // ظاهرة مفتوحة دايمًا زي الشكل القديم.
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-0-star').click();
  await page.getByTestId('new-case-plaintiff-0-name').fill('موكل اختبار E2E');
  await page.getByTestId('new-case-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-case-plaintiff-0-national-id').fill('12345678901234');
  await page.getByTestId('new-case-plaintiff-subform-save').click();
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-case-defendant-0-name').fill('خصم اختبار E2E');
  await page.getByTestId('new-case-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-case-defendant-subform-save').click();
  await page.getByTestId('new-case-save').click();

  // 3) بعد الحفظ الناجح، useCaseActions بيقفل المودال ويعمل fetchCases
  // تاني — يعني لازم نلاقي القضية الجديدة في القايمة (أول عنصر غالبًا).
  const newCaseCard = page.getByTestId('case-card').filter({ hasText: caseTitle });
  await expect(newCaseCard.first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('new-case-title')).not.toBeVisible();

  // 4) فتح القضية اللي اتسجلت والتأكد إن دي فعلاً هي (مش قضية تانية)
  await newCaseCard.first().click();
  await expect(page.getByTestId('case-detail-view')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('case-detail-title')).toHaveText(caseTitle);

  // 5) الرجوع لقايمة القضايا — تأكيد إن الملاحة اتقفلت صح
  await page.getByTestId('case-detail-close').click();
  await expect(page.getByTestId('case-detail-view')).not.toBeVisible();
});
