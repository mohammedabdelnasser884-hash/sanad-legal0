// ══════════════════════════════════════════════════════════════
//  clientValidation — نقطة تحقق موحّدة تُستخدم قبل أي INSERT لجدول
//  clients، من أي مكان في التطبيق بيضيف موكل جديد (قسم الموكلين
//  مباشرة / الجلسة المستقلة / داخل القضية). الهدف: نفس القواعد بالظبط
//  في كل الأماكن التلاتة، بدل ما كل مكان يعمل تحقق مختلف بنفسه.
// ══════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';
import { parsePoaString } from '../ui/PoaInput';

/**
 * يتحقق إن الاسم "ثنائي" على الأقل (اسم أول + اسم تاني)، مش كلمة واحدة بس.
 * @returns null لو سليم، أو رسالة خطأ بالعربي لو الاسم كلمة واحدة بس
 */
export function validateFullNameParts(name: string): string | null {
    const trimmed = (name || '').trim();
    if (!trimmed) return null; // فحص "الحقل فاضي" مسؤولية الفورم نفسه، مش هنا
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length < 2) return '⚠️ الاسم لازم يكون ثنائي على الأقل (اسم أول واسم تاني)';
    return null;
}

// ── هروب آمن لقيمة داخل .ilike() جوه .or() بتاع PostgREST ──
// (نفس منطق ilikeOrClause في sanitize.ts، بس من غير % — مطابقة تامة
// case-insensitive، مش "يحتوي على")
function exactIlikeClause(column: string, term: string): string {
    const escaped = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${column}.ilike."${escaped}"`;
}

// ── نمط SQL للبحث عن توكيلات بنفس رقم/حرف/سنة (بغض النظر عن مكتب
// التوثيق) — % في الآخر بتاعة LIKE عادية، مش جزء من الهروب ──
function poaPrefixClause(column: string, number: string, letters: string, year: string): string {
    const prefix = `${number}/${letters}/${year}/`;
    const escaped = prefix.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${column}.ilike."${escaped}%"`;
}

export interface ClientDuplicateCheckResult {
    duplicate: boolean;
    message?: string;
    // ⚡ NEW (19 يوليو 2026): الموكل المطابق نفسه (id + full_name) — بيسمح
    // للمكان اللي بينده الفحص (قضية/جلسة مستقلة) يعرض زرار "ربط الآن" على
    // طول بدل ما يرمي المستخدم يدوّر عليه يدويًا في قايمة الموكلين.
    // بيتحدد بأول سطر مطابق فعليًا (أي سبب مطابقة) — في الاستخدام الواقعي
    // (منع تكرار وقت الإنشاء) بيكون سطر واحد غالبًا.
    client?: { id: string; full_name: string | null };
}

/**
 * يتحقق من عدم وجود موكل مسجل بنفس الاسم، أو نفس الرقم القومي، أو نفس
 * توكيل قبل كده (نفس المكتب — RLS بيقصر النتيجة تلقائيًا زي أي كويري
 * تانية على clients).
 * ⚠️ تكرار رقم التوكيل بيتحدد بمطابقة "الرقم + الحرف + السنة" تمامًا مع
 * بعض بس — مكتب التوثيق مش داخل في المقارنة خالص (ممكن يتكرر عادي)،
 * وأي اختلاف في الرقم أو الحرف أو السنة يخليه مش مكرر.
 * @param excludeClientId لو التحقق أثناء تعديل موكل موجود بالفعل — بنستبعد
 *   سطره هو نفسه من المقارنة عشان الدالة تشتغل صح في وضع "تعديل" كمان.
 */
