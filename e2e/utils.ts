import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

// خطوة 2+ من مرحلة 7 (E2E) — هيلبر تسجيل دخول مشترك.
// كل خطوة بعد الأولى محتاجة تعدّي شاشة الدخول الأول عشان توصل للشاشة
// اللي هتختبرها. بدل ما نكرر نفس الأربع سطور في كل ملف تست، بنلمّها هنا.
// (ملف auth.spec.ts بتاع خطوة 1 اتسيب زي ما هو من غير تعديل، لحد ما
// يتأكد بتشغيل فعلي — التعديل فيه دلوقتي هيبقى مخاطرة غير ضرورية.)
export async function login(page: Page): Promise<void> {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) {
    throw new Error(
      'لازم تضبط E2E_TEST_EMAIL و E2E_TEST_PASSWORD كـ Codespace secrets قبل تشغيل تستات E2E.'
    );
  }

  // 🩺 TEMP DEBUG (30 يوليو 2026) — بدون الهوك ده، أي console.error/warn
  // جوه كود المتصفح (React app) مش بيوصل لنص لوج CI خالص، وبيفضل حبيس
  // جوه trace.zip/الفيديو (ملفات تقيلة بنتجنب تنزيلها). الهوك ده بيودّي
  // نص الرسالة لـstdout بتاع Node مباشرة — يعني بيظهر في نفس ملف اللوج
  // النصي الصغير اللي بنجمعه أصلاً من CI، من غير أي مرفقات إضافية.
  // ينشال بعد ما نوصل للسبب الجذري في الفشلات المعلّقة.
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto('/');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('app-shell').waitFor({ state: 'visible', timeout: 15_000 });
}

// خطوة 4 محتاجة قضية موجودة (عشان تظهر في قايمة "القضية" وقت إضافة
// الأتعاب) من غير ما يكون لازم تتفتح فعليًا — فصلنا جزء الإنشاء لوحده
// عن جزء الفتح، وخلّينا createAndOpenCase يستخدم النسخة دي بدل ما
// يكرر نفس الأربع سطور.
// ⚠️ لازم نملأ نفس الحقول الإلزامية المستخدمة في cases.spec.ts (العنوان +
// طرف مدعي واحد عليه ⭐ "موكلنا" بيانات كاملة + طرف مدعى عليه واحد) —
// راجع خطة تعدد الأطراف (مرحلة 4، 22 يوليو 2026): NewCaseModal.tsx بقى
// يستخدم PartyFieldsGroup بدل حقلي "الموكل"/"الخصم" المفردين. البطاقة
// الأولى في كل جهة عندها data-testid بالشكل new-case-<side>-0-<field>
// (star/name/capacity/national-id)، ولازم تفعيل ⭐ الأول عشان الرقم
// القومي يبقى مطلوب/يتفحص، ومطابق لفاليديشن casePartiesValidation.ts.
export async function createCase(page: Page, title: string): Promise<void> {
  await page.getByTestId('nav-cases').click();
  await page.getByTestId('new-case-button').click();
  await page.getByTestId('new-case-title').fill(title);
  // ⚡ CHANGED (خطة "تطوير أطراف الدعوى" — مرحلة 4، 23 يوليو 2026): حقول
  // كل طرف بقت جوه نموذج فرعي منفصل (PartySubform) بيتفتح من كارت مطوي
  // (party-side-card-<side>)، مش ظاهرة مفتوحة دايمًا زي الشكل القديم —
  // لازم نفتح كارت الجهة، نملأ، ونقفل (زرار "حفظ والعودة") قبل ما ننتقل
  // للجهة التانية أو نضغط حفظ القضية.
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-case-plaintiff-0-star').click();
  await page.getByTestId('new-case-plaintiff-0-name').fill('موكل اختبار E2E');
  await page.getByTestId('new-case-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-case-plaintiff-0-national-id').fill('12345678901234');
  await page.getByTestId('new-case-plaintiff-subform-save').click();
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-case-defendant-0-name').fill('خصم اختبار E2E');
  await page.getByTestId('new-case-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-case-defendant-subform-save').click();
  await page.getByTestId('new-case-save').click();

  const card = page.getByTestId('case-card').filter({ hasText: title });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
}

// خطوة 3+ — خطوات زي "تسجيل جلسة"/"إضافة أتعاب"/"أرشفة" محتاجة قضية
// مفتوحة عشان تبدأ منها. بدل ما كل ملف يكرر نفس خطوات إنشاء وفتح
// القضية (نفس منطق cases.spec.ts بتاع خطوة 2)، الهيلبر ده بيعمل الاتنين
// ويسيب الصفحة على شاشة تفاصيل القضية (case-detail-view) جاهزة.
// (نفس ملحوظة auth.spec.ts فوق: cases.spec.ts اتسيب من غير تعديل عمدًا.)
export async function createAndOpenCase(page: Page, title: string): Promise<void> {
  await createCase(page, title);
  const card = page.getByTestId('case-card').filter({ hasText: title });
  await card.first().click();
  await page.getByTestId('case-detail-view').waitFor({ state: 'visible', timeout: 10_000 });
}

