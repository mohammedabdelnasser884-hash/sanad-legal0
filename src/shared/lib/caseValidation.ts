// ══════════════════════════════════════════════════════════════
//  caseValidation — فحص تكرار رقم القضية قبل أي INSERT/UPDATE لجدول
//  cases. نفس نمط checkClientDuplicate في clientValidation.ts —
//  راجع تقرير المراجعة (نتيجة 2): مفيش أي فحص فعلي كان موجود قبل كده،
//  رغم إن البريف الأصلي وصف الموضوع بـ"Solved" غلط.
// ══════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../database.types';

// ── هروب آمن لقيمة داخل .ilike() — نفس الهيلبر المستخدم في clientValidation.ts ──
function exactIlikeClause(column: string, term: string): string {
    const escaped = term.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `${column}.ilike."${escaped}"`;
}

export interface CaseNumberDuplicateCheckResult {
    duplicate: boolean;
    message?: string;
    // القضية المطابقة نفسها — بيسمح للمكان اللي بينده الفحص يعرض تفاصيلها
    // (مثلاً "الرقم ده مسجل بالفعل لقضية: ...") بدل رسالة عامة بس.
    case?: { id: string; title: string | null };
}

// مقارنة نصية case-insensitive، بتعامل null/undefined/فاضي كنفس القيمة —
// عشان قضيتين من غير محكمة/نوع متسجل (فاضي) يتحسبوا "نفس القيمة" مع بعض
// بدل ما يتفلتوا من المطابقة بسبب null.
const norm = (v: string | null | undefined): string => (v || '').trim().toLowerCase();

/**
 * يتحقق من عدم وجود قضية مسجلة بنفس رقم القيد الرسمي (case_number_official)
 * *و* نفس المحكمة (court_level) *و* نفس نوع الدعوى (case_type) مع بعض —
 * الأربعة (رقم + سنة، ومتضمنين في case_number_official + محكمة + نوع) لازم
 * يتطابقوا كلهم عشان يتحسبوا تكرار حقيقي. قرار متعمد (تصحيح لاحق): رقم قيد
 * واحد ممكن يتكرر بشكل شرعي لو المحكمة أو نوع الدعوى مختلف — رقمين قضية
 * منفصلتين تمامًا ممكن يتصادفوا بنفس الرقم في محكمتين/نوعين مختلفين، وده
 * مش تكرار حقيقي. مطابقة case-insensitive، نفس مكتب المستخدم (RLS بيقصر
 * النتيجة تلقائيًا)، ومستبعد منها القضايا المؤرشفة (deleted_at) عشان رقم
 * قيد قديم لقضية اتأرشفت يقدر يتسجل تاني من غير ما يترفض بالغلط.
 * @param excludeCaseId لو التحقق أثناء تعديل قضية موجودة بالفعل — بنستبعد
 *   سطرها هي نفسها من المقارنة عشان الدالة تشتغل صح في وضع "تعديل" كمان.
 */
export async function checkCaseNumberDuplicate(
    db: SupabaseClient<Database>,
    caseNumberOfficial: string | null | undefined,
    courtLevel: string | null | undefined,
    caseType: string | null | undefined,
    excludeCaseId?: string | null
): Promise<CaseNumberDuplicateCheckResult> {
    const number = (caseNumberOfficial || '').trim();
    if (!number) return { duplicate: false };

    let query = db.from('cases')
        .select('id,title,case_number_official,court_level,case_type')
        .is('deleted_at', null)
        .or(exactIlikeClause('case_number_official', number));
    if (excludeCaseId) query = query.neq('id', excludeCaseId);
    const { data } = await query;
    if (!data || data.length === 0) return { duplicate: false };

    const targetCourt = norm(courtLevel);
    const targetType = norm(caseType);

    const matchedRow = data.find(
        (c) =>
            norm(c.case_number_official) === number.toLowerCase() &&
            norm(c.court_level) === targetCourt &&
            norm(c.case_type) === targetType
    );
    if (!matchedRow) return { duplicate: false };

    return {
        duplicate: true,
        message: `⚠️ رقم القيد "${number}" مسجل بالفعل لقضية بنفس المحكمة والنوع: ${matchedRow.title || 'بدون عنوان'}`,
        case: { id: matchedRow.id, title: matchedRow.title },
    };
}
