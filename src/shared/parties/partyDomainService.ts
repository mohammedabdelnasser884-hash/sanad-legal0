// ══════════════════════════════════════════════════════════════
//  partyDomainService — نقطة تجميع واحدة لكل قواعد "قفل/ربط الطرف"،
//  بدل التكرار اللي كان موزّع في 4+ أماكن (EditCaseModal.tsx،
//  StandaloneSessionDetailModal.tsx بنسختيه، InfoSection.tsx، والهيدر
//  في CaseDetailView.tsx) — كل مكان كان بيكتب نفس الشرط `!!party.client_id`
//  أو `!!clientId && !linkedClient` بنفسه، من غير مصدر حقيقة واحد.
//
//  خطة تنفيذ توحيد منطق قفل الطرف — المرحلة 1 (5 أغسطس 2026)، مبنية على
//  فحص الكود الفعلي (تقرير خطة تنفيذ توحيد قفل الطرف، مراجعات 1-4).
//
//  ⚠️ الملف ده لسه مش متوصّل بالفورمات/الشاشات الفعلية — التوصيل
//  (استبدال `!!party.client_id` وأخواتها بنداء لـ getPartyState) هو
//  المرحلة 2 التالية، عشان كل مرحلة تتسلّم وتتراجع عنها لوحدها لو
//  احتاج الأمر، من غير ما تكسر فورمات شغالة فعليًا دلوقتي.
// ══════════════════════════════════════════════════════════════

import type { PartyFieldValue } from './partyTypes';

// ── الحالات الخمسة (تحديث مراجعة رابعة — 5 حالات مش 4) ──────────
//
// PRIMARY_CLIENT : الطرف ده هو الموكل الأساسي بتاع القضية/الجلسة
//                  (client_id == primaryClientId)، والموكل لسه حي.
//                  ده اللي كان بيتسمّى "isLinked" على مستوى القضية.
// ORPHAN         : نفس الطرف الأساسي فوق، لكن الموكل اتحذف (soft-delete)
//                  أو مش مرئي للمستخدم الحالي. ده اللي كان بيتسمّى
//                  "isOrphaned" على مستوى القضية/الجلسة القديم.
// LINKED         : طرف *ثانوي* (مش الموكل الأساسي) اتربط بموكل حقيقي
//                  لسه حي — عن طريق دروب-داون "ربط بموكل من النظام".
// ORPHAN_PARTY   : نفس الطرف الثانوي فوق، لكن الموكل المربوط بيه اتحذف.
//                  دي الحالة اللي كانت ناقصة (باگ 5.1 — dead-end): طرف
//                  ثانوي orphan كان بيفضل مقفول بلا زرار unlink/فتح ملف/
//                  إنشاء موكل جديد، لأن الكود القديم كان بيفحص
//                  `!!party.client_id` بس من غير تفرقة عن ORPHAN.
// MANUAL         : بيانات حرة مكتوبة يدويًا — client_id فاضي (null).
export type PartyLinkState = 'MANUAL' | 'LINKED' | 'ORPHAN_PARTY' | 'ORPHAN' | 'PRIMARY_CLIENT';

// شكل مبسّط للموكل — بيقبل ClientRow الكامل أو أي كائن فيه id بس، عشان
// السيرفس ميحتاجش يستورد نوع الموكل الكامل من مكان تاني.
export interface MinimalClient {
    id: string;
}

export interface PartyDomainContext {
    // معرف الموكل الأساسي المرتبط بالقضية/الجلسة نفسها (cases.client_id
    // أو case_sessions.client_id) — null لو مفيش ربط أساسي أصلًا.
    primaryClientId: string | null;
    // ⚠️ قائمة الموكلين المتاحة *للمستخدم الحالي تحديدًا* — لازم تكون
    // نفس الـquery/RLS اللي الفورم بيستخدمها لعرض دروب-داون "ربط بموكل
    // من النظام" (نفس ملاحظة المراجعة في التقرير، قسم "صلاحيات/RLS"):
    // لو محامي تاني في المكتب مالوش صلاحية يشوف موكل معيّن، هيرجّع
    // ORPHAN_PARTY/ORPHAN مع إن الموكل حي فعليًا وبس مش ظاهر للمستخدم
    // ده. الفرق بين الحالتين ("orphan حقيقي" و"orphan بسبب صلاحيات") مش
    // متاح للسيرفس ده يفرّقه من نفسه دلوقتي — القرار اتسيب للمرحلة اللي
    // بعدها لو احتاج الأمر توضيح إضافي في الرسالة المعروضة للمستخدم.
    clients: MinimalClient[];
}

