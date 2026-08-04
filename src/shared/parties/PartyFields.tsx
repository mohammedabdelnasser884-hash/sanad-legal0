import React from 'react';
import { Inp } from '../ui/Inp';
import { PoaInput } from '../ui/PoaInput';
import type { PartyFieldValue, PartySide } from './partyTypes';

// نفس هيلبر "أرقام فقط بحد أقصى" المستخدم في NewCaseModal.tsx/
// NewStandaloneSessionModal.tsx — مكرر هنا محليًا (بدون export) عشان
// المكوّن ده يفضل مستقل بمعزل عن أي فورم، زي المطلوب في قسم 6 خطوة 2.
const onlyDigits = (v: string, max = 14) => v.replace(/\D/g, '').slice(0, max);

// 🆕 (خطة "تبسيط عرض أطراف الدعوى" — 3 أغسطس 2026): ترقيم ترتيبي لعنوان
// كارت كل شخص جوه نفس الطرف (بدل "مدعي 1"/"مدعي 2" اللي كانت بتفترض إن
// الصفة دايمًا مدعي/مدعى عليه). fallback رقمي لو العدد كبير جدًا (حالة
// نادرة عمليًا — نادرًا ما يتعدى طرف واحد أكتر من بضعة أشخاص).
const ORDINALS_AR = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر'];
function ordinalAr(n: number): string {
    return ORDINALS_AR[n - 1] ?? `رقم ${n}`;
}

// الحقول النصية اللي البطاقة دي فعليًا بتعدّلها — is_client ليها
// onToggleIsClient خاص بيها، وclient_id مش متاح للتعديل من الفورم في
// المرحلة دي (هيتضاف مع "ربط بموكل من النظام" في الفورمات الحقيقية).
type EditablePartyField = 'name' | 'capacity' | 'address' | 'national_id' | 'power_of_attorney';

interface PartyFieldsProps {
    party: PartyFieldValue;
    // ترتيب الطرف جوه جهته (0-based) — بيتحدد بيه العنوان الترتيبي
    // ("الأول"/"الثاني"/...، من غير أي ذكر لـ"مدعي"/"مدعى عليه").
    index: number;
    // 🆕 (خطة "تبسيط عرض أطراف الدعوى" — 3 أغسطس 2026): الطرف الأول أو
    // الثاني صراحةً — بيُستخدم فقط لتنويع أمثلة placeholder حقل "صفته"
    // (بدل الاعتماد على مقارنة نص sideLabel بكلمة "مدعي" حرفيًا، اللي
    // كانت بتنكسر لو النص اتعمم).
    side: PartySide;
    canRemove: boolean;
    onChange: (field: EditablePartyField, value: string) => void;
    onRemove: () => void;
    onToggleIsClient: () => void;
    nationalIdError?: string | null;
    // ⚡ NEW (تحديث "تفرقة اسم الطرف الأول عن الخصم" — 1 أغسطس 2026):
    // تحذير غير مانع (مش خطأ) بيتعرض تحت حقل الاسم مباشرة — بيُستخدم
    // حاليًا لتنبيه "يفضل اسم الخصم يكون ثلاثي/رباعي" لما يكون ثنائي بالظبط.
    nameWarning?: string | null;
    // بادئة موحّدة لـ data-testid (مثال: 'new-case-plaintiff-0') — اختياري،
    // بيتحدد من الفورم الأب وقت الربط الفعلي (مراحل 4-6).
    testIdPrefix?: string;
    // ⚡ NEW (مرحلة 4): سلوت اختياري بيتعرض فوق حقل الاسم مباشرة — الفورم
    // الأب (NewCaseModal وغيره) بيستخدمه عشان يحط "ربط بموكل من النظام"
    // خاص بالطرف ده تحديدًا (قسم 4: "تفعيلها يبين حقل ربط بموكل من النظام
    // فوق اسم الطرف ده تحديدًا"). المكوّن ده فاضل عمومي (مش عارف حاجة عن
    // الموكلين نفسهم) — بس بيوفر المكان اللي المحتوى ده هيتحط فيه.
    extraContent?: React.ReactNode;
    // ⚡ NEW (مرحلة 5.1 — خطة تعدد الأطراف، 22 يوليو 2026): لو true، حقول
    // الاسم/الرقم القومي/العنوان/التوكيل بتتقفل (readOnly) — دي بتتستخدم في
    // EditCaseModal.tsx لما الطرف ده هو الموكل المربوط فعليًا بصف حي من
    // جدول clients (نفس فكرة القفل القديمة اللي كانت على حقول "الموكل"
    // المفردة قبل تعدد الأطراف). الصفة (capacity) فضلت قابلة للتعديل دايمًا
    // (كانت كده حتى قبل القفل القديم)، ونجمة ⭐/زرار الحذف مش متأثرين.
    readOnly?: boolean;
}

