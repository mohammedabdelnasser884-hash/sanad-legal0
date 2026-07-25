import { test, expect } from '@playwright/test';
import { login, openAdminSection, expectToast } from './utils';

// المرحلة 6 (الأدمن) — دفعة 3، جزء 2: النسخ الاحتياطي.
//
// ⚠️ فرق جوهري عن كل تستات الأدمن اللي فاتت: مفيش هنا عملية معزولة على
// صف تجريبي واحد. "إنشاء نسخة" بيصدّر كل جداول المكتب الحالي كما هي،
// و"استعادة" بتحذف بيانات المكتب الحالية بالكامل وتستبدلها بمحتوى نسخة
// معيّنة — عملية حقيقية بلا تراجع. فالتستات دي بتغطي الجزء الآمن فقط
// (إنشاء، ظهور في القائمة، تنزيل، فتح مودال الاستعادة، فاليديشن حقل
// التأكيد، وإلغاء المودال من غير أي تنفيذ) ومفيش فيها ولا تست واحد
// بيدوس زرار "استعادة الآن" الفعلي — التنفيذ الحقيقي محتاج قرار مسبق
// إزاي نحميه من مسح بيانات تست تانية على نفس الحساب (شايفينه في تقرير
// دفعة 3 جزء 1، قسم "الخطوة الجاية").
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner.

test('إنشاء نسخة احتياطية جديدة وظهورها في القائمة كأحدث نسخة', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'backup');

  await page.getByTestId('admin-backup-create-button').click();
  await expectToast(page, '✅ تم إنشاء النسخة الاحتياطية بنجاح');

  const firstCard = page.getByTestId('admin-backup-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(firstCard).toContainText('الأحدث');
});

test('زر تحديث القائمة يعمل من غير خطأ ويعرض نفس النسخ', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'backup');

  await page.getByTestId('admin-backup-create-button').click();
  await expectToast(page, '✅ تم إنشاء النسخة الاحتياطية بنجاح');

  await page.getByTestId('admin-backup-refresh').click();
  await expect(page.getByTestId('admin-backup-card').first()).toBeVisible({ timeout: 10_000 });
});

test('تنزيل نسخة احتياطية كملف JSON', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'backup');

  await page.getByTestId('admin-backup-create-button').click();
  await expectToast(page, '✅ تم إنشاء النسخة الاحتياطية بنجاح');

  const firstCard = page.getByTestId('admin-backup-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: 15_000 });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    firstCard.getByTestId('admin-backup-download').click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^sanad-backup-\d{4}-\d{2}-\d{2}\.json$/);
});

test('فتح مودال تأكيد الاستعادة، فاليديشن حقل الكتابة، والإلغاء من غير تنفيذ', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'backup');

  await page.getByTestId('admin-backup-create-button').click();
  await expectToast(page, '✅ تم إنشاء النسخة الاحتياطية بنجاح');

  const firstCard = page.getByTestId('admin-backup-card').first();
  await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
  await firstCard.getByTestId('admin-backup-restore-button').click();

  const confirmButton = page.getByTestId('admin-backup-restore-confirm-button');
  const input = page.getByTestId('admin-backup-restore-confirm-input');

  // من غير كتابة: الزرار معطّل
  await expect(confirmButton).toBeDisabled();

  // كتابة نص غلط: يفضل معطّل
  await input.fill('استعاده');
  await expect(confirmButton).toBeDisabled();

  // كتابة النص الصحيح بالظبط: يتفعّل — لكن هنا هنقف، مفيش دوسة فعلية عليه
  await input.fill('استعادة');
  await expect(confirmButton).toBeEnabled();

  // إلغاء بدل التنفيذ — المودال يقفل من غير أي تغيير في البيانات
  await page.getByTestId('admin-backup-restore-cancel').click();
  await expect(input).toHaveCount(0);
});
