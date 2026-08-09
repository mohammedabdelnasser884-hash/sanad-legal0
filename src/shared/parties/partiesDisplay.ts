// ══════════════════════════════════════════════════════════════
//  partiesDisplay — طبقة العرض القرائي (خطة تفكيك الأعمدة القديمة،
//  المرحلة B.1، 6 أغسطس 2026).
//
//  دالة واحدة تبني نص "المدعي ضد المدعى عليه" لعرض مختصر (كارت الجلسة/
//  التقويم/الداشبورد) من صفوف case_parties الفعلية بدل قراءة عمودي
//  plaintiff/defendant القديمين مباشرة — نفس فكرة buildPartyLines في
//  supabase/functions/session-alerts/index.ts (رسالة تيليجرام الكاملة)
//  لكن لعرض واجهة سطر واحد مختصر. لو مفيش صفوف case_parties خالص (قضية/
//  جلسة قديمة قبل مرحلة تعدد الأطراف)، بترجع للأعمدة القديمة تلقائيًا —
//  صفر تغيير سلوك لأي بيانات قديمة.
// ══════════════════════════════════════════════════════════════

import { effectiveLegalTitleForDisplay } from './partyDisplay';

export interface PartyDisplayRow {
    side: string | null;
    name: string | null;
    capacity?: string | null;
    client_id?: string | null;
}

export interface LegacyPartiesFallback {
    plaintiff?: string | null;
    defendant?: string | null;
    plaintiffLegalTitle?: string | null;
    defendantLegalTitle?: string | null;
}

export interface PartiesDisplayResult {
    plaintiff: string | null;
    defendant: string | null;
}

// طرف واحد → اسمه زي ما هو. أكتر من طرف على نفس الجهة → "الاسم الأول وآخرون"
// (نفس المبدأ المختصر المستخدم في نصوص الواجهة التانية، بدون تعداد الكل
// عشان السطر يفضل قابل للعرض في كارت صغير).
function buildSideLabel(names: string[]): string | null {
    if (names.length === 0) return null;
    if (names.length === 1) return names[0];
    return `${names[0]} وآخرون`;
}

/**
 * بيرجع { plaintiff, defendant } — نص واحد جاهز للعرض لكل جهة. كل جهة
 * بتُحسب لوحدها: لو عندها صفوف case_parties فعلية بيتبنى منها نص، وإلا
 * بترجع لنفس الجهة من legacy (المسمى القانوني أولاً، بعدين الاسم المفرد).
 */
export function derivePartiesDisplay(
    parties: PartyDisplayRow[] | null | undefined,
    fallback: LegacyPartiesFallback
): PartiesDisplayResult {
    const rows = (parties || []).filter((p) => !!p.name);
    const plaintiffNames = rows.filter((p) => p.side === 'plaintiff').map((p) => p.name as string);
    const defendantNames = rows.filter((p) => p.side === 'defendant').map((p) => p.name as string);

    // ⚡ FIX (توحيد المسمى القانوني الجامع — 8 أغسطس 2026): بيتفعّل بس لو
    // مفيش case_parties خالص (buildSideLabel رجعت null) — لو موجودة، الاسم
    // الحقيقي (buildSideLabel) بياخد الأولوية دايمًا وده مش بيتأثر بالمشكلة.
    // effectiveLegalTitleForDisplay بترجع '' لصفة عامة بس (زي "متهمين")
    // عشان مايحلّش محل fallback.plaintiff فجأة بلا داعي.
    const plaintiff = buildSideLabel(plaintiffNames) ?? (effectiveLegalTitleForDisplay(fallback.plaintiffLegalTitle) || fallback.plaintiff || null);
    const defendant = buildSideLabel(defendantNames) ?? (effectiveLegalTitleForDisplay(fallback.defendantLegalTitle) || fallback.defendant || null);

    return { plaintiff, defendant };
}

/** اختصار: نص سطر واحد جاهز مباشرة ("فلان ضد علان") لأماكن العرض المختصرة
 * (فولباك عنوان الكارت في MissedTab/UpcomingWidget/UpcomingSessionsList).
 * null لو مفيش أي طرف خالص (لا case_parties ولا legacy). */
export function derivePartiesLine(
    parties: PartyDisplayRow[] | null | undefined,
    fallback: LegacyPartiesFallback
): string | null {
    const { plaintiff, defendant } = derivePartiesDisplay(parties, fallback);
    if (plaintiff && defendant) return `${plaintiff} ضد ${defendant}`;
    return plaintiff || defendant || null;
}
