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
//
//  🆕 تحديث (طلب "تفرقة اسم الطرف الأول عن الخصم" — 1 أغسطس 2026):
//  فحص "الاسم الثلاثي" اتقسم لقاعدتين مختلفتين بدل قاعدة واحدة كانت
//  مقصورة على المدعى عليه بس:
//  - الطرف الأول (المدعي/الطاعن): الاسم الثلاثي بقى **إلزامي** دايمًا
//    (خطأ مانع للحفظ) — بغض النظر عن is_client.
//  - الطرف الثاني (الخصم) اللي مش موكل المكتب: يكفي اسم **ثنائي** كحد
//    أدنى (خطأ مانع لو أقل من كده)، عشان ممكن يكون جهة اعتبارية زي
//    "النيابة العامة". لو الاسم ثنائي بالظبط (مش ثلاثي أو أكتر)، بيطلع
//    **تحذير غير مانع** (warning، مش error) يقول إن الأفضل تسجيله ثلاثي
//    أو رباعي لتجنب تعارض البيانات مستقبلاً — من غير ما يمنع الحفظ.
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

// 🆕 نفس شكل PartyValidationError بالظبط — بس للتنبيهات غير المانعة
// (زي "يفضل اسم الخصم يكون ثلاثي")، ما بتأثرش على valid ولا بتمنع الحفظ.
export type PartyValidationWarning = PartyValidationError;

export interface PartiesValidationResult {
    valid: boolean;
    errors: PartyValidationError[];
    // 🆕 تنبيهات إرشادية غير مانعة — مش بتأثر على valid خالص.
    warnings: PartyValidationWarning[];
    // أول رسالة بالترتيب — جاهزة تتحط في toast() واحد زي باقي فورمات
    // القضايا/الجلسات الحالية (toast(msg, true)).
    message?: string;
}

// أقل عدد "كلمات" مقبول لاسم الخصم (الطرف الثاني) مش موكل المكتب — ثنائي
// عادي يكفي كحد أدنى إجباري (زي "النيابة العامة").
const DEFENDANT_MIN_NAME_PARTS = 2;

function countNameParts(name: string): number {
    return name.trim().split(/\s+/).filter(Boolean).length;
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
 * القانوني، + تحديث "تفرقة اسم الطرف الأول عن الخصم"):
 * 1. الاسم والصفة إجباريين لكل طرف دايمًا.
 * 2. الرقم القومي إجباري (14 رقم بالظبط) بس لو is_client=true؛ لو اتكتب
 *    لطرف مش موكل، برضو لازم يكون 14 رقم بالظبط (فحص صيغة، مش إجبار).
 * 3. 🆕 اسم أي طرف "مدعي" (الطرف الأول) لازم يكون ثلاثي على الأقل —
 *    إلزامي دايمًا (خطأ مانع)، بغض النظر عن is_client. **إلا** لو الطرف
 *    مربوط بموكل حقيقي (client_id موجود) — وقتها الاسم مقفول/مصدره جدول
 *    clients، فمفيش فحص صيغة عليه هنا خالص (تجنب حجب تعديل قضايا قديمة).
 * 4. 🆕 اسم أي طرف "مدعى عليه" (الطرف الثاني) مش موكل: يكفي ثنائي كحد
 *    أدنى (خطأ مانع لو أقل من كده) — موكلين المكتب على جهة الخصم
 *    مستثنين من الشرط ده زي ما كان (وكذلك أي طرف مربوط بـ client_id).
 *    لو الاسم ثنائي بالظبط (مش ثلاثي فأكتر)، بيطلع تحذير غير مانع
 *    (warning) بيقترح التوسع لثلاثي/رباعي.
 * 5. لازم طرف واحد على الأقل (في أي الجهتين) يكون is_client=true.
 * 6. ممنوع تكرار نفس الرقم القومي بين طرفين في نفس القضية/الجلسة (قسم 7-أ
 *    — منع تام، مفيش تجاوز/تأكيد).
 * 7. لو جهة معينة (مدعي أو مدعى عليه) فيها شخصان فأكثر، المسمى القانوني
 *    الجامع لهذه الجهة (legalTitles.plaintiff/defendant) إجباري ولازم
 *    يكون مكتوب (مش فاضي).
 */
export function validateParties(
    parties: PartyFieldValue[],
    legalTitles: PartyLegalTitles = { plaintiff: '', defendant: '' },
): PartiesValidationResult {
    const errors: PartyValidationError[] = [];
    const warnings: PartyValidationWarning[] = [];

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

        if (!p.name.trim()) continue; // الاسم الفاضي أخد خطأه فوق بالفعل — مفيش داعي نكرر فحص الصيغة عليه

        // 🛡️ FIX (مراجعة أخيرة — 1 أغسطس 2026): لو الطرف مربوط فعليًا بموكل
        // حقيقي من جدول clients (client_id موجود)، حقل الاسم بيبقى مقفول
        // (readOnly) في EditCaseModal.tsx/StandaloneSessionDetailModal.tsx —
        // الاسم مصدره صف الموكل نفسه مش الفورم، ومش قابل للتعديل من هنا
        // خالص. لو طبّقنا فحص الصيغة عليه زي أي اسم متكتوب يدويًا، أي موكل
        // قديم اسمه اتسجل زمان (قبل تصحيح فحص الاسم الثلاثي في جدول
        // clients نفسه) هيمنع حفظ أي تعديل على القضية/الجلسة بالكامل —
        // حتى لو المستخدم مش لامس اسم الطرف ده أصلاً وعايز يعدّل حاجة
        // تانية غير مرتبطة. الفحص الصحيح لصيغة اسم الموكل مكانه clientValidation.ts
        // (وقت إضافة/تعديل الموكل نفسه من شاشته)، مش هنا.
        if (p.client_id) continue;

        if (p.side === 'plaintiff') {
            // 🆕 الطرف الأول: ثلاثي إلزامي دايمًا (خطأ مانع)، بغض النظر عن is_client.
            const nameErr = validateFullNameParts(p.name);
            if (nameErr) {
                errors.push({ partyId: p.id, field: 'name', message: '⚠️ اسم الطرف الأول لازم يكون ثلاثي على الأقل (الاسم الأول، الأب، الجد)' });
            }
        } else if (p.side === 'defendant' && !p.is_client) {
            // 🆕 الطرف الثاني (الخصم) مش موكل المكتب: ثنائي كحد أدنى إجباري
            // (عشان جهات زي "النيابة العامة")، وتحذير غير مانع لو ثنائي بالظبط.
            const parts = countNameParts(p.name);
            if (parts < DEFENDANT_MIN_NAME_PARTS) {
                errors.push({ partyId: p.id, field: 'name', message: '⚠️ اسم الخصم لازم يكون ثنائي على الأقل' });
            } else if (parts < 3) {
                warnings.push({ partyId: p.id, field: 'name', message: 'ℹ️ يفضل تسجيل بيانات الخصم بشكل ثلاثي أو رباعي لتجنب تعارض البيانات (إلا لو جهة اعتبارية زي النيابة العامة)' });
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

    return { valid: errors.length === 0, errors, warnings, message: errors[0]?.message };
}