// خطوة 7+ (لوحة الأدمن / الأرشيف) — إنشاء قضية وأرشفتها (نفس خطوات
// archive.spec.ts الأصلية بالحرف) عشان الاختبارات اللي محتاجة قضية
// مؤرشفة كنقطة بداية (استرجاع / حذف نهائي من شاشة الأرشيف) متكررش
// نفس التسلسل. بيسيب الصفحة بعد إغلاق شاشة تفاصيل القضية مباشرة.
export async function createAndArchiveCase(page: Page, title: string): Promise<void> {
  await createAndOpenCase(page, title);
  await page.getByTestId('case-delete-trigger').click();
  await page.getByTestId('case-delete-local-confirm').click();
  await page.getByTestId('archive-confirm-choice-archive').click();
  await page.getByTestId('archive-confirm-input').fill(title);
  await page.getByTestId('archive-confirm-button').click();
  await page.getByTestId('case-detail-view').waitFor({ state: 'hidden', timeout: 10_000 });
}

// خطوة 7+ — فتح شاشة "الأرشيف" جوه لوحة الإدارة (nav-more-toggle →
// nav-more-admin → قسم الأرشيف)، وتحديد تبويب فرعي معيّن (قضايا/موكلين/أتعاب).
export async function openAdminArchiveTab(
  page: Page,
  tab: 'cases' | 'clients' | 'fees' = 'cases'
): Promise<void> {
  await closeAdminSectionIfOpen(page);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-admin').click();
  await page.getByTestId('admin-section-archive').click();
  await page.getByTestId('archive-tab-' + tab).click();
}

// قسم الإدارة الفرعي (زي "المستخدمين") بيتفتح كـ overlay بملء الشاشة بـ z-[60]،
// وده بيغطي الدوك السفلي (z-50) كامل — فلو قسم فاضل مفتوح من نداء سابق (زي
// createTestUser اللي بيفتح "المستخدمين" ومايقفلوش)، أي محاولة تانية تدوس
// nav-more-toggle هتتحجب. الهيلبر ده بيقفل أي قسم مفتوح الأول لو موجود.
async function closeAdminSectionIfOpen(page: Page): Promise<void> {
  const backButton = page.getByTestId('admin-section-back');
  if (await backButton.isVisible().catch(() => false)) {
    await backButton.click();
  }
}

// المرحلة 6 (الأدمن) — هيلبر عام لفتح أي قسم فرعي في لوحة الإدارة (nav-more-toggle →
// nav-more-admin → admin-section-<id>)، بديل مبسّط لـ openAdminArchiveTab فوق
// للأقسام اللي مالهاش تابات فرعية داخلية (نشاط/مكتبة قانونية/مكتب...).
export async function openAdminSection(
  page: Page,
  sectionId: 'users' | 'portal' | 'activity' | 'sessions' | 'security' | 'backup' | 'office' | 'legal_library' | 'archive'
): Promise<void> {
  await closeAdminSectionIfOpen(page);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-admin').click();
  await page.getByTestId('admin-section-' + sectionId).click();
}

// المرحلة 6 (الأدمن) — دفعة 2 — هيلبر إنشاء مستخدم جديد قابل للتصرف
// (disposable) عبر UserFormModal الحقيقي (useAdminUsers.handleAddUser →
// callAdminAction({action:'create_lawyer'})). بيفترض إن القسم مش مفتوح
// أصلًا فبيفتحه بنفسه (openAdminSection) عشان يبقى قابل للاستدعاء من
// أول التست مباشرة. بيرجّع البريد/كلمة السر المستخدمة عشان تستات
// "تغيير كلمة المرور" تقدر تتأكد من القيمة الجديدة لو احتاجت.
export async function createTestUser(
  page: Page,
  fullName: string,
  opts?: { role?: 'admin' | 'lawyer' | 'viewer' }
): Promise<{ email: string; password: string }> {
  const email = `e2e-user-${Date.now()}@example.com`;
  const password = 'TestUser12345';
  await openAdminSection(page, 'users');
  await page.getByTestId('admin-user-new-button').click();
  await page.getByTestId('admin-user-full_name').fill(fullName);
  await page.getByTestId('admin-user-email').fill(email);
  await page.getByTestId('admin-user-password').fill(password);
  if (opts?.role) await page.getByTestId('admin-user-role-' + opts.role).click();
  await page.getByTestId('admin-user-submit').click();

  const card = page.getByTestId('admin-user-card').filter({ hasText: fullName });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
  return { email, password };
}

