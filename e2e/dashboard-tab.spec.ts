import { test, expect } from '@playwright/test';
import { login, createAndOpenCase, addCaseSession, expectToast } from './utils';

// المرحلة 8 (Smoke) — DashboardTab.tsx (أكبر ملف في المرحلة، ~500 سطر).
// كانت الشاشة كلها من غير أي testid خالص. نطاق Smoke (مسارين منفصلين
// بلا تفرّع خطر داخل كل مسار):
//
// 1) الإجراءات السريعة (Quick Actions): زرار "إضافة موكل" (dashboard-quick-add-client)
//    بيفتح نفس NewClientModal العادي (نفس الموديل المستخدم في createClient()
//    من nav-more → clients) — بنكمل الحفظ فعليًا للتأكد إن المسار شغّال
//    من الطرف للطرف، مش بس إن المودال بيفتح.
// 2) بطاقة "اليوم": قضية فيها جلسة النهاردة بتظهر في بطاقة اليوم على
//    الداشبورد (dashboard-session-card)، وفتحها يوصل لتفاصيل القضية.
//    تبديل الأكورديون (dashboard-today-toggle) بيتأكد إنه بيقفل ويفتح
//    من غير ما يكسر عرض الكارت.

test('الإجراءات السريعة: إضافة موكل من الداشبورد مباشرة', async ({ page }) => {
  await login(page);
  // الداشبورد هو التاب الافتراضي بعد تسجيل الدخول — من غير أي تنقل.
  await page.getByTestId('dashboard-quick-add-client').click();

  const name = `اختبار E2E - موكل من الداشبورد - ${Date.now()}`;
  await page.getByTestId('new-client-name').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-client-name').fill(name);
  await page.getByTestId('new-client-phone').fill('01000000000');
  // ⚠️ FIX: كانت .slice(0, 14) — بتاخد أول 14 خانة من '2900101' + Date.now()
  // (7+13=20 خانة)، يعني بتقطع آخر 6 خانات من Date.now() وتسيب بس أول 7
  // (اللي بتتغيّر ببطء شديد، كل ~16-17 دقيقة) → تكرار رقم قومي حقيقي بين
  // تشغيلتين قريبتين وفشل الإنشاء. نفس السبب الجذري اللي اتصلّح في
  // createClient() جوه utils.ts — هنا نفس الباج لأن التست بيبني الرقم
  // مباشرة بدل ما يستخدم الهيلبر. الحل: آخر 14 خانة بدل الأول.
  await page.getByTestId('new-client-national-id').fill(`2900101${Date.now()}`.slice(-14));
  await page.getByTestId('save-client-button').click();

  await expectToast(page, '✅ تم إضافة الموكل بنجاح!');
});

test('بطاقة اليوم: جلسة النهاردة تظهر على الداشبورد وفتحها يوصل لتفاصيل القضية', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - داشبورد اليوم - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);
  await addCaseSession(page, new Date().getDate(), 'جلسة اختبار E2E - داشبورد اليوم');

  // الرجوع للداشبورد (التاب الافتراضي — إغلاق تفاصيل القضية يرجّعنا له)
  await page.getByTestId('case-detail-close').click();
  await page.getByTestId('case-detail-view').waitFor({ state: 'hidden', timeout: 10_000 });

  // بطاقة "اليوم" مفتوحة افتراضيًا — التأكد من ظهور الجلسة
  const card = page.getByTestId('dashboard-session-card').filter({ hasText: caseTitle });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });

  // تبديل الأكورديون (قفل ثم فتح) من غير ما يكسر عرض الكارت
  await page.getByTestId('dashboard-today-toggle').click();
  await expect(card.first()).toBeHidden();
  await page.getByTestId('dashboard-today-toggle').click();
  await card.first().waitFor({ state: 'visible', timeout: 5_000 });

  // فتح الجلسة يوصل لتفاصيل القضية
  await card.first().click();
  await page.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
});
