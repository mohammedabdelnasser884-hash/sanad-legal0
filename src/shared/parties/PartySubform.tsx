import React from 'react';
import { PartyFields } from './PartyFields';
import { Inp } from '../ui/Inp';
import { I } from '../../constants';
import { useNestedModalBackButton } from '../lib/useNestedModalBackButton';
import type { UsePartyFieldsReturn } from './usePartyFields';
import type { PartySide, PartyFieldValue } from './partyTypes';

// ══════════════════════════════════════════════════════════════
//  PartySubform — النموذج الفرعي اللي بيتفتح لما يتضغط على PartySideCard.
//  بيحتوي بالظبط على نفس محتوى renderSide القديم (كروت الأشخاص + المسمى
//  القانوني + زرار الإضافة)، بس دلوقتي جوه شاشة/شيت منفصلة فوق فورم
//  القضية الأساسي، بدل ما يكون مفتوح دايمًا جوه الفورم.
//
//  ⚠️ ملحوظة تسجيل الحالة (بند هـ من التقرير): useNestedModalBackButton
//  هي اللي بتسجل حالة النموذج الفرعي ده صح من البداية، عشان زر الرجوع
//  الفعلي يقفله هو بس (يرجع لفورم القضية)، مش يقفل فورم القضية نفسه.
//  خطة "تطوير أطراف الدعوى" — مرحلة 4، خطوة 1 (23 يوليو 2026).
// ══════════════════════════════════════════════════════════════

interface PartySubformProps {
    isOpen: boolean;
    side: PartySide;
    title: string; // "الطرف الأول" / "الطرف الثاني"
    cardLabel: string; // "مدعي" / "مدعى عليه" (لعنوان كارت كل شخص)
    addLabel: string; // "➕ إضافة مدعي آخر" / ...
    controller: UsePartyFieldsReturn;
    testIdPrefix?: string;
    renderPartyExtra?: (party: PartyFieldValue) => React.ReactNode;
    renderPartyReadOnly?: (party: PartyFieldValue) => boolean;
    onClose: () => void;
}

export function PartySubform({
    isOpen, side, title, cardLabel, addLabel, controller, testIdPrefix, renderPartyExtra, renderPartyReadOnly, onClose,
}: PartySubformProps) {
    useNestedModalBackButton(isOpen, onClose);

    if (!isOpen) return null;

    const { plaintiffs, defendants, addParty, removeParty, canRemove, updateParty, toggleIsClient, legalTitles, setLegalTitle, validation } = controller;
    const list = side === 'plaintiff' ? plaintiffs : defendants;

    const nationalIdErrorFor = (partyId: string) =>
        validation.errors.find((e) => e.partyId === partyId && e.field === 'national_id')?.message ?? null;

    const sideMarker = side === 'plaintiff' ? '(المدعي)' : '(المدعى عليه)';
    const legalTitleError = validation.errors.find((e) => e.field === 'legal_title' && e.message.includes(sideMarker))?.message ?? null;

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

    const legalTitleField = list.length >= 2
        ? React.createElement('div', { className: 'mb-3' },
            React.createElement(Inp, {
                label: 'المسمى القانوني',
                value: legalTitles[side],
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => setLegalTitle(side, e.target.value),
                placeholder: 'مثال: ورثة المرحوم أحمد علي',
                required: true,
                'data-testid': testIdPrefix ? `${testIdPrefix}-${side}-legal-title` : undefined,
            }),
            React.createElement('p', { className: 'text-[9px] text-slate-500 mt-1' }, 'يُكتب فقط في حالة كون هذا الطرف أكثر من شخص (مثل الورثة أو الشركاء)'),
            legalTitleError && React.createElement('p', { className: 'text-[9px] text-rose-400 mt-1' }, legalTitleError)
          )
        : null;

    // ── الشيت نفسه — z-index أعلى من مودال القضية/الجلسة الرئيسي (z-50)
    // عشان يظهر فوقه، مش جواه بصريًا ──
    return React.createElement('div', {
        className: 'fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm',
        onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); },
    },
        React.createElement('div', { className: 'bg-premium-card w-full max-w-lg rounded-t-3xl border-t border-white/10 p-6 pb-10 shadow-2xl slide-up max-h-[90vh] overflow-y-auto no-scrollbar' },
            React.createElement('div', { className: 'w-10 h-1 bg-white/20 rounded-full mx-auto mb-5' }),
            React.createElement('div', { className: 'flex items-center justify-between mb-5' },
                React.createElement('h3', { className: 'text-sm font-black text-white flex items-center gap-2' },
                    React.createElement('span', { className: 'w-1 h-4 bg-premium-gold rounded-full' }),
                    title
                ),
                React.createElement('button', {
                    onClick: onClose,
                    'data-testid': testIdPrefix ? `${testIdPrefix}-${side}-subform-close` : undefined,
                    className: 'w-8 h-8 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 active:scale-90 transition-all shrink-0',
                }, React.createElement(I.X))
            ),
            React.createElement('div', { className: 'space-y-1' },
                ...cards,
                legalTitleField,
                React.createElement('button', {
                    type: 'button',
                    onClick: () => addParty(side),
                    className: 'text-[11px] font-bold text-violet-300 mb-3',
                    'data-testid': testIdPrefix ? `${testIdPrefix}-add-${side}` : undefined,
                }, addLabel)
            ),
            React.createElement('button', {
                type: 'button',
                onClick: onClose,
                'data-testid': testIdPrefix ? `${testIdPrefix}-${side}-subform-save` : undefined,
                className: 'w-full py-3 bg-gradient-to-tr from-premium-gold to-amber-200 text-premium-bg rounded-xl font-black text-sm shadow-md active:scale-95 transition-transform mt-4',
            }, 'حفظ والعودة')
        )
    );
}
