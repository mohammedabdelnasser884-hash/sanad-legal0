// ══════════════════════════════════════════════════════════════
//  usePartyFields — الهوك المشترك لإدارة array أطراف القضية/الجلسة
//  المستقلة (case_parties)، بمعزل عن أي فورم أو نداء داتابيز حقيقي
//  (قسم 6، خطوة 2 من خطة تعدد الأطراف). هيتنده من الفورمات الأربعة
//  (NewCaseModal/EditCaseModal/NewStandaloneSessionModal/
//  StandaloneSessionDetailModal) في المراحل الجاية، وكل فورم هو اللي
//  هيتولى تمرير initialPlaintiffs/initialDefendants (من case_parties أو
//  من الأعمدة القديمة plaintiff/defendant لقضية قديمة) وربط الحفظ
//  الفعلي بـ __dbWrite (قرار قسم 8 — خارج نطاق المرحلة دي).
//  خطة تعدد الأطراف — مرحلة 3 (22 يوليو 2026).
// ══════════════════════════════════════════════════════════════

import { useCallback, useMemo, useState } from 'react';
import { createEmptyParty, type PartyFieldValue, type PartySide } from './partyTypes';
import { validateParties, type PartiesValidationResult, type PartyLegalTitles } from '../lib/casePartiesValidation';

// id محلي للفورم بس — نفس نمط توليد offlineTempId الفعلي في
// useCaseActions.ts (`tmp-${Date.now()}-${random}`)، بادئة مختلفة
// (party-) عشان تتميّز بصريًا وقت الفحص، مش مرتبط بطابور الأوفلاين في
// المرحلة دي (الربط الفعلي بـ _offlineFkTempId هيحصل مع الحفظ الحقيقي).
const genId = () => `party-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

export interface UsePartyFieldsOptions {
    // لو مش متبعتة أو array فاضي: بيتبدأ بطرف واحد فاضي لكل جهة (زي
    // مربع الفورم في قسم 4 — "مدعي ١" و"مدعى عليه ١" ظاهرين من البداية).
    initialPlaintiffs?: PartyFieldValue[];
    initialDefendants?: PartyFieldValue[];
    // 🆕 (خطة "المسمى القانوني" — مرحلة 3): قيمة ابتدائية للمسمى القانوني
    // الجامع لكل جهة، بتتقرا من الأعمدة plaintiff_legal_title/
    // defendant_legal_title (قضية/جلسة قائمة بالفعل). لو مش متبعتة: تبدأ
    // فاضية زي أي قضية/جلسة جديدة.
    initialLegalTitles?: PartyLegalTitles;
}

export interface UsePartyFieldsReturn {
    parties: PartyFieldValue[];
    plaintiffs: PartyFieldValue[];
    defendants: PartyFieldValue[];
    addParty: (side: PartySide) => void;
    removeParty: (id: string) => void;
    // بيرجع false لأول طرف في جهته (زرار الحذف بيتخفي ليه — قسم 4)
    canRemove: (id: string) => boolean;
    updateParty: <K extends keyof PartyFieldValue>(id: string, field: K, value: PartyFieldValue[K]) => void;
    toggleIsClient: (id: string) => void;
    // 🆕 (خطة "المسمى القانوني" — مرحلة 3): المسمى القانوني الجامع الحالي
    // لكل جهة + setter بتاعه — مخزّن على مستوى القضية/الجلسة نفسها (مش
    // جوه array الأطراف)، زي ما اتفق في casePartiesValidation.ts.
    legalTitles: PartyLegalTitles;
    setLegalTitle: (side: PartySide, value: string) => void;
    validation: PartiesValidationResult;
}

export function usePartyFields(options: UsePartyFieldsOptions = {}): UsePartyFieldsReturn {
    const [parties, setParties] = useState<PartyFieldValue[]>(() => {
        const plaintiffs = options.initialPlaintiffs && options.initialPlaintiffs.length > 0
            ? options.initialPlaintiffs
            : [createEmptyParty('plaintiff', genId())];
        const defendants = options.initialDefendants && options.initialDefendants.length > 0
            ? options.initialDefendants
            : [createEmptyParty('defendant', genId())];
        return [...plaintiffs, ...defendants];
    });

    const [legalTitles, setLegalTitles] = useState<PartyLegalTitles>(() => ({
        plaintiff: options.initialLegalTitles?.plaintiff ?? '',
        defendant: options.initialLegalTitles?.defendant ?? '',
    }));

    const setLegalTitle = useCallback((side: PartySide, value: string) => {
        setLegalTitles((prev) => ({ ...prev, [side]: value }));
    }, []);

    const plaintiffs = useMemo(() => parties.filter((p) => p.side === 'plaintiff'), [parties]);
    const defendants = useMemo(() => parties.filter((p) => p.side === 'defendant'), [parties]);

    const addParty = useCallback((side: PartySide) => {
        setParties((prev) => [...prev, createEmptyParty(side, genId())]);
    }, []);

    const canRemove = useCallback((id: string) => {
        const target = parties.find((p) => p.id === id);
        if (!target) return false;
        const sameSide = parties.filter((p) => p.side === target.side);
        return sameSide.length > 0 && sameSide[0].id !== id;
    }, [parties]);

    // بيرفض يمسح أول طرف في جهته حتى لو اتنادى برمجيًا من غير المرور على
    // canRemove أولاً (نفس القاعدة اتفحصت جوه setParties كمان، مش بس في
    // الـ UI) — قسم 4: "مش الطرف الأساسي/الوحيد المتبقي في كل جهة".
    const removeParty = useCallback((id: string) => {
        setParties((prev) => {
            const target = prev.find((p) => p.id === id);
            if (!target) return prev;
            const sameSide = prev.filter((p) => p.side === target.side);
            if (sameSide[0]?.id === id) return prev;
            return prev.filter((p) => p.id !== id);
        });
    }, []);

    const updateParty = useCallback(<K extends keyof PartyFieldValue>(id: string, field: K, value: PartyFieldValue[K]) => {
        setParties((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
    }, []);

    // إلغاء ⭐ ميمسحش القيم المكتوبة (قسم 4: "يرجّع كل الحقول اختيارية من
    // غير ما يمسح القيم") — بس toggle على is_client، من غير لمس باقي الحقول.
    const toggleIsClient = useCallback((id: string) => {
        setParties((prev) => prev.map((p) => (p.id === id ? { ...p, is_client: !p.is_client } : p)));
    }, []);

    const validation = useMemo(() => validateParties(parties, legalTitles), [parties, legalTitles]);

    return { parties, plaintiffs, defendants, addParty, removeParty, canRemove, updateParty, toggleIsClient, legalTitles, setLegalTitle, validation };
}
