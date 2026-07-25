import { test, expect, type Page } from '@playwright/test';
import { login, createCase, expectToast } from './utils';

// المرحلة 4 من خطة تنفيذ اختبارات E2E المقسمة — الأتعاب: تسجيل دفعات
// (جزئية/كاملة/أكبر من المتبقي)، منع التسجيل أوفلاين، معاينة الفاتورة،
// حذف دفعة، وتعديل/حذف سجل الأتعاب نفسه.
//
// كل تست بيعمل قضية جديدة + سجل أتعاب جديد من الصفر (بدل ما يشارك سجل
// واحد بين التستات) — نفس فلسفة fees.spec.ts الأصلي — عشان محدش يعتمد
// على ترتيب تشغيل، ومحصلش تلوث بيانات بين تست وتاني.

// ⚠️ ملحوظة تنسيق: كل الأرقام المعروضة في الشاشة بتمر بـ formatArNumber
// (shared/ui/arabicLocale.ts) اللي بيستخدم locale 'ar-EG' — يعني بتظهر
// بأرقام عربية شرقية وفاصلة آلاف عربية (مثلاً "٤٬٠٠٠" مش "4,000"). الهيلبر
// ده بيولّد نفس الصيغة بالظبط عشان التستات تقارن صح.
function arNum(n: number): string {
  return n.toLocaleString('ar-EG', { maximumFractionDigits: 0 });
}

async function createFee(page: Page, caseTitle: string, total: string): Promise<void> {
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-fees').click();
  await page.getByTestId('add-fee-button').click();
  await page.getByTestId('fee-case-select').selectOption({ label: caseTitle });
  await page.getByTestId('fee-total').fill(total);
  await page.getByTestId('save-fee-button').click();
  await expect(page.getByTestId('fee-total')).not.toBeVisible({ timeout: 15_000 });
}

async function openFeeDetail(page: Page, caseTitle: string): Promise<void> {
  const card = page.getByTestId('fee-card').filter({ hasText: caseTitle });
  await card.first().click();
  await page.getByTestId('fee-detail-modal').waitFor({ state: 'visible', timeout: 10_000 });
}

async function fillPaymentForm(
  page: Page,
  amount: string,
  opts?: { date?: string; receiver?: string; note?: string }
): Promise<void> {
  await page.getByTestId('add-payment-trigger').click();
  await page.getByTestId('pay-amount').fill(amount);
  if (opts?.date) await page.getByTestId('pay-date').fill(opts.date);
  if (opts?.receiver) await page.getByTestId('pay-receiver').fill(opts.receiver);
  if (opts?.note) await page.getByTestId('pay-note').fill(opts.note);
}

test('1) تسجيل دفعة جزئية وتحديث النسبة/المتبقي', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - أتعاب جزئي - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '10000');
  await openFeeDetail(page, caseTitle);

  await fillPaymentForm(page, '4000');
  await page.getByTestId('confirm-add-payment').click();
  await expectToast(page, '✅ تم تسجيل الدفعة');

  // المتبقي المفروض يبقى 6000 بعد دفعة 4000 من إجمالي 10000
  await expect(page.getByTestId('fee-remaining-value')).toContainText(arNum(6000));
  await page.getByTestId('payments-history-toggle').click();
  await expect(page.getByTestId('payment-row')).toHaveCount(1);
});

test('2) دفعة تكمل السداد بالكامل — البطاقة تتحول لـ "مسدد"', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - أتعاب كامل - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '3000');
  await openFeeDetail(page, caseTitle);

  await fillPaymentForm(page, '3000');
  await page.getByTestId('confirm-add-payment').click();
  await expectToast(page, '✅ تم تسجيل الدفعة');

  await expect(page.getByTestId('fee-remaining-value')).toContainText(arNum(0));
  // بعد السداد الكامل زرار "تسجيل دفعة" بيختفي (isFullyPaid) والكارت
  // برة المودال بيوريه "✅ مسدد" بدل النسبة.
  await expect(page.getByTestId('add-payment-trigger')).not.toBeVisible();
  await page.getByTestId('fee-detail-close').click();
  const card = page.getByTestId('fee-card').filter({ hasText: caseTitle });
  await expect(card.first()).toContainText('✅ مسدد');
});

test('3) دفعة أكبر من المتبقي — تحذير بس مش رفض (تُسجَّل فعليًا)', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - أتعاب تجاوز - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '1000');
  await openFeeDetail(page, caseTitle);

  // المتبقي 1000، هنسجل 1500 (أكبر من المتبقي)
  await fillPaymentForm(page, '1500');
  await page.getByTestId('confirm-add-payment').click();

  // useFeesActions.handleAddPayment: توست تحذير أول، ثم توست نجاح —
  // الدفعة بتتسجل فعليًا رغم التحذير (مفيش منع في الكود).
  await expect(page.locator('#toast')).toContainText('يتجاوز المتبقي');
  await expectToast(page, '✅ تم تسجيل الدفعة');
  await page.getByTestId('payments-history-toggle').click();
  await expect(page.getByTestId('payment-row-amount').first()).toContainText(arNum(1500));
});

