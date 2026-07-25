import { test, expect } from '@playwright/test';
import { login, openAdminSection, createTestUser, expectToast } from './utils';

// المرحلة 6 (الأدمن) — دفعة 3 (جزء 1): الأمان.
//
// نفس منهجية دفعة 2 (admin-users.spec.ts): كل تست بيعمل مستخدم تجريبي
// خاص بيه عبر createTestUser بدل ما يلمس حسابات حقيقية. "تسجيل خروج من
// جميع الأجهزة" و"قفل/فتح الحساب" الاتنين آمنين هنا بنفس منطق دفعة 2:
// المستخدم التجريبي لسه ما سجّلش دخول، فمفيش جلسة حقيقية بتتأثر —
// force_signout هيعدي بنجاح (مفيش جلسة يقفلها) وقفل/فتح الحساب عملية
// مباشرة على صف profiles بتاعه هو بس.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner.

test('بطاقة المستخدم التجريبي بتظهر في قسم الأمان بالأزرار التلاتة', async ({ page }) => {
  await login(page);
  const fullName = 'أمان اختبار ' + Date.now();
  await createTestUser(page, fullName);

  await openAdminSection(page, 'security');
  const card = page.getByTestId('admin-security-card').filter({ hasText: fullName });
  await expect(card.first()).toBeVisible({ timeout: 15_000 });
  await expect(card.first().getByTestId('admin-security-changepass')).toBeVisible();
  await expect(card.first().getByTestId('admin-security-signout')).toBeVisible();
  await expect(card.first().getByTestId('admin-security-lock-toggle')).toBeVisible();
});

test('قفل حساب المستخدم التجريبي ثم فتحه', async ({ page }) => {
  await login(page);
  const fullName = 'قفل اختبار ' + Date.now();
  await createTestUser(page, fullName);

  await openAdminSection(page, 'security');
  const card = page.getByTestId('admin-security-card').filter({ hasText: fullName });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  // قفل
  await card.first().getByTestId('admin-security-lock-toggle').click();
  await page.getByTestId('admin-security-lock-confirm').click();
  await expectToast(page, '🔒 تم قفل الحساب');
  await expect(card.first()).toContainText('مقفول');

  // فتح
  await card.first().getByTestId('admin-security-lock-toggle').click();
  await page.getByTestId('admin-security-lock-confirm').click();
  await expectToast(page, '🔓 تم فتح الحساب');
  await expect(card.first()).not.toContainText('مقفول');
});

test('إلغاء تأكيد القفل ما بيغيّرش حالة الحساب', async ({ page }) => {
  await login(page);
  const fullName = 'إلغاء قفل اختبار ' + Date.now();
  await createTestUser(page, fullName);

  await openAdminSection(page, 'security');
  const card = page.getByTestId('admin-security-card').filter({ hasText: fullName });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  await card.first().getByTestId('admin-security-lock-toggle').click();
  await page.getByTestId('admin-security-lock-cancel').click();
  await expect(card.first()).not.toContainText('مقفول');
});

test('تسجيل خروج من جميع الأجهزة لمستخدم تجريبي (بلا جلسة نشطة فعلاً)', async ({ page }) => {
  await login(page);
  const fullName = 'خروج اختبار ' + Date.now();
  await createTestUser(page, fullName);

  await openAdminSection(page, 'security');
  const card = page.getByTestId('admin-security-card').filter({ hasText: fullName });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  await card.first().getByTestId('admin-security-signout').click();
  await page.getByTestId('admin-security-signout-confirm').click();
  await expectToast(page, '✅ تم تسجيل خروج ' + fullName + ' من جميع الأجهزة');
});

test('زر تغيير كلمة المرور من قسم الأمان بيفتح المودال الصحيح', async ({ page }) => {
  await login(page);
  const fullName = 'باسورد اختبار ' + Date.now();
  await createTestUser(page, fullName);

  await openAdminSection(page, 'security');
  const card = page.getByTestId('admin-security-card').filter({ hasText: fullName });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  await card.first().getByTestId('admin-security-changepass').click();
  await expect(page.getByTestId('admin-changepass-new')).toBeVisible({ timeout: 5_000 });
});