// المرحلة 1 (خطة تنفيذ اختبارات E2E المقسمة) — هيلبر إنشاء موكل، بنفس نمط
// createCase فوق. بيرجّع الرقم القومي المستخدم فعليًا (مهم لتستات التكرار
// اللي محتاجة تعرف نفس الرقم بالظبط عشان تحاول تكرره في موكل تاني).
export async function createClient(
  page: Page,
  name: string,
  nationalId?: string
): Promise<{ nationalId: string }> {
  // ⚠️ FIX: كانت .slice(0, 14) — بتاخد أول 14 خانة من '2900101' +
  // Date.now() (7+13=20 خانة)، يعني بتقطع آخر 6 خانات من Date.now()
  // وتسيب بس أول 7 (اللي بتتغيّر ببطء شديد، كل ~16-17 دقيقة). في أي
  // تشغيل E2E أطول من كده، كل الموكلين اللي بيتعملوا في نفس الـ16 دقيقة
  // بياخدوا نفس الرقم القومي بالظبط → تكرار حقيقي وفشل الإنشاء، وده
  // بيكسر أي تست تاني مبني على وجود الموكل ده (سبب متسلسل لعدد كبير من
  // فشل الـE2E). الحل: ناخد آخر 14 خانة بدل الأول، فيتضمن Date.now()
  // كامل (13 خانة، فريدة لكل ميلي ثانية) بدل ما نقطعه.
  const finalNationalId = nationalId ?? `2900101${Date.now()}`.slice(-14);
  await page.getByTestId('nav-more-toggle').click();
  await page.getByTestId('nav-more-clients').click();
  await page.getByTestId('new-client-button').click();
  await page.getByTestId('new-client-name').fill(name);
  await page.getByTestId('new-client-phone').fill('01000000000');
  await page.getByTestId('new-client-national-id').fill(finalNationalId);
  await page.getByTestId('save-client-button').click();

  const card = page.getByTestId('client-card').filter({ hasText: name });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
  return { nationalId: finalNationalId };
}

// خطوة 6 (فاليديشن) — التأكد من ظهور رسالة توست بنص معيّن ولونها بيطابق
// حالة الخطأ (نفس آلية toast() في shared/lib/notifications.ts — بتلوّن
// الحدود/النص بالأحمر #f87171 لما isErr=true، وبتضيف class 'show').
// ⚠️ timeout اختياري (افتراضي 5 ثواني — كافية لمعظم التستات). العمليات
// البطيئة فعليًا (زي إنشاء نسخة احتياطية كاملة على بيانات production حقيقية
// في admin-backup.spec.ts) بتاخد وقت بيتناسب مع حجم البيانات، فمحتاجة
// تمرر timeout أكبر صراحةً بدل ما تتصادم مع الافتراضي القصير.
export async function expectToast(page: Page, text: string, timeout = 5_000): Promise<void> {
  const toastEl = page.locator('#toast');
  await expect(toastEl).toHaveClass(/show/, { timeout });
  await expect(toastEl).toHaveText(text);
}

// المرحلة 3 (خطة تنفيذ اختبارات E2E المقسمة) — هيلبر إضافة جلسة لقضية
// مفتوحة بالفعل على شاشة تفاصيلها (case-detail-view، تبويب "الجلسات"
// نشط). بيستقبل رقم اليوم (day) في الشهر الحالي (نفس تاريخ اليوم أو أي
// يوم تاني في نفس الشهر — بلا احتياج للتنقل بين الشهور في الـDatePicker،
// راجع ملحوظة sessions.spec.ts الأصلية) عشان تستات المرحلة 3 (تعديل/حذف/
// تعارض) تقدر تتحكم في ترتيب الجلستين (الأحدث تاريخًا = index 0، وعليها
// زرار "⚡ تحديث" بس من غير تعديل/حذف مباشر — راجع TimelineSection.tsx).
export async function addCaseSession(page: Page, day: number, description: string): Promise<void> {
  await page.getByTestId('add-session-button').click();
  await page.getByTestId('session-date-trigger').click();
  await page.getByTestId('session-date-day').filter({ hasText: new RegExp(`^${day}$`) }).click();
  await page.getByTestId('session-description').fill(description);
  await page.getByTestId('save-session-button').click();
  await page.getByTestId('session-card').filter({ hasText: description }).first().waitFor({ state: 'visible', timeout: 15_000 });
}