test('4) منع تسجيل الدفعة أوفلاين برسالة واضحة', async ({ page, context }) => {
  await login(page);
  const caseTitle = `اختبار E2E - أتعاب أوفلاين - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '2000');
  await openFeeDetail(page, caseTitle);

  await fillPaymentForm(page, '500');
  await context.setOffline(true);
  try {
    await page.getByTestId('confirm-add-payment').click();
    await expectToast(page, '⚠️ تسجيل الدفعة يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال');
    // الفورم لازم يفضل مفتوح (العملية اتمنعت بالكامل، مفيش تسجيل جزئي)
    await expect(page.getByTestId('pay-amount')).toBeVisible();
  } finally {
    await context.setOffline(false);
  }

  // نتأكد إن المتبقي فعلاً متغيرش (مفيش دفعة انسجلت فعليًا)
  await expect(page.getByTestId('fee-remaining-value')).toContainText(arNum(2000));
});

test('5) معاينة فاتورة دفعة مسجّلة', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - فاتورة - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '5000');
  await openFeeDetail(page, caseTitle);

  await fillPaymentForm(page, '2000', { receiver: 'محامي الاختبار' });
  await page.getByTestId('confirm-add-payment').click();
  await expectToast(page, '✅ تم تسجيل الدفعة');

  await page.getByTestId('payments-history-toggle').click();
  await page.getByTestId('payment-invoice-trigger').first().click();
  await page.getByTestId('invoice-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await expect(page.getByTestId('invoice-amount')).toContainText(arNum(2000));
  await page.getByTestId('invoice-modal-close').click();
  await page.getByTestId('invoice-modal').waitFor({ state: 'hidden' });
});

test('6) حذف دفعة وإعادة حساب المتبقي', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - حذف دفعة - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '4000');
  await openFeeDetail(page, caseTitle);

  await fillPaymentForm(page, '1000');
  await page.getByTestId('confirm-add-payment').click();
  await expectToast(page, '✅ تم تسجيل الدفعة');
  await expect(page.getByTestId('fee-remaining-value')).toContainText(arNum(3000));

  await page.getByTestId('payments-history-toggle').click();
  await page.getByTestId('payment-delete-trigger').first().click();
  // بيانات نص التأكيد (fmt/fmtDate) بيتقروا من نفس المودال — نص مُنسّق
  // بأرقام عربية شرقية وصعب نعيد بناءه يدويًا، فبنقرأه من الشاشة نفسها.
  const exactText = await page.getByTestId('delete-confirm-item-name').innerText();
  await page.getByTestId('confirm-delete-payment-input').fill(exactText);
  await page.getByTestId('confirm-delete-payment-yes').click();

  await expect(page.getByTestId('payment-row')).toHaveCount(0);
  await expect(page.getByTestId('fee-remaining-value')).toContainText(arNum(4000));
});

test('7) تعديل سجل أتعاب موجود (تغيير الإجمالي)', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تعديل أتعاب - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '1000');

  const card = page.getByTestId('fee-card').filter({ hasText: caseTitle });
  await card.first().click();
  await page.getByTestId('fee-detail-modal').waitFor({ state: 'visible' });
  await page.getByTestId('edit-fee-trigger').click();
  await page.getByTestId('fee-total').fill('7000');
  await page.getByTestId('save-fee-button').click();
  await expect(page.getByTestId('fee-total')).not.toBeVisible({ timeout: 15_000 });

  // ⚠️ handleSave بيقفل فورم التعديل بس (setShowForm(false)) — مودال
  // التفاصيل (detailsFor) فاضل مفتوح تحته زي ما هو، وبيتحدّث بالبيانات
  // الجديدة بعد fetchFees. مفيش داعي (ولا لازم) نفتحه تاني.
  await expect(page.getByTestId('fee-remaining-value')).toContainText(arNum(7000));
});

test('8) حذف سجل أتعاب (أرشفة) واختفاؤه من القائمة', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - حذف أتعاب - ${Date.now()}`;
  await createCase(page, caseTitle);
  await createFee(page, caseTitle, '1500');

  const card = page.getByTestId('fee-card').filter({ hasText: caseTitle });
  await card.first().click();
  await page.getByTestId('fee-detail-modal').waitFor({ state: 'visible' });
  await page.getByTestId('delete-fee-trigger').click();
  await page.getByTestId('archive-confirm-choice-archive').click();
  const exactText = await page.getByTestId('delete-confirm-item-name').innerText();
  await page.getByTestId('fee-delete-confirm-input').fill(exactText);
  await page.getByTestId('fee-delete-confirm-button').click();

  await expect(page.getByTestId('fee-card').filter({ hasText: caseTitle })).toHaveCount(0);
});
