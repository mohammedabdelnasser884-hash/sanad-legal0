// ══════════════════════════════════════════════════════════════
//  casePartiesValidation — قواعد فاليديشن موحّدة لأطراف القضية/الجلسة
//  المستقلة (case_parties)، مطابقة حرفيًا لقسم 4 ("فاليديشن وقت الحفظ")
//  وقسم 7-أ ("تكرار الرقم القومي") من خطة تعدد الأطراف. بتُستخدم من
//  usePartyFields.ts (فاليديشن الفورم لحظة بلحظة)، ولاحقًا (مراحل 4-6)
//  من فاليديشن السيرفر المكرر المطلوب في قسم 7-ج.
//  خطة تعدد الأطراف — مرحلة 3 (22 يوليو 2026).
//
//  🆕 تحديث (مرحلة 2 من خطة "المسمى القانوني" — 23 يوليو 2026):
//  إضافة قاعدة 6 — إلزامية "المسمى القانوني" عند وجود شخصين فأكثر تحت
//  نفس الطرف (بند 2-ب من خطة "المسمى القانوني"). المسمى القانوني مخزّن
//  على مستوى القضية/الجلسة نفسها (عمودي plaintiff_legal_title/
//  defendant_legal_title المضافين في المرحلة 1)، مش داخل كل صف طرف —
//  لذلك بيتبعت لدالة الفحص كـ parameter منفصل، مش جزء من array الأطراف.
//  ⚠️ الربط الفعلي لقيمة المسمى القانوني بحقل إدخال في الفورم لسه مؤجل
//  لمرحلة 3 ("إدخال البيانات في النماذج") — الدالة هنا جاهزة ومفعّلة،
//  بس usePartyFields.ts لسه بينادها من غير تمرير legalTitles (بترجع
//  '' افتراضيًا لحد ما الحقل يتربط في الفورم فعليًا).
// ══════════════════════════════════════════════════════════════

import { validateFullNameParts } from './clientValidation';
import type { PartyFieldValue } from '../parties/partyTypes';

const NATIONAL_ID_LEN = 14;

export interface PartyValidationError {
    // partyId فاضي ('') للأخطاء العامة اللي مش خاصة بطرف بعينه (زي "محدش
    // موكل المكتب"، أو "المسمى القانوني ناقص لطرف كامل") — بتتفلتر
    // بـ partyId==='' في مكان العرض.
    partyId: string;
    field: 'name' | 'capacity' | 'national_id' | 'legal_title';
    message: string;
}

export interface PartiesValidationResult {
    valid: boolean;
    errors: PartyValidationError[];
    // أول رسالة بالترتيب — جاهزة تتحط في toast() واحد زي باقي فورمات
    // القضايا/الجلسات الحالية (toast(msg, true)).
    message?: string;
}

// المسمى القانوني الجامع لكل جهة — مخزّن على مستوى القضية/الجلسة نفسها
// (مش جوه array الأطراف)، فبيتبعت منفصل عن parties.
export interface PartyLegalTitles {
    plaintiff: string;
    defendant: string;
}

const SIDE_LABEL_AR: Record<'plaintiff' | 'defendant', string> = {
    plaintiff: 'الطرف الأول (المدعي)',
    defendant: 'الطرف الثاني (المدعى عليه)',
};

