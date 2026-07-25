import { test, expect } from '@playwright/test';
import { login, openAdminSection, createTestUser, expectToast } from './utils';

// المرحلة 6 (الأدمن) — دفعة 2: المستخدمون.
// كل تست بينشئ مستخدم تجريبي (disposable) خاص بيه عبر createTestUser
// بدل ما يشتغل على حساب حقيقي في القاعدة — ده بيسمح لنا نغطي عمليات
// حساسة زي "حذف نهائي" و"تعطيل الحساب" (اللي بيستدعي force_signout فعليًا)
// من غير أي خطر على حسابات المستخدمين الحقيقيين في بيئة التست.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner (نفس ملحوظة
//    admin-archive-lifecycle.spec.ts وباقي تستات الأدمن).
// ⚠️ التست ده بينشئ حسابات Auth حقيقية عبر create_lawyer Edge Function
//    وميحذفهاش من auth.users (handleDeleteUser بيحذف صف profiles بس —
//    نفس السلوك الحالي في الكود، مش حاجة التستات دي بتغيّرها). لو
//    بيئة التست حساسة لعدد حسابات Auth المتراكمة، يفضّل تنضيف دوري يدوي.

test('إضافة مستخدم جديد وظهوره في قائمة المستخدمين', async ({ page }) => {
  const fullName = `اختبار E2E مستخدم - ${Date.now()}`;

  await login(page);
  const { email } = await createTestUser(page, fullName, { role: 'lawyer' });

  await expectToast(page, '✅ تم إنشاء حساب ' + fullName);

  const card = page.getByTestId('admin-user-card').filter({ hasText: fullName });
  await expect(card).toHaveCount(1);
  await expect(card.first()).toContainText(email);
});

test('تعديل مستخدم: تغيير الاسم والدور والصلاحيات عبر مودال التعديل', async ({ page }) => {
  const fullName = `اختبار E2E تعديل - ${Date.now()}`;
  const editedName = `${fullName} (معدّل)`;

  await login(page);
  await createTestUser(page, fullName, { role: 'viewer' });
  await expectToast(page, '✅ تم إنشاء حساب ' + fullName);

  const card = page.getByTestId('admin-user-card').filter({ hasText: fullName });
  await card.first().getByTestId('admin-user-edit').click();

  await page.getByTestId('admin-edituser-full_name').fill(editedName);
  await page.getByTestId('admin-edituser-role-lawyer').click();
  // بعد التبديل لدور "محامي" الصلاحيات بترجع فاضية (نفس منطق EditUserModal.tsx:
  // onClick الدور بيعمل reset لـ permissions) — نفعّل صلاحية واحدة يدويًا
  // للتأكد إن حفظ الصلاحيات فعليًا بيوصل لقاعدة البيانات.
  const permissionKeys = await page.locator('[data-testid^="admin-edituser-permission-"]').all();
  expect(permissionKeys.length).toBeGreaterThan(0);
  await permissionKeys[0].click();

  await page.getByTestId('admin-edituser-save').click();
  await expectToast(page, '✅ تم تحديث بيانات المستخدم');

  const updatedCard = page.getByTestId('admin-user-card').filter({ hasText: editedName });
  await expect(updatedCard).toHaveCount(1, { timeout: 10_000 });
  await expect(updatedCard.first()).toContainText('محامي');
});

test('تعطيل وتفعيل مستخدم من القائمة (زر التبديل السريع)', async ({ page }) => {
  const fullName = `اختبار E2E تعطيل - ${Date.now()}`;

  await login(page);
  await createTestUser(page, fullName, { role: 'lawyer' });
  await expectToast(page, '✅ تم إنشاء حساب ' + fullName);

  const card = page.getByTestId('admin-user-card').filter({ hasText: fullName });
  await card.first().getByTestId('admin-user-toggle-active').click();

  // toggleUserActive بيحاول ينهي جلسات المستخدم كمان (force_signout) —
  // المستخدم التجريبي ده لسه ما سجّلش دخول خالص فمفيش جلسة تتنهي، فالرسالة
  // المتوقعة هي رسالة النجاح الكاملة مش رسالة "تعذر إنهاء الجلسات".
  await expectToast(page, '⚠️ تم تعطيل الحساب وإنهاء جلساته');
  await expect(card.first()).toContainText('معطّل');

  await card.first().getByTestId('admin-user-toggle-active').click();
  await expectToast(page, '✅ تم تفعيل الحساب');
  await expect(card.first()).not.toContainText('معطّل');
});

test('تغيير كلمة مرور مستخدم عبر مودال الأمان', async ({ page }) => {
  const fullName = `اختبار E2E كلمة مرور - ${Date.now()}`;

  await login(page);
  await createTestUser(page, fullName, { role: 'lawyer' });
  await expectToast(page, '✅ تم إنشاء حساب ' + fullName);

  const card = page.getByTestId('admin-user-card').filter({ hasText: fullName });
  await card.first().getByTestId('admin-user-change-password').click();

  await page.getByTestId('admin-changepass-new').fill('NewTestPass123');
  await page.getByTestId('admin-changepass-confirm').fill('NewTestPass123');
  await page.getByTestId('admin-changepass-save').click();

  await expectToast(page, '✅ تم تحديث كلمة المرور بنجاح');
  // المودال المفروض يقفل بعد النجاح (setChangePassUser(null) في useAdminUsers.ts)
  await expect(page.getByTestId('admin-changepass-save')).not.toBeVisible({ timeout: 10_000 });
});

test('حذف مستخدم نهائيًا: يختفي من قائمة المستخدمين', async ({ page }) => {
  const fullName = `اختبار E2E حذف - ${Date.now()}`;

  await login(page);
  await createTestUser(page, fullName, { role: 'lawyer' });
  await expectToast(page, '✅ تم إنشاء حساب ' + fullName);

  const card = page.getByTestId('admin-user-card').filter({ hasText: fullName });
  await card.first().getByTestId('admin-user-delete').click();

  // لازم كتابة اسم المستخدم بالظبط عشان يتفعّل زرار التأكيد (isMatch في DeleteConfirmModal)
  await page.getByTestId('admin-user-delete-input').fill(fullName);
  await page.getByTestId('admin-user-delete-confirm').click();

  await expectToast(page, '✅ تم حذف المستخدم');
  await expect(page.getByTestId('admin-user-card').filter({ hasText: fullName })).toHaveCount(0, { timeout: 10_000 });
});
