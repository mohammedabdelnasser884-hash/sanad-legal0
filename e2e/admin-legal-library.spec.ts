import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { login, openAdminSection, expectToast } from './utils';

// المرحلة 6 (الأدمن) — دفعة 1 (أقل خطورة): المكتبة القانونية.
// بيغطي: إضافة قانون جديد (برفع PDF فعلي)، تعديل بياناته، وحذفه نهائيًا —
// نفس تدفق useAdminLegalLibrary.ts (handleSaveLaw/handleDeleteLaw) اللي
// unit tests (useAdminLegalLibrary.test.ts) بتتأكد من منطقه بس، مش من
// إن الزرار الحقيقي في الواجهة بيوصل له فعليًا.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner، وإلا
// nav-more-admin مش هيظهر أصلًا (نفس ملحوظة admin-archive-lifecycle.spec.ts).
//
// ⚠️ FIX: المشروع ESM ("type": "module") — __dirname مش موجود جاهز في
// ملفات .ts زي CommonJS، كان بيرمي ReferenceError ويكسر تشغيل كل E2E.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'sample-law.pdf');

test('إضافة قانون جديد للمكتبة القانونية برفع ملف PDF', async ({ page }) => {
  const title = `اختبار E2E قانون - ${Date.now()}`;

  await login(page);
  await openAdminSection(page, 'legal_library');

  await page.getByTestId('admin-law-new-button').click();
  await page.getByTestId('admin-law-title').fill(title);
  await page.getByTestId('admin-law-number').fill('999');
  await page.getByTestId('admin-law-year').fill('2026');
  await page.getByTestId('admin-law-file').setInputFiles(FIXTURE_PDF);
  await page.getByTestId('admin-law-submit').click();

  await expectToast(page, '✅ تم إضافة القانون — جاهز للمعالجة');

  const card = page.getByTestId('admin-law-card').filter({ hasText: title });
  await expect(card).toHaveCount(1, { timeout: 10_000 });
});

test('تعديل قانون موجود: تغيير الاسم يظهر فورًا في البطاقة', async ({ page }) => {
  const title = `اختبار E2E قانون تعديل - ${Date.now()}`;
  const editedTitle = `${title} (معدّل)`;

  await login(page);
  await openAdminSection(page, 'legal_library');

  await page.getByTestId('admin-law-new-button').click();
  await page.getByTestId('admin-law-title').fill(title);
  await page.getByTestId('admin-law-file').setInputFiles(FIXTURE_PDF);
  await page.getByTestId('admin-law-submit').click();
  await expectToast(page, '✅ تم إضافة القانون — جاهز للمعالجة');

  const card = page.getByTestId('admin-law-card').filter({ hasText: title });
  await card.first().waitFor({ state: 'visible', timeout: 10_000 });

  await card.getByTestId('admin-law-edit').click();
  await page.getByTestId('admin-law-title').fill(editedTitle);
  await page.getByTestId('admin-law-submit').click();
  await expectToast(page, '✅ تم حفظ التعديلات');

  await expect(page.getByTestId('admin-law-card').filter({ hasText: editedTitle })).toHaveCount(1, { timeout: 10_000 });
});

test('حذف قانون نهائيًا: يختفي من المكتبة القانونية', async ({ page }) => {
  const title = `اختبار E2E قانون حذف - ${Date.now()}`;

  await login(page);
  await openAdminSection(page, 'legal_library');

  await page.getByTestId('admin-law-new-button').click();
  await page.getByTestId('admin-law-title').fill(title);
  await page.getByTestId('admin-law-file').setInputFiles(FIXTURE_PDF);
  await page.getByTestId('admin-law-submit').click();
  await expectToast(page, '✅ تم إضافة القانون — جاهز للمعالجة');

  const card = page.getByTestId('admin-law-card').filter({ hasText: title });
  await card.first().waitFor({ state: 'visible', timeout: 10_000 });

  await card.getByTestId('admin-law-delete').click();
  // لازم كتابة اسم القانون بالظبط عشان يتفعّل زرار التأكيد (isMatch في DeleteConfirmModal)
  await page.getByTestId('admin-law-delete-input').fill(title);
  await page.getByTestId('admin-law-delete-confirm').click();

  await expect(page.getByTestId('admin-law-card').filter({ hasText: title })).toHaveCount(0, { timeout: 10_000 });
});
