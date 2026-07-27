import { defineConfig, devices } from '@playwright/test';

// إعدادات Playwright لمرحلة 7 (E2E) — بيشغّل سيرفر التطوير (vite) تلقائيًا
// ويشغّل التستات ضده. البيانات (إيميل/باسورد التينانت التجريبي) بتتقرا
// من env vars (E2E_TEST_EMAIL / E2E_TEST_PASSWORD) — تتضاف كـ Codespace
// secrets، مش موجودة هنا في الكود عشان الأمان.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // رحلة واحدة متسلسلة (login → قضية → جلسة → أتعاب → أرشفة)، مش تستات مستقلة
  retries: 0,
  workers: 1,
  // 'list' لسه موجود عشان يطبع في الـconsole زي ما هو، لكن ده لوحده
  // مابيولّدش أي ملفات على القرص — عشان كده خطوة "Upload Playwright
  // report on failure" في ci.yml كانت دايمًا مش لاقية حاجة في
  // playwright-report/ (المجلد ده أصلاً معملش). 'html' بيولّد التقرير
  // فعليًا (وفيه لينكات لكل trace.zip/screenshot لكل تست فشل).
  reporter: [['list'], ['html', { open: 'never' }]],
  // تنظيف تلقائي لبيانات E2E بعد كل تشغيل (تقرير المرحلة 4، "الخطوة
  // الجاية") — globalSetup بيسجّل وقت البداية، globalTeardown بيمسح كل
  // صف اتعمل بعده وعليه علامة "اختبار E2E". لو SUPABASE_SERVICE_ROLE_KEY
  // مش متضبط (تشغيل محلي عادي)، الـteardown بيتخطى نفسه من غير ما يفشل.
  globalSetup: './e2e/global-setup',
  globalTeardown: './e2e/global-teardown',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
