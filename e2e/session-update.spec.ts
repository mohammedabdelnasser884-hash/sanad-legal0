import { test, expect } from '@playwright/test';
import { login, createStandaloneSession, expectToast } from './utils';

// المرحلة 7 (باقي Tier 2) — بند 3: SessionUpdateModal.tsx.
//
// ملحوظة مهمة: SessionUpdateModal.tsx كان أصلاً معمول عليه data-testid
// بالكامل (على عكس Notes/Docs)، والمسار الأساسي (تحديث جلسة قضية حقيقية
// + تعارض القفل التفاؤلي) مغطّى بالفعل في case-parties-and-sessions.spec.ts
// (تستات "تحديث آخر جلسة (⚡)" و"تعارض تعديل جلسة"). التستات هنا بتغطي
// بس الفجوات الحقيقية غير المغطاة قبل كده — نفس مبدأ تضييق النطاق
// المتفق عليه (24 يوليو): فرع كود حقيقي (isStandalone وlinkedClient في
// useCaseDetailActions السطور 61-101) يستاهل تغطية، مش تكرار لنفس آلية
// القفل التفاؤلي (كود مشترك اتغطى فعلاً).
//
// 🗑️ (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، المرحلة 5، 9 أغسطس
// 2026): تست "تحديث جلسة مستقلة مربوطة بموكل" اتحذف بالكامل — كان بيعتمد
// في خطوة الإعداد على زرار "إضافة الموكل لقائمة الموكلين فقط"
// (new-session-postsave-add-client-only) اللي اتشال من الواجهة في
// المرحلة 1. بعد الحذف، السيناريو نفسه (جلسة مستقلة ليها case_sessions
// .client_id قبل التحويل لقضية) بقى مستحيل تحقيقه من الواجهة خالص —
// فرع isStandalone/linkedClient في useCaseDetailActions فضل موجود في
// الكود (بيخدم بيانات قديمة اتسجلت قبل هذه الخطة)، لكنه بقى غير مغطى
// بأي E2E دلوقتي. لو احتجنا تغطيته تاني في المستقبل، الطريقة الوحيدة
// المتبقية هي إدخال client_id مباشرة عبر seed/DB fixture بدل مسار واجهة
// حقيقي.

// هيلبر محلي — فتح يوم معيّن في شبكة التقويم (نفس نمط openTodayInCalendar
// في standalone-sessions.spec.ts، بس بيقبل رقم يوم مش النهاردة بس).
async function openDayInCalendar(page: import('@playwright/test').Page, day: number) {
  await page.getByTestId('calendar-day').filter({ hasText: new RegExp(`^${day}$`) }).first().click();
}

// نفس هيلبر case-parties-and-sessions.spec.ts — يومين مختلفين في نفس
// الشهر الحالي بلا تنقل بين الشهور في الـDatePicker.
// 🔒 FIX (تشخيص لوجز E2E — 1 أغسطس 2026): النسخة القديمة كانت بتحسب
// otherDay = (اليوم===1 ? 2 : اليوم-1) وبعدين earlierDay = min(اليوم, otherDay).
// لما "اليوم" نفسه = 1 (أول يوم في الشهر)، الـmin بيرجّع 1 دايمًا — يعني
// earlierDay === todayDay فعليًا! في التستات هنا، الجلسة الأصلية بتتعمل
// دايمًا بتاريخ "النهاردة" (createStandaloneSession)، والتست بيفتح يوم
// "النهاردة" في التقويم (أكورديون بيتفتح)، وبعدين لما earlierDay===today
// يحاول يفتحه "تاني" — لكن لأنه مفتوح بالفعل، الضغطة التانية بتقفله
// (toggle) بدل ما تعرض الجلسة الجديدة، فالتست بيفشل بـTimeout كل مرة في
// أول يوم من الشهر. الحل: نضمن إن earlierDay/laterDay دايمًا مختلفين عن
// "اليوم" نفسه كمان، مش بس عن بعض.
function twoDaysInCurrentMonth(): { earlierDay: number; laterDay: number } {
  const today = new Date();
  const todayDay = today.getDate();
  const dayA = todayDay <= 2 ? todayDay + 1 : todayDay - 1;
  const dayB = todayDay <= 2 ? todayDay + 2 : todayDay - 2;
  return { earlierDay: Math.min(dayA, dayB), laterDay: Math.max(dayA, dayB) };
}