const readOnlyInputCls = 'w-full p-3 text-xs rounded-xl border border-white/10 bg-white/5 text-slate-300 placeholder-slate-600 cursor-not-allowed';

export function PartyFields({
    party, index, side, canRemove, onChange, onRemove, onToggleIsClient, nationalIdError, nameWarning, testIdPrefix, extraContent, readOnly = false,
}: PartyFieldsProps) {
    const title = ordinalAr(index + 1);
    const tid = (name: string) => (testIdPrefix ? `${testIdPrefix}-${name}` : undefined);

    return React.createElement('div', { className: 'rounded-2xl border border-white/10 bg-white/5 p-3 mb-2 space-y-2', 'data-testid': tid('card') },
        // ── رأس البطاقة: العنوان + نجمة "موكلنا" + زرار الحذف ──
        React.createElement('div', { className: 'flex items-center justify-between' },
            React.createElement('span', { className: 'text-[11px] font-black text-slate-300' }, title),
            React.createElement('div', { className: 'flex items-center gap-2' },
                React.createElement('button', {
                    type: 'button',
                    onClick: onToggleIsClient,
                    'data-testid': tid('star'),
                    'aria-pressed': party.is_client,
                    className: `text-[11px] font-bold px-2 py-1 rounded-lg transition-colors ${party.is_client ? 'text-amber-300' : 'text-slate-500'}`,
                }, party.is_client ? '⭐ موكلنا' : '☆ موكلنا؟'),
                canRemove && React.createElement('button', {
                    type: 'button',
                    onClick: onRemove,
                    'data-testid': tid('remove'),
                    className: 'text-rose-400 text-xs px-1',
                    'aria-label': 'حذف الطرف',
                }, '🗑')
            )
        ),

        // ── سلوت "ربط بموكل من النظام" (لو الفورم الأب بعت واحد ولطرف
        // موكلنا) — بيتعرض هنا فوق الاسم مباشرة، زي مخطط قسم 4 بالظبط.
        extraContent,

        // ── الاسم + الصفة (إجباريين دايمًا) ──
        React.createElement('div', { className: 'grid grid-cols-2 gap-2' },
            React.createElement(Inp, {
                label: 'الاسم',
                value: party.name,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange('name', e.target.value),
                placeholder: 'اسم الطرف',
                required: true,
                readOnly,
                className: readOnly ? readOnlyInputCls : undefined,
                'data-testid': tid('name'),
            }),
            React.createElement(Inp, {
                label: 'صفته',
                value: party.capacity,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange('capacity', e.target.value),
                placeholder: side === 'plaintiff' ? 'مثال: مدعي، مستأنف، طالب...' : 'مثال: مدعى عليه، متهم، مطعون ضده...',
                required: true,
                'data-testid': tid('capacity'),
            })
        ),
        // 🆕 توضيح إن الأمثلة في placeholder مجرد اقتراح، مش قائمة مقفولة —
        // ممكن تتكتب أي صفة تانية تناسب هذا الطرف فعليًا.
        React.createElement('p', { className: 'text-[9px] text-slate-500 -mt-1' }, 'مجرد أمثلة — اكتب أي صفة تناسب هذا الطرف فعليًا'),
        nameWarning && React.createElement('p', { className: 'text-[9px] text-amber-400 -mt-1', 'data-testid': tid('name-warning') }, nameWarning),

        // ── العنوان — بيتعرض كـ"إجباري بصريًا" بس لموكل المكتب، فعليًا
        // اختياري في الحالتين (الفاليديشن الحقيقي في usePartyFields) ──
        React.createElement(Inp, {
            label: party.is_client ? 'عنوان الموكل' : 'عنوان (اختياري)',
            value: party.address,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange('address', e.target.value),
            placeholder: 'العنوان التفصيلي',
            readOnly,
            className: readOnly ? readOnlyInputCls : undefined,
            'data-testid': tid('address'),
        }),

        // ── الرقم القومي — إجباري فعليًا لو is_client (14 رقم بالظبط) ──
        React.createElement('div', null,
            React.createElement(Inp, {
                label: party.is_client ? 'الرقم القومي' : 'الرقم القومي (اختياري)',
                value: party.national_id,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => onChange('national_id', onlyDigits(e.target.value)),
                placeholder: '14 رقم',
                required: party.is_client,
                inputMode: 'numeric',
                maxLength: 14,
                readOnly,
                className: readOnly ? readOnlyInputCls : undefined,
                'data-testid': tid('national-id'),
            }),
            nationalIdError && React.createElement('p', { className: 'text-[9px] text-rose-400 mt-1' }, nationalIdError)
        ),

        // ── بيانات التوكيل ──
        React.createElement(PoaInput, {
            label: party.is_client ? 'بيانات التوكيل' : 'بيانات التوكيل (اختياري)',
            value: party.power_of_attorney,
            onChange: (v: string) => onChange('power_of_attorney', v),
            readOnly,
        })
    );
}
