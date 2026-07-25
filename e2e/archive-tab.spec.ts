import { test, expect } from '@playwright/test';
import { login } from './utils';

// المرحلة 8 (Smoke) — ArchiveTab.tsx (تبويب "الأرشيف الرقمي" في لوحة
// التحكم — مختلف عن DocsSection.tsx بتاع مستندات القضية المفردة، اللي
// متغطي بالفعل في docs.spec.ts). الشاشة كانت من غير أي testid خالص.
// نطاق Smoke: مسار واحد — رفع مستند غير مرتبط بقضية، ظهوره في القائمة،
// البحث عنه، ومسح البحث من غير كسر.
function makeArchiveTestFile(prefix: string, content: string) {
  return {
    name: `${prefix}-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from(content, 'utf-8'),
  };
}

test('الأرشيف الرقمي: رفع مستند، ظهوره في القائمة، والبحث عنه', async ({ page }) => {
  await login(page);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-documents').click();
  await page.getByTestId('archive-upload-toggle').click();
  await page.getByTestId('archive-file-input').setInputFiles(makeArchiveTestFile('archive', 'محتوى تجريبي لاختبار E2E - الأرشيف'));

  const label = `مستند اختبار E2E - أرشيف - ${Date.now()}`;
  await page.getByTestId('archive-doc-label-input').fill(label);
  await page.getByTestId('archive-upload-submit').click();

  const card = page.getByTestId('archive-doc-card').filter({ hasText: label });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  // البحث عن نفس المستند
  await page.getByTestId('archive-search-input').fill(label);
  await expect(page.getByTestId('archive-doc-card').filter({ hasText: label })).toHaveCount(1, { timeout: 10_000 });

  // مسح البحث من غير كسر
  await page.getByTestId('archive-search-input').fill('');
  await page.getByTestId('archive-search-input').waitFor({ state: 'visible' });
});
