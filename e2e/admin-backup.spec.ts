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
//
// 🔒 FIX (تشخيص لوجز E2E — 1 أغسطس 2026): كانت كل تست من الأربعة بتدوس
// "إنشاء نسخة احتياطية" بنفسها من الصفر — يعني 4 عمليات تصدير كاملة
// لكل جداول التينانت (paginated، جدول جدول، بالتسلسل) في نفس الـCI run
// الواحد. مع تراكم بيانات باقي ملفات E2E اللي بتتشغل قبل الملف ده (نفس
// الـworker، نفس الجلسة، workers:1/fullyParallel:false في playwright.config.ts)،
// العملية الرابعة بقت بطيئة كفاية إنها تعدي مهلة الـtoast (30 ثانية)
// و/أو تسحب أداء Supabase تحت لحد ما اللوجين نفسه (في التست ده وفي
// admin-portal.spec.ts اللي بيجي بعده) يستنى أكتر من 15 ثانية وبيفشل —
// مفيش أي assertion غلط في أي تست، الفشل كله TimeoutError خالص. كمان
// جدول `backups` نفسه مش متضمن في تنظيف global-teardown.ts (بيمسح
// بيانات موسومة بـ"اختبار E2E" بس، والنسخ الاحتياطية مالهاش عمود عنوان
// بالماركر ده) — فكل تشغيلة CI كانت بتضيف 4 صفوف جديدة (مش صف واحد)
// من غير أي تنظيف تراكمي.
//
// الحل: نعمل النسخة الاحتياطية "الحقيقية" مرة واحدة بس (أول تست)،
// والتلات تستات الباقية بيفتحوا قسم النسخ الاحتياطي وبيستخدموا نفس
// النسخة اللي اتعملت بالفعل (البيانات متخزنة في Supabase نفسها، مش في
// الصفحة — فباقي التستات هيلاقوها موجودة تلقائيًا لما يفتحوا القسم، من
// غير أي حاجة إضافية). test.describe.serial() بتضمن إن التستات بتتنفذ
// بنفس الترتيب دايمًا (وهو أصلاً السلوك الافتراضي هنا بسبب workers:1)،
// وبتوضّح الاعتمادية الحقيقية الجديدة بين التستات (لو التست الأول فشل
// في إنشاء النسخة، الباقي هيتخطى بدل ما يفشل بغموض وهو بيدور على نسخة
// مش موجودة أصلاً).
test.describe.serial('النسخ الاحتياطي', () => {
  test('إنشاء نسخة احتياطية جديدة وظهورها في القائمة كأحدث نسخة', async ({ page }) => {
    await login(page);
    await openAdminSection(page, 'backup');

    await page.getByTestId('admin-backup-create-button').click();
    // ⚠️ مهلة أطول من الافتراضي: إنشاء نسخة احتياطية بيصدّر كل جداول المكتب
    // بالتسلسل على بيانات production حقيقية (مفيش staging)، فالوقت بيتناسب
    // مع حجم البيانات الفعلي وممكن يعدي الـ5 ثواني الافتراضية بسهولة.
    await expectToast(page, '✅ تم إنشاء النسخة الاحتياطية بنجاح', 30_000);

    const firstCard = page.getByTestId('admin-backup-card').first();
    await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
    await expect(firstCard).toContainText('الأحدث');
  });

  test('زر تحديث القائمة يعمل من غير خطأ ويعرض نفس النسخ', async ({ page }) => {
    await login(page);
    // 🔒 FIX: بنعتمد على النسخة اللي اتعملت في التست الأول بدل ما نعمل
    // وحدة جديدة — القسم بيعمل fetchBackups() تلقائيًا لما يتفتح
    // (AdminPanel.tsx: `if (section === 'backup') fetchBackups();`)،
    // فمفيش داعي حتى لدوسة "تحديث" يدوية قبل التأكد من وجود الكارت —
    // بس سايبينها هنا لأنها هي نفسها موضوع التست (التأكد إن الزرار
    // شغّال من غير خطأ ومش بيفضّي القائمة).
    await openAdminSection(page, 'backup');
    await expect(page.getByTestId('admin-backup-card').first()).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('admin-backup-refresh').click();
    await expect(page.getByTestId('admin-backup-card').first()).toBeVisible({ timeout: 10_000 });
  });

  test('تنزيل نسخة احتياطية كملف JSON', async ({ page }) => {
    await login(page);
    // 🔒 FIX: نفس الملحوظة فوق — نستخدم النسخة الموجودة بالفعل.
    await openAdminSection(page, 'backup');

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
    // 🔒 FIX: نفس الملحوظة فوق — نستخدم النسخة الموجودة بالفعل.
    await openAdminSection(page, 'backup');

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
});
