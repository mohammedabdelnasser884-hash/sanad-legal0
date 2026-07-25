import { test, expect } from '@playwright/test';
import { login, createAndOpenCase, expectToast } from './utils';

// المرحلة 7 (باقي Tier 2) — بند 1: NotesSection.tsx (تبويب "الملاحظات"
// جوّه تفاصيل القضية). التستات دي بتغطي دورة الملاحظة الكاملة: إضافة،
// تعديل ناجح، تعارض تعديل متزامن (نفس منطق useCaseDetailActions.ts —
// knownUpdatedAt عبر window.__dbWrite، نفس آلية الأقفال التفاؤلية
// المستخدمة في الجلسات)، وحذف (إلغاء التأكيد + تنفيذ فعلي).

test('إضافة ملاحظة جديدة لقضية وظهورها في القائمة', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - إضافة ملاحظة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-notes').click();
  await page.getByTestId('note-add-toggle').click();
  const noteContent = `ملاحظة اختبار E2E - ${Date.now()}`;
  await page.getByTestId('note-text-input').fill(noteContent);
  await page.getByTestId('note-save-button').click();

  await expectToast(page, '✅ تمت إضافة الملاحظة');
  await expect(page.getByTestId('note-card').filter({ hasText: noteContent })).toHaveCount(1, { timeout: 10_000 });
});

test('إلغاء إضافة ملاحظة من غير حفظ', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - إلغاء ملاحظة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-notes').click();
  await page.getByTestId('note-add-toggle').click();
  await page.getByTestId('note-text-input').fill('ملاحظة لن تُحفظ');
  await page.getByTestId('note-add-cancel').click();

  await expect(page.getByTestId('note-text-input')).toHaveCount(0);
  await expect(page.getByTestId('notes-empty')).toBeVisible();
});

test('تعديل ملاحظة موجودة بنجاح', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تعديل ملاحظة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-notes').click();
  const original = `ملاحظة أصلية - ${Date.now()}`;
  await page.getByTestId('note-add-toggle').click();
  await page.getByTestId('note-text-input').fill(original);
  await page.getByTestId('note-save-button').click();
  await expectToast(page, '✅ تمت إضافة الملاحظة');

  const card = page.getByTestId('note-card').filter({ hasText: original });
  await card.first().waitFor({ state: 'visible', timeout: 10_000 });
  await card.first().getByTestId('note-edit-trigger').click();

  const updated = `ملاحظة معدّلة - ${Date.now()}`;
  await page.getByTestId('note-edit-input').fill(updated);
  await page.getByTestId('note-edit-save').click();

  await expectToast(page, '✅ تم تعديل الملاحظة');
  await expect(page.getByTestId('note-card').filter({ hasText: updated })).toHaveCount(1, { timeout: 10_000 });
});

test('تعارض تعديل ملاحظة عند التحديث المتزامن من صفحتين (Optimistic Lock)', async ({ page, browser }) => {
  await login(page);
  const caseTitle = `اختبار E2E - تعارض ملاحظة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-notes').click();
  const original = `ملاحظة تعارض - ${Date.now()}`;
  await page.getByTestId('note-add-toggle').click();
  await page.getByTestId('note-text-input').fill(original);
  await page.getByTestId('note-save-button').click();
  await expectToast(page, '✅ تمت إضافة الملاحظة');
  await page.getByTestId('note-card').filter({ hasText: original }).first().waitFor({ state: 'visible', timeout: 10_000 });

  // صفحة تانية بتفتح نفس القضية وتشوف نفس نسخة الملاحظة (نفس updated_at الأصلي)
  const context2 = await browser.newContext();
  const page2 = await context2.newPage();
  try {
    await login(page2);
    await page2.getByTestId('nav-cases').click();
    await page2.getByTestId('case-card').filter({ hasText: caseTitle }).first().click();
    await page2.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
    await page2.getByTestId('case-tab-notes').click();
    const card2 = page2.getByTestId('note-card').filter({ hasText: original });
    await card2.first().waitFor({ state: 'visible', timeout: 10_000 });

    // صفحة 1: تعدّل وتحفظ الأولى — بتنجح فعليًا وتغيّر updated_at الحقيقي
    const card1 = page.getByTestId('note-card').filter({ hasText: original });
    await card1.first().getByTestId('note-edit-trigger').click();
    await page.getByTestId('note-edit-input').fill('حدث من صفحة 1');
    await page.getByTestId('note-edit-save').click();
    await expectToast(page, '✅ تم تعديل الملاحظة');

    // صفحة 2: لسه معاها النسخة القديمة — بتحاول تعدّل بنفس الملاحظة،
    // ولازم تاخد رسالة تعارض واضحة بدل ما تكتب فوق تعديل صفحة 1 بصمت.
    await card2.first().getByTestId('note-edit-trigger').click();
    await page2.getByTestId('note-edit-input').fill('حدث من صفحة 2 (المفروض يترفض)');
    await page2.getByTestId('note-edit-save').click();

    await expectToast(page2, '⚠️ هذه الملاحظة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة');
  } finally {
    await context2.close();
  }
});

test('حذف ملاحظة: إلغاء التأكيد يسيبها، والتأكيد يحذفها فعليًا', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - حذف ملاحظة - ${Date.now()}`;
  await createAndOpenCase(page, caseTitle);

  await page.getByTestId('case-tab-notes').click();
  const content = `ملاحظة للحذف - ${Date.now()}`;
  await page.getByTestId('note-add-toggle').click();
  await page.getByTestId('note-text-input').fill(content);
  await page.getByTestId('note-save-button').click();
  await expectToast(page, '✅ تمت إضافة الملاحظة');

  const card = page.getByTestId('note-card').filter({ hasText: content });
  await card.first().waitFor({ state: 'visible', timeout: 10_000 });

  // إلغاء التأكيد — الملاحظة تفضل موجودة
  await card.first().getByTestId('note-delete-trigger').click();
  await page.getByTestId('note-delete-cancel').click();
  await expect(page.getByTestId('note-card').filter({ hasText: content })).toHaveCount(1);

  // تأكيد الحذف الفعلي
  await card.first().getByTestId('note-delete-trigger').click();
  await page.getByTestId('note-delete-confirm').click();
  await expectToast(page, '🗑 تم حذف الملاحظة');
  await expect(page.getByTestId('note-card').filter({ hasText: content })).toHaveCount(0, { timeout: 10_000 });
});
