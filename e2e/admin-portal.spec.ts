import { test, expect } from '@playwright/test';
import { login, openAdminSection, createClient, expectToast } from './utils';

// المرحلة 6 (الأدمن) — دفعة 3 (جزء 1): بوابة الموكل.
//
// نفس منهجية دفعة 2: كل تست بيعمل موكل تجريبي خاص بيه عبر createClient
// بدل ما يلمس موكلين حقيقيين. إعداد/تعديل بوابة موكل عملية معزولة
// بالكامل (RPC set_portal_pin على صف client_portal_pins بتاع الموكل
// التجريبي بس)، فمفيش خطورة في تغطيتها بالكامل زي دفعة المستخدمين.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner.

test('إعداد بوابة موكل تجريبي لأول مرة (تفعيل + PIN)', async ({ page }) => {
  await login(page);
  const name = 'بوابة اختبار ' + Date.now();
  await createClient(page, name);

  await openAdminSection(page, 'portal');
  await page.getByTestId('admin-portal-search').fill(name);
  const card = page.getByTestId('admin-portal-card').filter({ hasText: name });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  // أول مرة: الزرار نصه "إعداد" (لسه مفيش وصول)
  await expect(card.first().getByTestId('admin-portal-setup-button')).toHaveText('إعداد');
  await card.first().getByTestId('admin-portal-setup-button').click();

  await page.getByTestId('admin-portal-edit-genpin').click();
  await expect(page.getByTestId('admin-portal-edit-pin')).not.toHaveValue('');
  await page.getByTestId('admin-portal-edit-save').click();

  await expectToast(page, '✅ تم حفظ إعدادات بوابة ' + name);
  await expect(card.first()).toContainText('✓ مفعّل');
});

test('تعديل بوابة موكل تجريبي بعد إعدادها: تعطيل الوصول', async ({ page }) => {
  await login(page);
  const name = 'تعطيل بوابة اختبار ' + Date.now();
  await createClient(page, name);

  await openAdminSection(page, 'portal');
  await page.getByTestId('admin-portal-search').fill(name);
  const card = page.getByTestId('admin-portal-card').filter({ hasText: name });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  // إعداد أولي
  await card.first().getByTestId('admin-portal-setup-button').click();
  await page.getByTestId('admin-portal-edit-genpin').click();
  await page.getByTestId('admin-portal-edit-save').click();
  await expectToast(page, '✅ تم حفظ إعدادات بوابة ' + name);
  await expect(card.first()).toContainText('✓ مفعّل');

  // تعديل: الزرار بقى نصه "تعديل"، وتعطيل الحالة
  await expect(card.first().getByTestId('admin-portal-setup-button')).toHaveText('تعديل');
  await card.first().getByTestId('admin-portal-setup-button').click();
  await page.getByTestId('admin-portal-edit-active-toggle').click();
  await page.getByTestId('admin-portal-edit-genpin').click(); // PIN مطلوب دايمًا عشان زرار الحفظ يتفعّل
  await page.getByTestId('admin-portal-edit-save').click();

  await expectToast(page, '✅ تم حفظ إعدادات بوابة ' + name);
  await expect(card.first()).toContainText('✗ معطّل');
});

test('إضافة وصول جديد من هيدر القسم (AddPortalUserModal) لموكل تجريبي', async ({ page }) => {
  await login(page);
  const name = 'وصول جديد اختبار ' + Date.now();
  await createClient(page, name);

  await openAdminSection(page, 'portal');
  await page.getByTestId('admin-portal-new-button').click();

  await page.getByTestId('admin-portal-add-search').fill(name);
  const option = page.getByTestId('admin-portal-add-client-option').filter({ hasText: name });
  await option.first().waitFor({ state: 'visible', timeout: 10_000 });
  await option.first().click();

  await page.getByTestId('admin-portal-add-genpin').click();
  await expect(page.getByTestId('admin-portal-add-pin')).not.toHaveValue('');
  await page.getByTestId('admin-portal-add-submit').click();

  await expectToast(page, '✅ تم حفظ إعدادات بوابة ' + name);
  await page.getByTestId('admin-portal-search').fill(name);
  const card = page.getByTestId('admin-portal-card').filter({ hasText: name });
  await expect(card.first()).toContainText('✓ مفعّل', { timeout: 10_000 });
});

test('إغلاق مودال تعديل بوابة الموكل من غير حفظ', async ({ page }) => {
  await login(page);
  const name = 'إغلاق بوابة اختبار ' + Date.now();
  await createClient(page, name);

  await openAdminSection(page, 'portal');
  await page.getByTestId('admin-portal-search').fill(name);
  const card = page.getByTestId('admin-portal-card').filter({ hasText: name });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  await card.first().getByTestId('admin-portal-setup-button').click();
  await page.getByTestId('admin-portal-edit-close').click();
  await expect(page.getByTestId('admin-portal-edit-pin')).toHaveCount(0);
  // ما اتحفظش أي حاجة، فالموكل لسه من غير وصول
  await expect(card.first()).toContainText('لا يوجد وصول');
});
