import React from 'react';
import { PartyFields } from './PartyFields';
import type { UsePartyFieldsReturn } from './usePartyFields';
import type { PartySide, PartyFieldValue } from './partyTypes';

// ══════════════════════════════════════════════════════════════
//  PartyFieldsGroup — بلوك "أطراف الدعوى" الكامل (المدعين + المدعى
//  عليهم مع بعض)، مطابق لتصميم قسم 4 من الخطة. بيستقبل controller
//  جاهز من usePartyFields() (بيتنده من الفورم الأب، عشان الفورم يقدر
//  يقرا validation/parties وقت الحفظ من غير duplicate state).
//  لسه بمعزل عن أي فورم حقيقي أو نداء داتابيز (مرحلة 3) — الربط
//  بالفورمات الأربعة فعليًا هيحصل في مراحل 4-6.
// ══════════════════════════════════════════════════════════════

interface PartyFieldsGroupProps {
    controller: UsePartyFieldsReturn;
    // بادئة موحّدة لـ data-testid عبر كل عناصر المجموعة (زرارات الإضافة
    // وبطاقات الأطراف) — اختياري.
    testIdPrefix?: string;
    // ⚡ NEW (مرحلة 4): بيتنده لكل طرف عشان الفورم الأب يقدر يحط سلوت
    // "ربط بموكل من النظام" فوق اسم أي طرف عليه ⭐ — راجع PartyFields.tsx
    // (extraContent) وNewCaseModal.tsx (أول استخدام حقيقي).
    renderPartyExtra?: (party: PartyFieldValue) => React.ReactNode;
    // ⚡ NEW (مرحلة 5.1): بيتنده لكل طرف عشان الفورم الأب (EditCaseModal.tsx)
    // يحدد لو الطرف ده لازم يتقفل (readOnly) — الطرف المربوط فعليًا بموكل
    // حي من جدول clients. راجع PartyFields.tsx (readOnly prop).
    renderPartyReadOnly?: (party: PartyFieldValue) => boolean;
}

export function PartyFieldsGroup({ controller, testIdPrefix, renderPartyExtra, renderPartyReadOnly }: PartyFieldsGroupProps) {
    const { plaintiffs, defendants, addParty, removeParty, canRemove, updateParty, toggleIsClient, validation } = controller;

    const nationalIdErrorFor = (partyId: string) =>
        validation.errors.find((e) => e.partyId === partyId && e.field === 'national_id')?.message ?? null;

    const renderSide = (side: PartySide, list: typeof plaintiffs, headerLabel: string, cardLabel: string, addLabel: string) => {
        const cards = list.map((party, index) =>
            React.createElement(PartyFields, {
                key: party.id,
                party,
                index,
                sideLabel: cardLabel,
                canRemove: canRemove(party.id),
                onChange: (field: 'name' | 'capacity' | 'address' | 'national_id' | 'power_of_attorney', value: string) => updateParty(party.id, field, value),
                onRemove: () => removeParty(party.id),
                onToggleIsClient: () => toggleIsClient(party.id),
                nationalIdError: nationalIdErrorFor(party.id),
                testIdPrefix: testIdPrefix ? `${testIdPrefix}-${side}-${index}` : undefined,
                extraContent: renderPartyExtra ? renderPartyExtra(party) : undefined,
                readOnly: renderPartyReadOnly ? renderPartyReadOnly(party) : false,
            })
        );

        return React.createElement(React.Fragment, null,
            React.createElement('p', { className: 'text-[10px] font-black text-slate-500 mb-2' }, headerLabel),
            ...cards,
            React.createElement('button', {
                type: 'button',
                onClick: () => addParty(side),
                className: 'text-[11px] font-bold text-violet-300 mb-3',
                'data-testid': testIdPrefix ? `${testIdPrefix}-add-${side}` : undefined,
            }, addLabel)
        );
    };

    // خطأ عام (partyId فاضي) — دلوقتي بس "لازم طرف واحد على الأقل موكلنا"
    // (قسم 4)، بيتعرض تحت الجهتين مع بعض.
    const generalError = validation.errors.find((e) => e.partyId === '')?.message;

    return React.createElement('div', { className: 'space-y-1' },
        React.createElement('p', { className: 'text-[11px] font-black text-slate-400 mb-2' }, '— أطراف الدعوى —'),
        renderSide('plaintiff', plaintiffs, 'المدعين', 'مدعي', '➕ إضافة مدعي آخر'),
        React.createElement('div', { className: 'border-t border-white/10 my-3' }),
        renderSide('defendant', defendants, 'المدعى عليهم', 'مدعى عليه', '➕ إضافة مدعى عليه آخر'),
        generalError && React.createElement('p', { className: 'text-[10px] text-rose-400 mt-2', 'data-testid': testIdPrefix ? `${testIdPrefix}-general-error` : undefined }, generalError)
    );
}