// المرحلة 2 (خطة تنفيذ اختبارات E2E المقسمة) — هيلبر إنشاء جلسة مستقلة
// بأبسط بيانات صالحة (طرف مدعي واحد عليه ⭐ + طرف مدعى عليه واحد، نفس
// نمط createCase فوق)، وتاريخها دايمًا "النهاردة" — عشان standalone-sessions.spec.ts
// (وأي مرحلة تانية محتاجة جلسة مستقلة كنقطة بداية) تقدر توصل لشاشة
// التقويم وتفتحها من غير ما تكرر نفس الخطوات. بيسيب مودال "تحويل لقضية؟"
// مقفول (بيدوس "لا شكراً، إغلاق") وبيرجّع الصفحة على تبويب الجلسات.
export async function createStandaloneSession(page: Page, title: string): Promise<void> {
  await page.getByTestId('nav-calendar').click();
  await page.getByTestId('calendar-new-session-button').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('new-session-title').fill(title);
  const today = new Date().toISOString().slice(0, 10);
  await page.getByTestId('new-session-date').fill(today);
  await page.getByTestId('party-side-card-plaintiff').click();
  await page.getByTestId('new-session-plaintiff-0-star').click();
  await page.getByTestId('new-session-plaintiff-0-name').fill('موكل جلسة مستقلة E2E');
  await page.getByTestId('new-session-plaintiff-0-capacity').fill('مدعي');
  await page.getByTestId('new-session-plaintiff-0-national-id').fill('12345678901234');
  await page.getByTestId('new-session-plaintiff-subform-save').click();
  await page.getByTestId('party-side-card-defendant').click();
  await page.getByTestId('new-session-defendant-0-name').fill('خصم جلسة مستقلة E2E');
  await page.getByTestId('new-session-defendant-0-capacity').fill('مدعى عليه');
  await page.getByTestId('new-session-defendant-subform-save').click();
  await page.getByTestId('new-session-save').click();

  // بعد الحفظ الناجح بيفتح مودال "تحويل لقضية؟" (خطوة idle) تلقائيًا —
  // بنقفله عشان نرجع لشاشة التقويم العادية، جاهزة لأي خطوة بعد الهيلبر.
  await page.getByTestId('new-session-postsave-idle-close').click();
  await page.getByTestId('new-session-modal').waitFor({ state: 'hidden', timeout: 10_000 });
}

// المرحلة 7 (باقي Tier 2) — بند 4: EditReminderModal.tsx. هيلبر إنشاء
// تذكير بتاريخ اليوم (بيقع في تاب "قادمة" الافتراضي — راجع useRemindersTab:
// upcoming = due_date >= اليوم). بيرجع للتاب الافتراضي بعد الحفظ (الفورم
// بيتقفل تلقائيًا وfetchReminders() بيحدّث القايمة).
// المرحلة 8 (Smoke) — MissedTab.tsx محتاج جلسة "فائتة" فعليًا (تاريخها فات
// من غير result ولا next_action) عشان نقدر نختبر المسار غير الفارغ. بتفترض
// إن فيه قضية مفتوحة بالفعل (case-detail-view ظاهرة) — بترجع لنفس الشاشة
// بعد الحفظ زي addCaseSession العادي، وبتستخدم نفس يوم النهاردة بس في
// الشهر السابق (Math.min بـ 28 عشان نضمن إن اليوم موجود في أي شهر).
export async function addMissedSession(page: Page, description: string): Promise<void> {
  const day = Math.min(new Date().getDate(), 28);
  await page.getByTestId('add-session-button').click();
  await page.getByTestId('session-date-trigger').click();
  await page.getByTestId('date-picker-prev-month').click();
  await page.getByTestId('session-date-day').filter({ hasText: new RegExp(`^${day}$`) }).click();
  await page.getByTestId('session-description').fill(description);
  await page.getByTestId('save-session-button').click();
  await page.getByTestId('session-card').filter({ hasText: description }).first().waitFor({ state: 'visible', timeout: 15_000 });
}

export async function createReminder(page: Page, title: string): Promise<void> {
  await page.getByTestId('nav-reminders').click();
  await page.getByTestId('new-reminder-toggle').click();
  await page.getByTestId('new-reminder-title').fill(title);
  await page.getByTestId('new-reminder-date-trigger').click();
  await page
    .getByTestId('new-reminder-date-day')
    .filter({ hasText: new RegExp(`^${new Date().getDate()}$`) })
    .click();
  await page.getByTestId('new-reminder-save').click();
  const card = page.locator('[data-testid^="reminder-card-"]').filter({ hasText: title });
  await card.first().waitFor({ state: 'visible', timeout: 15_000 });
}

