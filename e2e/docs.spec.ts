import { test, expect } from '@playwright/test';
import { login, createAndOpenCase, expectToast } from './utils';

// المرحلة 7 (باقي Tier 2) — بند 2: DocsSection.tsx (تبويب "المستندات" جوّه
// تفاصيل القضية). التستات دي بتغطي: رفع مستند ناجح، إلغاء الرفع قبل
// الحفظ، منع الرفع فعليًا وقت انقطاع الاتصال (قرار عمل محسوم — راجع
// useCaseDocuments.ts، نفس فلسفة قرار case_fees/fee_payments: خطوة
// شبكية ماديًا مش ممكن تتقيّد في طابور offline)، البحث في المستندات،
// وحذف مستند (إلغاء التأكيد + تنفيذ فعلي).

function makeTestFile(prefix: string, content: string) {
  return {
    name: `${prefix}-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(content, 'utf-8'),
  };
}

test('رفع مستند جديد وظهوره في القائمة', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - رفع مستند - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-docs').click();
  await expect(page.getByTestId('docs-empty')).toBeVisible();

  await page.getByTestId('doc-upload-toggle').click();
  await page.getByTestId('doc-file-input').setInputFiles(makeTestFile('upload', 'محتوى تجريبي لاختبار E2E'));

  const label = `مستند اختبار E2E - ${Date.now()}`;
  await page.getByTestId('doc-label-input').fill(label);
  await page.getByTestId('doc-upload-submit').click();

  await expectToast(page, '✅ تم رفع المستند بنجاح');
  await expect(page.getByTestId('doc-card').filter({ hasText: label })).toHaveCount(1, { timeout: 15_000 });
});

test('إلغاء رفع مستند قبل الحفظ', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - إلغاء رفع مستند - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-docs').click();
  await page.getByTestId('doc-upload-toggle').click();
  await page.getByTestId('doc-file-input').setInputFiles(makeTestFile('cancelled', 'لن يُرفع'));
  await page.getByTestId('doc-form-cancel').click();

  await expect(page.getByTestId('doc-label-input')).toHaveCount(0);
  await expect(page.getByTestId('docs-empty')).toBeVisible();
});

test('منع رفع مستند فعليًا وقت انقطاع الاتصال', async ({ page, context }) => {
  await login(page);
  const caseTitle = `اختبار E2E - رفع أوفلاين - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-docs').click();
  await page.getByTestId('doc-upload-toggle').click();
  await page.getByTestId('doc-file-input').setInputFiles(makeTestFile('offline', 'لن يُرفع أوفلاين'));
  await page.getByTestId('doc-label-input').fill('مستند أوفلاين');

  await context.setOffline(true);
  try {
    await page.getByTestId('doc-upload-submit').click();
    await expectToast(page, '⚠️ رفع مستند يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال');
    // النموذج لسه مفتوح ومفيش مستند اتضاف فعليًا — القرار كان منع صريح
    // مش تقييد في طابور (راجع تعليق useCaseDocuments.ts).
    await expect(page.getByTestId('doc-label-input')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});

test('بحث في مستندات القضية', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - بحث مستندات - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-docs').click();
  const label = `مستند بحث فريد - ${Date.now()}`;
  await page.getByTestId('doc-upload-toggle').click();
  await page.getByTestId('doc-file-input').setInputFiles(makeTestFile('search', 'نص للبحث'));
  await page.getByTestId('doc-label-input').fill(label);
  await page.getByTestId('doc-upload-submit').click();
  await expectToast(page, '✅ تم رفع المستند بنجاح');
  await page.getByTestId('doc-card').filter({ hasText: label }).first().waitFor({ state: 'visible', timeout: 15_000 });

  await page.getByTestId('doc-search-input').fill('نص بحث غير موجود إطلاقًا');
  await expect(page.getByTestId('doc-card')).toHaveCount(0);

  await page.getByTestId('doc-search-clear').click();
  await expect(page.getByTestId('doc-card').filter({ hasText: label })).toHaveCount(1);
});

test('حذف مستند: إلغاء التأكيد يسيبه، والتأكيد يحذفه فعليًا', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - حذف مستند - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-docs').click();
  const label = `مستند للحذف - ${Date.now()}`;
  await page.getByTestId('doc-upload-toggle').click();
  await page.getByTestId('doc-file-input').setInputFiles(makeTestFile('delete', 'نص للحذف'));
  await page.getByTestId('doc-label-input').fill(label);
  await page.getByTestId('doc-upload-submit').click();
  await expectToast(page, '✅ تم رفع المستند بنجاح');

  const card = page.getByTestId('doc-card').filter({ hasText: label });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  // إلغاء التأكيد — المستند يفضل موجود
  await card.first().getByTestId('doc-delete-trigger').click();
  await page.getByTestId('doc-delete-cancel').click();
  await expect(page.getByTestId('doc-card').filter({ hasText: label })).toHaveCount(1);

  // تأكيد الحذف الفعلي
  await card.first().getByTestId('doc-delete-trigger').click();
  await page.getByTestId('doc-delete-confirm').click();
  await expectToast(page, '🗑 تم حذف المستند');
  await expect(page.getByTestId('doc-card').filter({ hasText: label })).toHaveCount(0, { timeout: 10_000 });
});
