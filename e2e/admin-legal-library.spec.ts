import { test, expect } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';
import { login, openAdminSection, expectToast } from './utils';

// المرحلة 6 (الأدمن) — دفعة 1 (أقل خطورة): المكتبة القانونية.
//
// ⚠️ تحديث (26 يوليو 2026): بعد تفعيل RLS على جدول laws بحيث الإضافة/
// التعديل/الحذف مقصورة على سوبر أدمن المنصة بس (is_super_admin())،
// والقراءة (SELECT) متاحة لأي مستخدم مسجّل دخول — راجع محادثة تشخيص
// اللوجز بتاريخ 26 يوليو. حساب E2E_TEST_EMAIL هو owner/admin لمكتب
// تجريبي عادي، مش سوبر أدمن على مستوى المنصة، فمن المتوقع إن أي محاولة
// إضافة/تعديل/حذف ترفض فعليًا — والتستات دي بقت بتتأكد من الرفض ده
// بدل ما تتأكد من نجاح كان بيحصل قبل تفعيل السياسة الجديدة.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner، وإلا
// nav-more-admin مش هيظهر أصلًا (نفس ملحوظة admin-archive-lifecycle.spec.ts).
//
// ⚠️ FIX: المشروع ESM ("type": "module") — __dirname مش موجود جاهز في
// ملفات .ts زي CommonJS، كان بيرمي ReferenceError ويكسر تشغيل كل E2E.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PDF = path.join(__dirname, 'fixtures', 'sample-law.pdf');

test('إضافة قانون جديد بحساب مكتب عادي (مش سوبر أدمن) → مرفوضة', async ({ page }) => {
  const title = `اختبار E2E قانون - ${Date.now()}`;

  await login(page);
  await openAdminSection(page, 'legal_library');

  await page.getByTestId('admin-law-new-button').click();
  await page.getByTestId('admin-law-title').fill(title);
  await page.getByTestId('admin-law-number').fill('999');
  await page.getByTestId('admin-law-year').fill('2026');
  await page.getByTestId('admin-law-file').setInputFiles(FIXTURE_PDF);
  await page.getByTestId('admin-law-submit').click();

  // RLS بترفض الـ INSERT لحساب مش سوبر أدمن — الرسالة العامة الموحّدة
  // اللي بتظهر لأي فشل رفع (راجع showErrorToast('legal_library_upload', ...)
  // في useAdminLegalLibrary.ts)، مش رسالة نجاح.
  await expectToast(page, '❌ تعذّر رفع الملف. تأكد من نوع وحجم الملف وحاول تاني. لو المشكلة استمرت، تواصل مع الدعم.');

  // القانون ميتضافش فعليًا في المكتبة
  await expect(page.getByTestId('admin-law-card').filter({ hasText: title })).toHaveCount(0);
});

test('تعديل/حذف قانون موجود بحساب مكتب عادي (مش سوبر أدمن) → مرفوضة', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'legal_library');

  // القراءة متاحة للكل، فلو فيه قانون واحد على الأقل (اتضاف قبل كده بحساب
  // سوبر أدمن) هيظهر هنا. لو المكتبة فاضية تمامًا (مفيش أي قانون اتضاف
  // لحد دلوقتي)، مفيش حاجة نتأكد من رفضها — بنتخطى التست بأمان بدل ما
  // نفشل على حاجة برة سيطرة الحساب العادي أصلًا.
  const firstCard = page.getByTestId('admin-law-card').first();
  const hasExistingLaw = await firstCard.isVisible().catch(() => false);
  test.skip(!hasExistingLaw, 'مفيش أي قانون موجود في المكتبة أصلًا لاختبار رفض التعديل/الحذف عليه');

  const originalTitle = (await firstCard.textContent()) || '';

  // محاولة تعديل — لازم ترفض
  await firstCard.getByTestId('admin-law-edit').click();
  await page.getByTestId('admin-law-title').fill(`محاولة تعديل من مكتب عادي - ${Date.now()}`);
  await page.getByTestId('admin-law-submit').click();
  await expectToast(page, '❌ تعذّر رفع الملف. تأكد من نوع وحجم الملف وحاول تاني. لو المشكلة استمرت، تواصل مع الدعم.');
  await expect(firstCard).toContainText(originalTitle.trim().slice(0, 20));

  // محاولة حذف — لازم ترفض والقانون يفضل موجود
  await firstCard.getByTestId('admin-law-delete').click();
  await page.getByTestId('admin-law-delete-input').fill(originalTitle.trim());
  await page.getByTestId('admin-law-delete-confirm').click();
  await expectToast(page, '❌ تعذّر حذف الملف. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.');
  await expect(page.getByTestId('admin-law-card').first()).toBeVisible();
});
