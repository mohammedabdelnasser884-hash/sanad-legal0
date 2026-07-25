import { test, expect } from '@playwright/test';
import { login, createCase } from './utils';

// المرحلة 7 (باقي Tier 2) — بند 5: ChecklistSection.tsx.
//
// الخطة الأصلية وصفت البند بـ"فحص الأطراف المتعددة الجديد" (سيناريو
// sidePartiesOk اللي بيقرا case_parties عبر validateParties بدل عمودي
// plaintiff/defendant القدامى — تحديث 24 يوليو). لكن قبل التنفيذ لازم
// نلاحظ حاجة مهمة: من ساعة overhaul الأطراف (23 يوليو)، NewCaseModal/
// EditCaseModal بيرفضوا الحفظ أصلاً لو فيه شخصان+ في نفس الجهة من غير
// مسمى قانوني جامع (نفس validateParties بالحرف — مغطّى فعلاً في
// case-parties-and-sessions.spec.ts). يعني عمليًا مفيش طريقة توصل بيها
// من واجهة المستخدم الفعلية لقضية محفوظة وفيها هذا النقص تحديدًا — مسار
// الكود ده موجود دفاعيًا بس مش قابل للوصول حاليًا من غير كسر فاليديشن
// مودال الحفظ نفسه (خارج نطاق تست UI حقيقي).
//
// فالفجوة الحقيقية القابلة للاختبار مش "قضية فيها نقص أطراف"، هي: هل
// شاشة المراجعة (تاب "المراجعة") بتتعامل صح مع قضية متعددة الأطراف
// *سليمة البيانات* (بتاخد ✓ صح مش تتعلّم غلط إنها ناقصة لمجرد وجود أكتر
// من شخص)، وهل آلية "دوس على بند ناقص → انتقال للتاب الصحيح" (onGoToTab)
// شغالة فعليًا؟ الشاشة دي كانت من غير أي data-testid أو تغطية E2E خالص
// من الأساس، فالتستين هنا بيغطوا الوصلتين الحقيقيتين دول.

test('قضية متعددة الأطراف ببيانات سليمة (مسمى قانوني مكتوب) — بند المدعي يظهر مكتمل في المراجعة', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - مراجعة تعدد أطراف - ${Date.now()}`;

  await page.getByTestId('nav-cases').click();
  await page.getByTestId('new-case-button').click();
  await page.getByTestId('new-case-title').fill(caseTitle);

  // مدعي أول (موكلنا ⭐) + مدعي تاني، مع المسمى القانوني الجامع مكتوب —
  // بيانات سليمة بالكامل (نفس نمط case-parties-and-sessions.spec.ts).
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-0-star').click();
  await page.getByTestId('new-case-plaintiff-0-name').fill('موكل اختبار E2E مراجعة');
  await page.getByTestId('new-case-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-case-plaintiff-0-national-id').fill(`4${Date.now()}`.slice(0, 14));
  await page.getByTestId('new-case-add-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-1-name').fill('وريث اختبار E2E مراجعة');
  await page.getByTestId('new-case-plaintiff-1-capacity').fill('وريث');
  await page.getByTestId('new-case-plaintiff-legal-title').fill('ورثة المرحوم اختبار E2E مراجعة');
  await page.getByTestId('new-case-plaintiff-subform-save').click();

  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-case-defendant-0-name').fill('خصم اختبار E2E مراجعة');
  await page.getByTestId('new-case-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-case-defendant-subform-save').click();
  await page.getByTestId('new-case-save').click();

  const card = page.getByTestId('case-card').filter({ hasText: caseTitle });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
  await card.first().click();
  await page.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByTestId('case-tab-checklist').click();
  await page.getByTestId('checklist-summary').waitFor({ state: 'visible', timeout: 10_000 });

  // بند المدعي لازم يظهر ✓ (مكتمل) — دليل إن sidePartiesOk قرأ الشخصين
  // مع المسمى القانوني صح عبر validateParties، مش اعتبرهم ناقصين لمجرد
  // إن الجهة فيها أكتر من شخص.
  const plaintiffItem = page.getByTestId('checklist-item-plaintiff');
  await expect(plaintiffItem).toContainText('✓');
  await expect(plaintiffItem).not.toContainText('ناقص');
});

test('بند ناقص (مستندات) في المراجعة — الدوس عليه بينقل فعليًا لتاب المستندات', async ({ page }) => {
  await login(page);
  const caseTitle = `اختبار E2E - مراجعة بند ناقص - ${Date.now()}`;
  // createCase() بتملأ العنوان + طرف واحد بس (بدون نوع/محكمة/رقم قيد/
  // مستندات/جلسات) — يعني بند "مستند واحد على الأقل" هيفضل ناقص طبيعيًا
  // من غير أي إعداد إضافي.
  await createCase(page, caseTitle);
  const card = page.getByTestId('case-card').filter({ hasText: caseTitle });
  await card.first().click();
  await page.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByTestId('case-tab-checklist').click();
  const docsItem = page.getByTestId('checklist-item-docs');
  await docsItem.waitFor({ state: 'visible', timeout: 10_000 });
  await expect(docsItem).toContainText('مستحسن');

  await docsItem.click();

  // onGoToTab('docs') المفروض يحول activeSection فعليًا — نتأكد بظهور
  // عنصر حقيقي من DocsSection، مش بس تغيير شكل التاب.
  await expect(page.getByTestId('case-tab-docs')).toHaveClass(/text-premium-gold/);
  await expect(page.getByTestId('doc-upload-toggle')).toBeVisible({ timeout: 10_000 });
});