/**
 * الحالة الموحّدة لطرف واحد — بديل مباشر لـ `!!party.client_id`.
 */
export function getPartyState(party: Pick<PartyFieldValue, 'client_id'>, ctx: PartyDomainContext): PartyLinkState {
    if (!party.client_id) return 'MANUAL';
    const clientExists = ctx.clients.some((c) => c.id === party.client_id);
    const isPrimary = ctx.primaryClientId !== null && party.client_id === ctx.primaryClientId;
    if (isPrimary) return clientExists ? 'PRIMARY_CLIENT' : 'ORPHAN';
    return clientExists ? 'LINKED' : 'ORPHAN_PARTY';
}

// الحالة دي بتعتبر "مربوطة فعليًا بموكل حي" (بغض النظر لو أساسي أو ثانوي).
export function isLinkedState(state: PartyLinkState): boolean {
    return state === 'LINKED' || state === 'PRIMARY_CLIENT';
}

// الحالة دي "orphan" — client_id موجود لكن الموكل مش موجود/مش مرئي.
export function isOrphanState(state: PartyLinkState): boolean {
    return state === 'ORPHAN' || state === 'ORPHAN_PARTY';
}

/** اختصار مباشر — نفس getPartyState لكن بيرجع boolean بس (isOrphaned). */
export function isPartyOrphaned(party: Pick<PartyFieldValue, 'client_id'>, ctx: PartyDomainContext): boolean {
    return isOrphanState(getPartyState(party, ctx));
}

// ── قواعد الصلاحيات (canX) — كل واحدة مبنية على الحالة الموحّدة ────

/**
 * حقول بيانات الطرف الشخصية (الاسم/الرقم القومي/العنوان/التوكيل) —
 * بتتقفل (readOnly) بس لو الطرف مربوط فعليًا بموكل حي. طرف orphan
 * (سواء أساسي أو ثانوي) بياناته بترجع قابلة للتعديل الحر — نفس مبدأ
 * "آخر ما هو معروف عن الموكل" اللي كان مطبّق بالفعل على مستوى القضية،
 * ودلوقتي بيتطبّق بشكل متسق على أي طرف مهما كان مستواه.
 */
export function canEditPartyFields(state: PartyLinkState): boolean {
    return !isLinkedState(state);
}

/**
 * تبديل "موكلنا" (⭐) — ممنوع لأي طرف مربوط فعليًا بموكل حي (لازم فك
 * الربط الأول عشان ميتخلقش "primary" جديد بدون فك ربط العميل الموجود).
 * مسموح لطرف orphan (فك الربط بقى ممكن مباشرة، مش لازم تفعيل/تعطيل
 * "موكلنا" أولًا).
 */
export function canToggleIsClient(state: PartyLinkState): boolean {
    return !isLinkedState(state);
}

/**
 * فك الربط (unlink) — متاح لأي طرف عنده client_id، سواء لسه حي
 * (LINKED/PRIMARY_CLIENT) أو orphan (ORPHAN/ORPHAN_PARTY). ده تحديدًا
 * الإصلاح لباگ 5.1 (dead-end): قبل كده الكود كان بيوقف عرض أي زرار فك
 * ربط لو `linkedPartyClient` (نتيجة البحث في clients) كانت undefined،
 * فطرف ثانوي orphan كان بيفضل مقفول بلا أي مخرج.
 */
export function canUnlinkParty(state: PartyLinkState): boolean {
    return state !== 'MANUAL';
}