/**
 * يتحقق من array الأطراف بالكامل (مدعين + مدعى عليهم مع بعض) قبل الحفظ.
 * القواعد بالترتيب (قسم 4 من خطة تعدد الأطراف، + قاعدة 6 من خطة المسمى
 * القانوني):
 * 1. الاسم والصفة إجباريين لكل طرف دايمًا.
 * 2. الرقم القومي إجباري (14 رقم بالظبط) بس لو is_client=true؛ لو اتكتب
 *    لطرف مش موكل، برضو لازم يكون 14 رقم بالظبط (فحص صيغة، مش إجبار).
 * 3. اسم أي طرف "مدعى عليه" مش موكل بيتبع فحص الاسم الثلاثي (نفس فحص
 *    الخصم الحالي) — موكلين المكتب (من أي جهة) مستثنين من الشرط ده.
 * 4. لازم طرف واحد على الأقل (في أي الجهتين) يكون is_client=true.
 * 5. ممنوع تكرار نفس الرقم القومي بين طرفين في نفس القضية/الجلسة (قسم 7-أ
 *    — منع تام، مفيش تجاوز/تأكيد).
 * 6. 🆕 لو جهة معينة (مدعي أو مدعى عليه) فيها شخصان فأكثر، المسمى
 *    القانوني الجامع لهذه الجهة (legalTitles.plaintiff/defendant)
 *    إجباري ولازم يكون مكتوب (مش فاضي).
 */
export function validateParties(
    parties: PartyFieldValue[],
    legalTitles: PartyLegalTitles = { plaintiff: '', defendant: '' },
): PartiesValidationResult {
    const errors: PartyValidationError[] = [];

    for (const p of parties) {
        if (!p.name.trim()) {
            errors.push({ partyId: p.id, field: 'name', message: '⚠️ اسم الطرف مطلوب' });
        }
        if (!p.capacity.trim()) {
            errors.push({ partyId: p.id, field: 'capacity', message: '⚠️ صفة الطرف مطلوبة' });
        }

        if (p.is_client) {
            if (p.national_id.length !== NATIONAL_ID_LEN) {
                errors.push({ partyId: p.id, field: 'national_id', message: '⚠️ الرقم القومي لموكل المكتب مطلوب ولازم يكون 14 رقم بالظبط' });
            }
        } else if (p.national_id && p.national_id.length !== NATIONAL_ID_LEN) {
            errors.push({ partyId: p.id, field: 'national_id', message: '⚠️ الرقم القومي لازم يكون 14 رقم بالظبط لو اتكتب' });
        }

        // فحص الاسم الثلاثي: مدعى عليه مش موكل بس (نفس نطاق فحص الخصم
        // الحالي في NewCaseModal/EditCaseModal/فورمات الجلسة المستقلة).
        if (p.side === 'defendant' && !p.is_client && p.name.trim()) {
            const nameErr = validateFullNameParts(p.name);
            if (nameErr) {
                errors.push({ partyId: p.id, field: 'name', message: '⚠️ اسم الطرف لازم يكون ثلاثي على الأقل (الاسم الأول، الأب، الجد)' });
            }
        }
    }

    if (!parties.some((p) => p.is_client)) {
        errors.push({ partyId: '', field: 'name', message: '⚠️ لازم تحدد طرف واحد على الأقل كـ"موكلنا" (اضغط ⭐)' });
    }

    // منع تكرار الرقم القومي جوه نفس القضية/الجلسة — أول ظهور بيعدي، أي
    // تكرار بعده بياخد خطأ (على الطرف المكرر، مش الأصلي).
    const seen = new Set<string>();
    for (const p of parties) {
        const nid = p.national_id.trim();
        if (!nid) continue;
        if (seen.has(nid)) {
            errors.push({ partyId: p.id, field: 'national_id', message: '⚠️ نفس الرقم القومي مكرر بين طرفين في نفس القضية — لازم يتصحح قبل الحفظ' });
        } else {
            seen.add(nid);
        }
    }

    // 🆕 قاعدة 6 — المسمى القانوني إجباري لو الجهة فيها شخصان فأكثر.
    (['plaintiff', 'defendant'] as const).forEach((side) => {
        const countOnSide = parties.filter((p) => p.side === side).length;
        if (countOnSide >= 2 && !legalTitles[side].trim()) {
            errors.push({
                partyId: '',
                field: 'legal_title',
                message: `⚠️ ${SIDE_LABEL_AR[side]} فيه أكثر من شخص — لازم تكتب "المسمى القانوني" الجامع لهذا الطرف`,
            });
        }
    });

    return { valid: errors.length === 0, errors, message: errors[0]?.message };
}

