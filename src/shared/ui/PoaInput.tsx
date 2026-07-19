import React from 'react';

// ══════════════════════════════════════════════════════════════
//  PoaInput — حقل "بيانات التوكيل" الموحّد، مستخدم في كل الفورمات
//  اللي فيها رقم توكيل (إضافة/تعديل موكل، جلسة مستقلة، إضافة/تعديل
//  قضية). سطر واحد فيه 4 خانات: رقم / حرف / سنة / مكتب التوثيق —
//  بيتخزنوا في عمود نص واحد بصيغة "رقم/حرف/سنة/مكتب" (نفس فاصل "/"
//  اللي كان مستخدم أصلاً في placeholder القديم "2024/أ/1234").
// ══════════════════════════════════════════════════════════════

export interface PoaValue {
    number: string;
    letters: string;
    year: string;
    office: string;
}

// أرقام فقط، بحد أقصى معيّن من الخانات
const onlyDigitsN = (v: string, max: number) => v.replace(/\D/g, '').slice(0, max);

// حروف عربية فقط (بدون أرقام أو رموز)، بحد أقصى معيّن من الخانات
const onlyArabicLetters = (v: string, max: number) => v.replace(/[^\u0600-\u06FF]/g, '').slice(0, max);

/**
 * يحوّل النص المخزّن (عمود واحد) لـ 4 أجزاء منفصلة.
 * لو النص مش بصيغة "رقم/حرف/سنة/مكتب" (مثلاً بيانات قديمة اتكتبت حرة قبل
 * ما الحقل يتقسّم) — بنحط النص كله في خانة "مكتب التوثيق" الحرة عشان
 * البيانات القديمة متضيعش، والمستخدم يقدر يعيد صياغتها بالتقسيم الجديد.
 */
export function parsePoaString(v: string | null | undefined): PoaValue {
    const raw = (v || '').trim();
    if (!raw) return { number: '', letters: '', year: '', office: '' };
    const parts = raw.split('/');
    if (parts.length === 4) {
        return {
            number: onlyDigitsN(parts[0], 5),
            letters: onlyArabicLetters(parts[1], 2),
            year: onlyDigitsN(parts[2], 4),
            office: parts[3].trim(),
        };
    }
    return { number: '', letters: '', year: '', office: raw };
}

/** يجمّع الـ 4 أجزاء في نص واحد جاهز للتخزين في عمود الداتابيز */
export function formatPoaValue(v: PoaValue): string {
    if (!v.number && !v.letters && !v.year && !v.office) return '';
    return [v.number, v.letters, v.year, v.office].join('/');
}

const boxCls = 'w-full px-2 py-2.5 text-[11px] text-center rounded-lg border border-white/10 bg-premium-bg text-white placeholder-slate-600 transition-colors';
const boxStyle = { fontFamily: 'Cairo,sans-serif' };

export const PoaInput = ({ label = 'بيانات التوكيل', value, onChange, required }: {
    label?: string; value: string; onChange: (next: string) => void; required?: boolean;
}) => {
    const parsed = parsePoaString(value);
    const update = (patch: Partial<PoaValue>) => onChange(formatPoaValue({ ...parsed, ...patch }));

    return React.createElement('div', null,
        label && React.createElement('label', { className: 'block text-[10px] font-bold text-slate-400 mb-1.5' },
            label,
            required && React.createElement('span', { className: 'text-rose-400 mr-1' }, '*')
        ),
        // سطر واحد بـ 4 خانات: رقم (ضيقة) / حرف (ضيقة) / سنة (ضيقة) / مكتب توثيق (واسعة)
        React.createElement('div', { className: 'grid gap-1.5', style: { gridTemplateColumns: '1.1fr 0.9fr 1.1fr 2fr' } },
            React.createElement('input', {
                value: parsed.number,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ number: onlyDigitsN(e.target.value, 5) }),
                placeholder: 'رقم', inputMode: 'numeric', maxLength: 5,
                className: boxCls, style: boxStyle,
            }),
            React.createElement('input', {
                value: parsed.letters,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ letters: onlyArabicLetters(e.target.value, 2) }),
                placeholder: 'حرف', maxLength: 2,
                className: boxCls, style: boxStyle,
            }),
            React.createElement('input', {
                value: parsed.year,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ year: onlyDigitsN(e.target.value, 4) }),
                placeholder: 'سنة', inputMode: 'numeric', maxLength: 4,
                className: boxCls, style: boxStyle,
            }),
            React.createElement('input', {
                value: parsed.office,
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => update({ office: e.target.value }),
                placeholder: 'مكتب التوثيق', className: boxCls, style: { ...boxStyle, textAlign: 'right' as const },
            }),
        )
    );
};
