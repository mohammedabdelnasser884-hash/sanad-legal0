// ══════════════════════════════════════════════════════════════
//  partyTypes — الشكل المشترك لـ"طرف" واحد في القضية/الجلسة المستقلة
//  (مدعي أو مدعى عليه)، مطابق لتصميم جدول case_parties (قسم 3 من خطة
//  تعدد الأطراف)، بس بشكل جاهز للاستخدام في state الفورم قبل الحفظ —
//  الأعمدة اللي بتتحدد تلقائيًا وقت الحفظ (tenant_id, case_id/session_id,
//  sort_order, created_at, updated_at) مش موجودة هنا، هتتضاف وقت
//  الربط بالحفظ الحقيقي (مراحل 4-6).
//  خطة تعدد الأطراف — مرحلة 3 (22 يوليو 2026).
// ══════════════════════════════════════════════════════════════

export type PartySide = 'plaintiff' | 'defendant';

export interface PartyFieldValue {
    // id محلي للفورم بس (مش UUID الداتابيز بالضرورة) — بيسمح بـ upsert-by-id
    // (قسم 7-ج من الخطة) لو الطرف ده أصلاً موجود في case_parties (تعديل)،
    // أو id مؤقت (party-...) لو طرف جديد لسه ملموش صف في الداتابيز.
    id: string;
    side: PartySide;
    // ⭐ هل هو موكل المكتب فعليًا؟ — مستقل عن side، ممكن يتفعّل لأكتر من
    // طرف في نفس الوقت (قسم 2 من الخطة).
    is_client: boolean;
    name: string;
    capacity: string;
    national_id: string;
    address: string;
    power_of_attorney: string;
    // لو الطرف اتربط بموكل من النظام (فورمات لاحقة، مش جزء من مرحلة 3) —
    // null لو لسه بيانات حرة مكتوبة يدويًا.
    client_id: string | null;
    // 🆕 (خطة توحيد "ربط طرف بموكل موجود" — مرحلة 2، 6 أغسطس 2026): قيمة
    // case_parties.updated_at كما جاية من الداتابيز وقت تحميل الفورم —
    // مستخدمة كـknownUpdatedAt للقفل التفاؤلي (safeUpdate/window.__dbWrite)
    // وقت أي UPDATE لاحق على الصف ده (syncCaseParties/syncSessionParties).
    // undefined = مفيش نظير حقيقي في case_parties لسه (طرف legacy-*/party-*
    // جديد لسه ما اتحفظش، هيبقى INSERT مش UPDATE أصلاً). null = طرف حقيقي
    // بس القيمة مش متاحة لأي سبب (fallback آمن: يتجاهل الفحص زي أي مكان
    // تاني في المشروع بيستخدم knownUpdatedAt).
    updated_at?: string | null;
}

export function createEmptyParty(side: PartySide, id: string): PartyFieldValue {
    return {
        id,
        side,
        is_client: false,
        name: '',
        capacity: '',
        national_id: '',
        address: '',
        power_of_attorney: '',
        client_id: null,
    };
}
