import { test, expect } from '@playwright/test';
import { login, openAdminSection } from './utils';

// المرحلة 6 (الأدمن) — دفعة 2: الجلسات.
//
// ⚠️ قرار واعي بالنطاق: "إنهاء جلسة" و"إنهاء جميع الجلسات"
// (handleTerminateSession / handleTerminateAllSessions في
// useAdminSessions.ts) بيستدعوا force_signout فعليًا على مستخدمين تانيين
// حقيقيين لو كان عندهم جلسات نشطة وقت التشغيل — عكس دفعة المستخدمين
// (admin-users.spec.ts) اللي قدرنا نعمل فيها حسابات تجريبية disposable
// خاصة بكل تست، هنا مفيش طريقة آمنة نولّد بيها "جلسة نشطة" تجريبية من
// غير تسجيل دخول فعلي بحساب تاني (سياق متصفح منفصل)، وحتى لو عملنا كده
// التست هيبقى غير حتمي (flaky) لأنه بيعتمد على وجود جلسات حقيقية تانية
// في بيئة التست وقت التشغيل. فالإنهاء الفعلي مؤجّل لدفعة لاحقة بقرار
// واعي (نفس منطق تأجيل معالجة PDF بالـ AI في دفعة 1). اللي بيتغطى هنا:
// العرض القرائي، زر التحديث، ومفتاح التحديث التلقائي — كلها آمنة 100%.
//
// ⚠️ شرط أساسي: حساب E2E_TEST_EMAIL لازم يكون Admin/Owner.

test('عرض الجلسات النشطة: جلسة المستخدم الحالي تظهر ببادج "أنت" من غير زر إنهاء', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'sessions');

  const myCard = page.getByTestId('admin-sessions-card').filter({ hasText: 'أنت' });
  await expect(myCard.first()).toBeVisible({ timeout: 15_000 });
  // زر الإنهاء ما يظهرش على جلسة المستخدم نفسه (!isMe في SessionsSection.tsx)
  await expect(myCard.first().getByTestId('admin-sessions-terminate')).toHaveCount(0);
});

test('زر التحديث اليدوي للجلسات يشتغل من غير أخطاء', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'sessions');

  await page.getByTestId('admin-sessions-card').first().waitFor({ state: 'visible', timeout: 15_000 });

  const refreshBtn = page.getByTestId('admin-sessions-refresh');
  await refreshBtn.click();
  // بعد التحديث الزرار المفروض يرجع قابل للضغط تاني (loadingSessions=false)
  await expect(refreshBtn).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByTestId('admin-sessions-card').first()).toBeVisible();
});

test('تبديل التحديث التلقائي للجلسات', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'sessions');

  const toggle = page.getByTestId('admin-sessions-autorefresh-toggle');
  // مفعّل افتراضيًا (sessionsAutoRefresh=true في useAdminSessions.ts)
  await expect(toggle).toHaveClass(/bg-\[#C9A84C\]/);

  await toggle.click();
  await expect(toggle).toHaveClass(/bg-slate-600/);

  // نرجّعه زي ما كان عشان ميفضلش أثر على باقي التستات في نفس الجلسة
  await toggle.click();
  await expect(toggle).toHaveClass(/bg-\[#C9A84C\]/);
});