/**
 * زرار "إنشاء موكل جديد من هذه البيانات" — بيظهر لطرف من غير ربط حي:
 * MANUAL (بيانات يدوية من الأساس) أو ORPHAN_PARTY (الموكل القديم اتمسح،
 * فمعقول نعرض نفس اختيار الطرف اليدوي بدل الـdead-end).
 *
 * ⚠️ ORPHAN (الطرف الأساسي) مستثنى عمدًا: ربط/فك ربط الموكل الأساسي
 * بتاع القضية/الجلسة نفسها بيتم من تاب بيانات القضية (InfoSection)،
 * مش من داخل كارت الطرف — نفس القرار المعماري الموجود بالفعل في
 * renderPartyExtra الحالي (بيستثني linkedPartyId من سلوت الربط).
 */
export function canCreateNewClientFromParty(state: PartyLinkState): boolean {
    return state === 'MANUAL' || state === 'ORPHAN_PARTY';
}

/**
 * نص توضيحي بيتعرض للمستخدم يشرح سبب حالة الطرف — بديل موحّد لكل
 * التوستات/النصوص المتفرقة اللي كانت مكتوبة يدويًا في كل ملف على حدة.
 * null لو الطرف MANUAL (مفيش حاجة تتوضح).
 */
export function getPartyStateMessage(state: PartyLinkState): string | null {
    switch (state) {
        case 'PRIMARY_CLIENT':
        case 'LINKED':
            return 'مربوط بموكل من النظام — بيانات الطرف ده بتتقرا من ملف الموكل';
        case 'ORPHAN':
        case 'ORPHAN_PARTY':
            return 'الموكل المربوط بالطرف ده اتحذف — البيانات دي آخر ما هو معروف عنه، وبقت قابلة للتعديل الحر';
        case 'MANUAL':
        default:
            return null;
    }
}

// ── Badges/UI (خطة توحيد قفل الطرف — المرحلة 3، 6 أغسطس 2026) ────
//
// شكل موحّد لعرض حالة الطرف بصريًا (نقطة لونية + نص قصير) — مصدر
// حقيقة واحد لأي مكان محتاج يعرض الحالة (كارت الشخص PartyFields.tsx،
// الكارت المطوي PartySideCard.tsx، هيدر القضية CaseDetailView.tsx،
// وعرض الجلسة المستقلة القرائي StandaloneSessionDetailModal.tsx) —
// بدل ما كل مكان يبني ألوان/نصوص خاصة بيه ويختلف عن التاني بمرور الوقت.
export interface PartyStateBadge {
    emoji: string;
    label: string;
    // كلاسات Tailwind لخلفية/حد/نص شارة صغيرة (pill)
    className: string;
}

/** null لـ MANUAL (بيانات يدوية بحتة — مفيش حاجة تتعرض). */
export function getPartyStateBadge(state: PartyLinkState): PartyStateBadge | null {
    switch (state) {
        case 'PRIMARY_CLIENT':
            return { emoji: '🟢', label: 'موكل المكتب', className: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' };
        case 'LINKED':
            return { emoji: '🔵', label: 'مربوط بموكل', className: 'text-sky-400 bg-sky-500/10 border-sky-500/20' };
        case 'ORPHAN':
            return { emoji: '🟠', label: 'موكل محذوف', className: 'text-amber-400 bg-amber-500/10 border-amber-500/20' };
        case 'ORPHAN_PARTY':
            return { emoji: '🟣', label: 'موكل محذوف', className: 'text-violet-400 bg-violet-500/10 border-violet-500/20' };
        case 'MANUAL':
        default:
            return null;
    }
}

// ── دالة مساعدة عامة لمستوى القضية/الجلسة (مش الطرف) ────────────
//
// الهيدر (CaseDetailView.tsx) وتاب البيانات (InfoSection.tsx) معاهم
// client_id + كائن الموكل نفسه (linkedClient واحد اتجاب مسبقًا من
// الأب) — مش قائمة clients كاملة زي getPartyState فوق. نفس القاعدة
// (client_id موجود + الموكل مش موجود = orphan) لكن بشكل مباشر بدون
// الحاجة لبناء PartyDomainContext كامل لكل نداء.
export function isOrphanedLink(clientId: string | null | undefined, linkedClient: unknown | null | undefined): boolean {
    return !!clientId && !linkedClient;
}
