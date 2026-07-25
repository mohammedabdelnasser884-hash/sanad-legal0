import { test, expect } from '@playwright/test';
import { login, createClient, expectToast } from './utils';

// المرحلة 1 من خطة تنفيذ اختبارات E2E المقسمة — الموكلين (Tier 1).
// أولوية قصوى لأنها تغطية مباشرة لباج حقيقي حصل في الإنتاج (تكرار موكل
// واحد 3 نسخ عند الحفظ بسبب سباق بين ضغطات الحفظ وفحص التكرار — راجع
// تعليق "🔒 FIX (تقرير الموثوقية — نتيجة 0)" في useClientActions.ts).

test.describe('الموكلين — إضافة', () => {
  test('إنشاء موكل جديد بنجاح وظهوره في القايمة', async ({ page }) => {
    await login(page);
    const name = `اختبار E2E - موكل ${Date.now()}`;
    await createClient(page, name);

    // المودال اتقفل بعد الحفظ الناجح (حقل الاسم مبقاش ظاهر)
    await expect(page.getByTestId('new-client-name')).not.toBeVisible();
  });

  test('تكرار الرقم القومي عند الإضافة → رسالة خطأ، ومفيش موكل جديد يتسجل', async ({ page }) => {
    await login(page);
    const firstName = `اختبار E2E - موكل أصلي - ${Date.now()}`;
    const { nationalId } = await createClient(page, firstName);

    // موكل تاني باسم مختلف تمامًا لكن بنفس الرقم القومي بالظبط
    await page.getByTestId('nav-more-toggle').click();
    await page.getByTestId('nav-more-clients').click();
    await page.getByTestId('new-client-button').click();
    const secondName = `اختبار E2E - موكل مكرر - ${Date.now()}`;
    await page.getByTestId('new-client-name').fill(secondName);
    await page.getByTestId('new-client-phone').fill('01111111111');
    await page.getByTestId('new-client-national-id').fill(nationalId);
    await page.getByTestId('save-client-button').click();

    await expectToast(page, '⚠️ الرقم القومي موجود بالفعل لموكل مسجل من قبل');
    // المودال لسه مفتوح (مفيش حفظ حصل)
    await expect(page.getByTestId('save-client-button')).toBeVisible();
    // وكارت الموكل التاني (المكرر) ما ظهرش خالص في القايمة
    await expect(page.getByTestId('client-card').filter({ hasText: secondName })).toHaveCount(0);
  });

  test('ضغط زرار الحفظ مرتين بسرعة (دبل-كليك) → موكل واحد بس يتسجل', async ({ page }) => {
    await login(page);
    await page.getByTestId('nav-more-toggle').click();
    await page.getByTestId('nav-more-clients').click();
    await page.getByTestId('new-client-button').click();

    const name = `اختبار E2E - دبل كليك إضافة - ${Date.now()}`;
    await page.getByTestId('new-client-name').fill(name);
    await page.getByTestId('new-client-phone').fill('01222222222');
    await page.getByTestId('new-client-national-id').fill(`2900101${Date.now()}`.slice(0, 14));

    // بنضغط الزرار مرتين ورا بعض جوه نفس الـtask (من غير أي فاصل زمني
    // حقيقي بين الضغطتين) عشان نتأكد إن الحماية شغالة حتى لو الضغطتين
    // وصلوا للمتصفح قبل ما React يقفل الزرار بصريًا (disabled) — مش بس
    // معتمدين على إن Playwright هيرفض الضغطة التانية لأن الزرار مقفول.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="save-client-button"]') as HTMLButtonElement | null;
      btn?.click();
      btn?.click();
    });

    const newCard = page.getByTestId('client-card').filter({ hasText: name });
    await expect(newCard.first()).toBeVisible({ timeout: 15_000 });
    // منستنى شوية كمان عشان نتأكد إن مفيش نسخة تانية اتسجلت متأخر (لو
    // الضغطة التانية نفذت فعليًا وعملت INSERT ثاني)، بعدين نتأكد كارت واحد بس.
    await page.waitForTimeout(2_000);
    await expect(newCard).toHaveCount(1);
  });
});

test.describe('الموكلين — تعديل', () => {
  test('تعديل موكل موجود بنجاح', async ({ page }) => {
    await login(page);
    const originalName = `اختبار E2E - موكل قبل التعديل - ${Date.now()}`;
    await createClient(page, originalName);

    const card = page.getByTestId('client-card').filter({ hasText: originalName });
    await card.first().click();
    await page.getByTestId('client-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('client-edit-trigger').click();

    const updatedName = originalName + ' - معدّل';
    await page.getByTestId('edit-client-name').fill(updatedName);
    await page.getByTestId('save-client-edit-button').click();

    await expectToast(page, '✅ تم تحديث بيانات الموكل');
    // المودالين (تعديل + تفاصيل) اتقفلوا بعد نجاح التعديل
    await expect(page.getByTestId('save-client-edit-button')).not.toBeVisible();
  });

  test('تكرار الرقم القومي عند التعديل → رسالة خطأ، ومفيش حفظ للتعديل', async ({ page }) => {
    await login(page);
    const nameA = `اختبار E2E - موكل أ - ${Date.now()}`;
    const { nationalId: nationalIdA } = await createClient(page, nameA);

    const nameB = `اختبار E2E - موكل ب - ${Date.now()}`;
    await createClient(page, nameB);

    const cardB = page.getByTestId('client-card').filter({ hasText: nameB });
    await cardB.first().click();
    await page.getByTestId('client-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('client-edit-trigger').click();

    await page.getByTestId('edit-client-national-id').fill(nationalIdA);
    await page.getByTestId('save-client-edit-button').click();

    await expectToast(page, '⚠️ الرقم القومي موجود بالفعل لموكل مسجل من قبل');
    // مودال التعديل لسه مفتوح (مفيش حفظ حصل)
    await expect(page.getByTestId('save-client-edit-button')).toBeVisible();
  });

  test('ضغط زرار حفظ التعديلات مرتين بسرعة (دبل-كليك) → تعديل واحد بس ينفّذ', async ({ page }) => {
    await login(page);
    const name = `اختبار E2E - دبل كليك تعديل - ${Date.now()}`;
    await createClient(page, name);

    const card = page.getByTestId('client-card').filter({ hasText: name });
    await card.first().click();
    await page.getByTestId('client-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByTestId('client-edit-trigger').click();

    await page.getByTestId('edit-client-name').fill(name + ' - معدّل مرتين');
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="save-client-edit-button"]') as HTMLButtonElement | null;
      btn?.click();
      btn?.click();
    });

    await expectToast(page, '✅ تم تحديث بيانات الموكل');
    // المفروض نتيجة نهائية سليمة (تعديل واحد ينجح) حتى لو الضغطتين
    // اتنفذوا فعليًا — المودال المفروض يتقفل من غير أي رسالة خطأ/تعارض.
    await expect(page.getByTestId('save-client-edit-button')).not.toBeVisible();
  });
});