export async function checkClientDuplicate(
    db: SupabaseClient<Database>,
    params: { full_name?: string | null; national_id?: string | null; cr_number?: string | null },
    excludeClientId?: string | null
): Promise<ClientDuplicateCheckResult> {
    const name = (params.full_name || '').trim();
    const nationalId = (params.national_id || '').trim();
    const poaRaw = (params.cr_number || '').trim();
    const poaParts = poaRaw ? parsePoaString(poaRaw) : null;
    // ⚠️ لو التوكيل متسجل بصيغة قديمة حرة (parsePoaString بترجع الرقم/الحرف/
    // السنة فاضيين وتحط كل النص في "office") — مفيش أساس منظّم نقارن عليه،
    // فبنتجاهل فحص التوكيل في الحالة دي بدل ما نقارن نص حر بنص حر بالغلط.
    const poaHasStructured = !!poaParts && !!(poaParts.number || poaParts.letters || poaParts.year);
    if (!name && !nationalId && !poaHasStructured) return { duplicate: false };

    const orParts: string[] = [];
    if (nationalId) orParts.push(`national_id.eq.${nationalId}`); // أرقام فقط بالفعل (onlyDigits) — آمن من غير هروب
    if (name) orParts.push(exactIlikeClause('full_name', name));
    if (poaHasStructured) orParts.push(poaPrefixClause('cr_number', poaParts!.number, poaParts!.letters, poaParts!.year));
    if (orParts.length === 0) return { duplicate: false };

    let query = db.from('clients').select('id,full_name,national_id,cr_number').or(orParts.join(','));
    if (excludeClientId) query = query.neq('id', excludeClientId);
    const { data } = await query;
    if (!data || data.length === 0) return { duplicate: false };

    // ⚡ NEW: بدل ما نحسب nameMatch/idMatch/poaMatch كـ boolean عام بس
    // (data.some)، بنحسبهم *لكل سطر* عشان نقدر نحدد بالظبط مين هو الموكل
    // المطابق نفسه (مش بس "فيه تطابق")، ونرجّعه في الناتج.
    const rowMatch = (c: { full_name: string | null; national_id: string | null; cr_number: string | null }) => {
        const rowNameMatch = !!name && (c.full_name || '').trim().toLowerCase() === name.toLowerCase();
        const rowIdMatch = !!nationalId && (c.national_id || '').trim() === nationalId;
        // مقارنة نهائية في الكود نفسه (مش SQL بس) — رقم + حرف + سنة بالظبط،
        // مكتب التوثيق مستبعد تمامًا من المقارنة.
        const cParts = poaHasStructured ? parsePoaString(c.cr_number) : null;
        const rowPoaMatch = poaHasStructured && !!cParts &&
            cParts.number === poaParts!.number && cParts.letters === poaParts!.letters && cParts.year === poaParts!.year;
        return { rowNameMatch, rowIdMatch, rowPoaMatch };
    };

    const nameMatch = !!name && data.some((c) => rowMatch(c).rowNameMatch);
    const idMatch = !!nationalId && data.some((c) => rowMatch(c).rowIdMatch);
    const poaMatch = poaHasStructured && data.some((c) => rowMatch(c).rowPoaMatch);

    const matchedLabels: string[] = [];
    if (nameMatch) matchedLabels.push('الاسم');
    if (idMatch) matchedLabels.push('الرقم القومي');
    if (poaMatch) matchedLabels.push('رقم التوكيل');
    if (matchedLabels.length === 0) return { duplicate: false };

    // أول سطر بيطابق أي سبب من التلاتة — ده اللي هنرجعه كـ"الموكل المطابق"
    // عشان اللي بينده الفحص يقدر يعرض زرار ربط بيه مباشرة.
    const matchedRow = data.find((c) => {
        const m = rowMatch(c);
        return m.rowNameMatch || m.rowIdMatch || m.rowPoaMatch;
    });
    const client = matchedRow ? { id: matchedRow.id, full_name: matchedRow.full_name } : undefined;

    if (matchedLabels.length === 1) {
        return { duplicate: true, message: `⚠️ ${matchedLabels[0]} موجود بالفعل لموكل مسجل من قبل`, client };
    }
    return { duplicate: true, message: `⚠️ ${matchedLabels.join(' و')} مسجلين بالفعل لموكل موجود من قبل`, client };
}
