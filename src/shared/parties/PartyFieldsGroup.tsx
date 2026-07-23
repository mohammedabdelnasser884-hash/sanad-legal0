import React, { useState } from 'react';
import { PartySideCard } from './PartySideCard';
import { PartySubform } from './PartySubform';
import type { UsePartyFieldsReturn } from './usePartyFields';
import type { PartySide, PartyFieldValue } from './partyTypes';

// ══════════════════════════════════════════════════════════════
//  PartyFieldsGroup — بلوك "أطراف الدعوى" الكامل. بدل العرض المفتوح
//  القديم (كل الأشخاص وكل الحقول ظاهرة فوق بعض)، دلوقتي كارتين مطويين
//  بس (الطرف الأول/الطرف الثاني)، والضغط على أي كارت بيفتح نموذج فرعي
//  (PartySubform) فيه بيانات الجهة دي بالكامل — مطابق لقسم 3 من خطة
//  "تطوير أطراف الدعوى". الـ props (controller/testIdPrefix/
//  renderPartyExtra/renderPartyReadOnly) اتسابت زي ما هي بالظبط، فمفيش
//  أي تعديل مطلوب في النماذج الأربعة اللي بتستخدم المكوّن ده.
//  خطة "تطوير أطراف الدعوى" — مرحلة 4، خطوة 1 (23 يوليو 2026).
// ══════════════════════════════════════════════════════════════

interface PartyFieldsGroupProps {
    controller: UsePartyFieldsReturn;
    testIdPrefix?: string;
    renderPartyExtra?: (party: PartyFieldValue) => React.ReactNode;
    renderPartyReadOnly?: (party: PartyFieldValue) => boolean;
}

export function PartyFieldsGroup({ controller, testIdPrefix, renderPartyExtra, renderPartyReadOnly }: PartyFieldsGroupProps) {
    const { plaintiffs, defendants, validation } = controller;

    // أي كارت مفتوح دلوقتي (طرف واحد بس ممكن يتفتح في نفس الوقت) — null
    // يعني القفلين مطويين، فورم القضية الأساسي بيبان زي ما هو.
    const [openSide, setOpenSide] = useState<PartySide | null>(null);

    const plaintiffsEmpty = plaintiffs.length <= 1 && !plaintiffs[0]?.name.trim();
    const defendantsEmpty = defendants.length <= 1 && !defendants[0]?.name.trim();

    // خطأ عام (partyId فاضي) — دلوقتي "لازم طرف واحد على الأقل موكلنا"
    // فقط؛ أخطاء "legal_title" بتتعرض جوه كارت الجهة المعنية بالتحديد
    // (PartySideCard) بدل ما تتعرض هنا مرتين.
    const generalError = validation.errors.find((e) => e.partyId === '' && e.field !== 'legal_title')?.message;

    return React.createElement('div', { className: 'space-y-1' },
        React.createElement('p', { className: 'text-[11px] font-black text-slate-400 mb-2' }, '— أطراف الدعوى —'),

        React.createElement(PartySideCard, {
            side: 'plaintiff',
            title: 'الطرف الأول',
            list: plaintiffs,
            errors: validation.errors,
            dimEmpty: plaintiffsEmpty && !defendantsEmpty,
            onOpen: () => setOpenSide('plaintiff'),
        }),
        React.createElement(PartySideCard, {
            side: 'defendant',
            title: 'الطرف الثاني',
            list: defendants,
            errors: validation.errors,
            dimEmpty: defendantsEmpty && !plaintiffsEmpty,
            onOpen: () => setOpenSide('defendant'),
        }),

        generalError && React.createElement('p', { className: 'text-[10px] text-rose-400 mt-2', 'data-testid': testIdPrefix ? `${testIdPrefix}-general-error` : undefined }, generalError),

        React.createElement(PartySubform, {
            isOpen: openSide === 'plaintiff',
            side: 'plaintiff',
            title: 'الطرف الأول',
            cardLabel: 'مدعي',
            addLabel: '➕ إضافة مدعي آخر',
            controller,
            testIdPrefix,
            renderPartyExtra,
            renderPartyReadOnly,
            onClose: () => setOpenSide(null),
        }),
        React.createElement(PartySubform, {
            isOpen: openSide === 'defendant',
            side: 'defendant',
            title: 'الطرف الثاني',
            cardLabel: 'مدعى عليه',
            addLabel: '➕ إضافة مدعى عليه آخر',
            controller,
            testIdPrefix,
            renderPartyExtra,
            renderPartyReadOnly,
            onClose: () => setOpenSide(null),
        })
    );
}
