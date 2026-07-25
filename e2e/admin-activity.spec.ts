import { test, expect } from '@playwright/test';
import { login, openAdminSection, createClient } from './utils';

// المرحلة 6 (الأدمن) — دفعة 1 (أقل خطورة): سجل النشاط.
// بدل ما نختبر شاشة فاضية، بنعمل إجراء حقيقي (إضافة موكل بإسم فريد) وبعدين
// نتأكد إن سجل النشاط بيعرضه فعليًا لما نبحث بإسمه — نفس ما هو متوقع من
// logActivity(db,'إضافة موكل', { client_name: ... }) في useClientActions.ts.

test('سجل النشاط: إضافة موكل جديد تظهر كسجل قابل للبحث بإسمه', async ({ page }) => {
  const clientName = `اختبار E2E نشاط ${Date.now()}`;

  await login(page);
  await createClient(page, clientName);

  await openAdminSection(page, 'activity');

  await page.getByTestId('admin-activity-search').fill(clientName);
  // الديباونس 400ms قبل ما البحث يتنفذ فعليًا (راجع handleActivitySearchChange في AdminPanel.tsx)
  await page.waitForTimeout(500);

  const entry = page.getByTestId('admin-activity-entry').filter({ hasText: clientName });
  await expect(entry.first()).toBeVisible({ timeout: 10_000 });
  await expect(entry.first()).toContainText('إضافة');
});

test('سجل النشاط: مسح الفلاتر يرجّع القائمة الكاملة', async ({ page }) => {
  await login(page);
  await openAdminSection(page, 'activity');

  await page.getByTestId('admin-activity-filter-action').selectOption('حذف');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('admin-activity-filter-clear')).toBeVisible();

  await page.getByTestId('admin-activity-filter-clear').click();
  await expect(page.getByTestId('admin-activity-filter-clear')).toHaveCount(0);
});