test('فاليديشن: منع الحفظ من غير تاريخ الجلسة القادمة', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - فاليديشن تحديث - ${Date.now()}`;
  await createStandaloneSession(page, title);

  await page.getByTestId('calendar-day').filter({ hasText: new RegExp(`^${new Date().getDate()}$`) }).first().click();
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await card.first().click();
  await page.getByTestId('standalone-session-update-trigger').click();
  await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });

  // 🔒 FIX (27 يوليو 2026): التست ده كان بيفشل 100% من المرات (30 ثانية
  // timeout كل مرة، مش flake) — كان بيحاول .click() على زرار الحفظ
  // ويستنى توست خطأ، لكن الزرار فعليًا disabled بالكامل من غير تاريخ
  // (راجع `disabled: saving || !nextDate` في SessionUpdateModal.tsx:224)
  // — يعني الفاليديشن بقت client-side عن طريق تعطيل الزرار نفسه، مش
  // توست بعد الضغط. من غير تاريخ الجلسة القادمة أصلاً
  await expect(page.getByTestId('session-update-save')).toBeDisabled();
  // المودال يفضل مفتوح — مفيش جلسة جديدة اتعملت
  await expect(page.getByTestId('session-update-modal')).toBeVisible();
});

test('تحديث جلسة مستقلة (بلا موكل مربوط) — الجلسة القادمة بترث العنوان والأطراف', async ({ page }) => {
  await login(page);
  const title = `اختبار E2E - تحديث مستقلة - ${Date.now()}`;
  await createStandaloneSession(page, title);
  // createStandaloneSession بتستخدم أسماء ثابتة للأطراف (راجع utils.ts):
  // 'موكل جلسة مستقلة E2E' / 'خصم جلسة مستقلة E2E' — بلا ربط موكل.

  const { earlierDay } = twoDaysInCurrentMonth();
  const today = new Date().getDate();

  await openDayInCalendar(page, today);
  const card = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await card.first().click();
  await page.getByTestId('standalone-session-update-trigger').click();
  await page.getByTestId('session-update-modal').waitFor({ state: 'visible', timeout: 10_000 });

  await page.getByTestId('session-update-next-date-trigger').click();
  await page.getByTestId('session-update-next-date-day').filter({ hasText: new RegExp(`^${earlierDay}$`) }).click();
  await page.getByTestId('session-update-save').click();

  await expectToast(page, '✅ تم تحديث الجلسة وإنشاء الجلسة القادمة');
  // بعد الحفظ الناجح، شاشة تفاصيل الجلسة المستقلة بتقفل هي كمان (onDone
  // بيندي onClose الأب) — نرجع للتقويم مباشرة.
  await expect(page.getByTestId('standalone-session-detail-modal')).not.toBeVisible({ timeout: 10_000 });

  // الجلسة القادمة (يوم earlierDay) لازم تحمل نفس العنوان — دليل نسخ
  // بيانات الجلسة المستقلة (title/plaintiff/defendant) في الفرع
  // isStandalone بدل ما تتولد فاضية.
  await openDayInCalendar(page, earlierDay);
  const nextCard = page.getByTestId('calendar-session-card').filter({ hasText: title });
  await expect(nextCard.first()).toBeVisible({ timeout: 10_000 });

  await nextCard.first().click();
  await expect(page.getByTestId('standalone-session-detail-modal')).toContainText('موكل جلسة مستقلة E2E');
  await expect(page.getByTestId('standalone-session-detail-modal')).toContainText('خصم جلسة مستقلة E2E');
});

