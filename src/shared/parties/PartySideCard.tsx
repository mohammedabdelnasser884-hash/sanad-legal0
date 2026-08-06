import React from 'react';
import type { PartyFieldValue, PartySide } from './partyTypes';
import type { PartyValidationError } from '../lib/casePartiesValidation';
import { getPartyStateBadge, isOrphanState, isLinkedState, type PartyLinkState } from './partyDomainService';

// ══════════════════════════════════════════════════════════════
//  PartySideCard — الكارت المطوي الواحد لطرف كامل (الطرف الأول/الثاني)،
//  مطابق حرفيًا لمخطط قسم 3 من خطة "تطوير أطراف الدعوى" (الحالة الفارغة/
//  الملخص بعد الإدخال/حالة النقص بالحد الأحمر). الضغط عليه بيفتح النموذج
//  الفرعي (PartySubform) — الكارت نفسه لا يعرض أي حقل إدخال.
//  خطة "تطوير أطراف الدعوى" — مرحلة 4، خطوة 1 (23 يوليو 2026).
// ══════════════════════════════════════════════════════════════

interface PartySideCardProps {
    side: PartySide;
    title: string; // "الطرف الأول" / "الطرف الثاني"
    list: PartyFieldValue[];
    // أخطاء الفاليديشن الخاصة بالجهة دي بس (partyId من ضمن أشخاصها، أو
    // partyId فاضي لخطأ "المسمى القانوني" بمؤشر الجهة دي في نص الرسالة).
    errors: PartyValidationError[];
    // بيتفعّل لو الجهة التانية فيها بيانات والجهة دي لسه فاضية — علشان
    // تبان بلون أفتح توجّه الانتباه تلقائيًا (بند 3-د من الخطة).
    dimEmpty: boolean;
    onOpen: () => void;
    // ⚡ NEW (خطة توحيد قفل الطرف — المرحلة 3، Badges/UI، 6 أغسطس 2026):
    // اختيارية — لو اتبعتت، بتتحسب حالة كل شخص جوه الجهة دي وتتعرض شارة
    // مجمّعة واحدة على الكارت المطوي نفسه (قبل حتى ما يتفتح النموذج
    // الفرعي)، عشان orphan/linked يبانوا من نظرة واحدة على مستوى الجهة.
    // أولوية العرض: orphan (لازم انتباه) قبل linked (معلومة عادية).
    getPartyState?: (party: PartyFieldValue) => PartyLinkState;
}

// خرائط قصيرة لتحويل حقل الخطأ لعبارة مختصرة تظهر جوه الكارت نفسه، بدل
// النص الكامل الطويل من casePartiesValidation.ts (اللي مكانه الطبيعي هو
// رسالة toast لحظة الحفظ، مش مساحة الكارت المطوي الضيقة).
// 🆕 (خطة "تبسيط عرض أطراف الدعوى" — 3 أغسطس 2026): بتاخد الآن كائن
// الخطأ كامل (مش النص بس) وتتحقق من field==='legal_title' أولاً — لأن
// نص رسالة المسمى القانوني بقى عامًا ومفيهوش كلمة "المسمى القانوني"
// بالترتيب اللي كان يسمح بالفحص النصي القديم يلقطها بأمان قبل باقي القواعد.
function shortReason(error: PartyValidationError): string {
    if (error.field === 'legal_title') return 'المسمى القانوني ناقص';
    const message = error.message;
    if (message.includes('مكرر')) return 'الرقم القومي مكرر';
    if (message.includes('الرقم القومي')) return 'الرقم القومي ناقص';
    if (message.includes('ثلاثي')) return 'الاسم لازم يكون ثلاثي';
    if (message.includes('ثنائي')) return 'الاسم لازم يكون ثنائي على الأقل';
    if (message.includes('صفة')) return 'الصفة ناقصة';
    if (message.includes('الاسم')) return 'الاسم ناقص';
    if (message.includes('موكلنا')) return 'لازم تحدد موكل المكتب';
    return 'بيانات ناقصة';
}

export function PartySideCard({ side, title, list, errors, dimEmpty, onOpen, getPartyState }: PartySideCardProps) {
    const partyIds = new Set(list.map((p) => p.id));

    // ⚡ NEW (المرحلة 3): شارة مجمّعة على مستوى الجهة كلها — orphan (أي
    // شخص فيها) بتغلب على linked (كلهم مربوطين بموكلين أحياء)، وبترجع
    // null لو مفيش أي حالة تستاهل شارة (كلهم MANUAL، أو getPartyState مش
    // متبعتة أصلًا).
    const sideBadge = (() => {
        if (!getPartyState) return null;
        const states = list.map(getPartyState);
        if (states.some(isOrphanState)) return getPartyStateBadge('ORPHAN_PARTY');
        if (states.some(isLinkedState)) return getPartyStateBadge('LINKED');
        return null;
    })();
    const sideError = errors.find(
        (e) => partyIds.has(e.partyId) || (e.partyId === '' && e.field === 'legal_title' && e.side === side)
    );

    const isEmpty = list.length <= 1 && !list[0]?.name.trim();
    const firstNamed = list.find((p) => p.name.trim());
    const displayName = firstNamed?.name.trim() || list[0]?.name.trim() || '';
    const othersCount = list.length - 1;

    let bodyText: string;
    if (isEmpty) {
        bodyText = 'لا يوجد بيانات';
    } else {
        const capacity = firstNamed?.capacity.trim();
        bodyText = capacity ? `${displayName} (${capacity})` : displayName;
        if (othersCount > 0) bodyText += ` +${othersCount} ${othersCount === 1 ? 'آخر' : 'آخرين'}`;
    }
    if (sideError) {
        bodyText = displayName ? `${displayName} — ${shortReason(sideError)}` : shortReason(sideError);
    }

    const cardCls = sideError
        ? 'rounded-2xl border border-rose-500/50 bg-rose-500/5 p-4 mb-2 w-full text-right active:scale-[0.98] transition-transform'
        : isEmpty && dimEmpty
        ? 'rounded-2xl border border-white/5 bg-white/[0.02] p-4 mb-2 w-full text-right active:scale-[0.98] transition-transform'
        : 'rounded-2xl border border-white/10 bg-white/5 p-4 mb-2 w-full text-right active:scale-[0.98] transition-transform';

    const titleCls = sideError
        ? 'text-xs font-black text-rose-300'
        : isEmpty && dimEmpty
        ? 'text-xs font-black text-slate-600'
        : 'text-xs font-black text-slate-200';

    const bodyCls = sideError
        ? 'text-[11px] text-rose-300/90 mt-1'
        : isEmpty
        ? `text-[11px] mt-1 ${dimEmpty ? 'text-slate-700' : 'text-slate-500'}`
        : 'text-[11px] text-slate-400 mt-1';

    return React.createElement('button', {
        type: 'button',
        onClick: onOpen,
        className: cardCls,
        'data-testid': `party-side-card-${side}`,
    },
        React.createElement('div', { className: 'flex items-center justify-between' },
            React.createElement('div', { className: 'flex items-center gap-1.5' },
                React.createElement('span', { className: titleCls }, sideError ? `⚠️ ${title}` : title),
                !sideError && sideBadge && React.createElement('span', {
                    className: `text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${sideBadge.className}`,
                    'data-testid': `party-side-card-${side}-state-badge`,
                }, `${sideBadge.emoji} ${sideBadge.label}`)
            ),
            React.createElement('span', { className: 'text-slate-500 text-sm' }, '›')
        ),
        React.createElement('p', { className: bodyCls }, bodyText)
    );
}
