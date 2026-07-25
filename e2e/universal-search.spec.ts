import { test, expect } from '@playwright/test';
import { login, createCase } from './utils';

// المرحلة 8 (Smoke) — UniversalSearchModal.tsx. الشاشة كانت من غير أي
// testid خالص. نطاق Smoke (زي ما الخطة حددت): تفتح، تعرض بيانات حقيقية،
// تتقفل من غير كسر — تست واحد بمسار واحد بلا تفرّع خطر.
//
// اخترنا نتيجة "قضية" تحديدًا (matchedCases) لأنها مُفلترة من الـprops
// المحمّلة أصلاً (cases) بشكل متزامن، عكس dbDocs/dbSessions/dbNotes اللي
// بتتطلب round-trip فعلي لقاعدة البيانات (debounce) — نتيجة أسرع وأثبت
// لتست smoke بسيط.
test('البحث الشامل: يفتح، يعرض نتيجة قضية حقيقية، ويتقفل من غير كسر', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - بحث شامل - ${Date.now()}`;
  await createCase(page, caseTitle);

  // فتح المودال من زرار البحث في الهيدر
  await page.getByTestId('header-search-open').click();
  await page.getByTestId('universal-search-modal').waitFor({ state: 'visible', timeout: 10_000 });

  // كتابة جزء من عنوان القضية (أكتر من الحد الأدنى لعدد الحروف)
  await page.getByTestId('universal-search-input').fill(caseTitle);

  // ظهور نتيجة القضية فعليًا (بيانات حقيقية، مش شكل فاضي)
  const result = page.getByTestId('universal-search-case-result').filter({ hasText: caseTitle });
  await result.first().waitFor({ state: 'visible', timeout: 10_000 });

  // إغلاق المودال من غير كسر — التأكد إن التطبيق رجع لحالته الطبيعية
  await page.getByTestId('universal-search-close').click();
  await page.getByTestId('universal-search-modal').waitFor({ state: 'hidden', timeout: 5_000 });
  await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 5_000 });
});
