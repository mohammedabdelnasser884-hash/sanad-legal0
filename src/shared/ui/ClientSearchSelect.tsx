import React, { useState, useRef, useEffect, useCallback } from 'react';
import { db } from '../../supabaseClient';
import { ilikeOrClause } from '../lib/sanitize';

// ══════════════════════════════════════════════════════════════
// ClientSearchSelect — بديل دروب-داون <select> المحدود بأول 15 موكل
// محمّلين محليًا. بيدوّر مباشرة في الداتابيز (نفس نمط searchExistingClients
// في useSessionLinking.ts) بدل ما يقرأ من قايمة `clients` مقيّدة بصفحة.
//
// ⚡ (8 أغسطس 2026 — البند 6، الجزء الثاني): المكون ده بقى مستخدم كمان
// في دروب-داونز "ربط طرف الدعوى بموكل" (NewCaseModal/EditCaseModal/
// InfoSection/StandaloneSessionDetailModal) اللي فيها فحص تعارض بيانات
// ومنطق orphan/unlink. onSelect بيرجّع الصف الكامل (id + full_name +
// national_id + cr_number + address) — المستدعي بيستخدمه *مباشرة* في
// فحص التعارض وتعبئة حقول الطرف، من غير أي `.find()` تاني في قايمة
// `clients` محلية (اللي كانت أصل مشكلة سباق التوقيت مع أي تحميل async).
// ══════════════════════════════════════════════════════════════

export interface ClientSearchResult {
    id: string;
    full_name: string | null;
    national_id?: string | null;
    phone?: string | null;
    // ⚡ NEW (8 أغسطس 2026 — البند 6، الجزء الثاني): لازمين لاستخدامات
    // "ربط طرف الدعوى بموكل" (فحص تعارض البيانات + تعبئة حقول الطرف) —
    // شوف NewCaseModal/EditCaseModal/InfoSection/StandaloneSessionDetailModal.
    // مش مستخدمين في حالة الأتعاب (فورمات FeesTab/FeeCard)، بس مفيش ضرر
    // إنهم يترجعوا دايمًا بما إن الاستعلام نفسه واحد لكل الاستخدامات.
    cr_number?: string | null;
    address?: string | null;
}

interface ClientSearchSelectProps {
    label?: string;
    // الاسم المعروض حاليًا للموكل المختار (لو موجود) — الأب هو المسؤول
    // عن حسابه (عادة من clientsWithExtras.find أو من آخر نتيجة بحث).
    selectedLabel: string;
    onSelect: (client: ClientSearchResult) => void;
    // خيار إضافي ثابت (مثلاً "➕ آخر (اكتب يدوي)") — بيظهر في آخر
    // القايمة دايمًا بغض النظر عن نتائج البحث.
    manualOption?: { label: string };
    onManualSelect?: () => void;
    isManualSelected?: boolean;
    placeholder?: string;
    testId?: string;
}

export function ClientSearchSelect({
    label, selectedLabel, onSelect, manualOption, onManualSelect, isManualSelected, placeholder, testId,
}: ClientSearchSelectProps) {
    const [open, setOpen] = useState(false);
    const [term, setTerm] = useState('');
    const [results, setResults] = useState<ClientSearchResult[]>([]);
    const [searching, setSearching] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const onClickOutside = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, []);

    const runSearch = useCallback(async (q: string) => {
        setSearching(true);
        try {
            let query = db.from('clients')
                .select('id,full_name,national_id,phone,cr_number,address')
                .is('deleted_at', null)
                .order('full_name', { ascending: true })
                .limit(15);
            if (q.trim()) {
                const s = q.trim();
                query = query.or([ilikeOrClause('full_name', s), ilikeOrClause('national_id', s), ilikeOrClause('phone', s)].join(','));
            }
            const { data, error } = await query;
            if (!error) setResults((data as ClientSearchResult[]) || []);
        } finally {
            setSearching(false);
        }
    }, []);

    // ── أول ما القايمة تتفتح، اعرض أول 15 موكل فورًا (زي الدروب-داون
    // القديم بالظبط) قبل ما المستخدم يكتب أي حرف ──
    const handleFocus = () => {
        setOpen(true);
        if (results.length === 0 && !term) runSearch('');
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = e.target.value;
        setTerm(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => runSearch(v), 300);
    };

    const pick = (c: ClientSearchResult) => {
        onSelect(c);
        setTerm('');
        setOpen(false);
    };

    const pickManual = () => {
        onManualSelect?.();
        setTerm('');
        setOpen(false);
    };

    const displayValue = open ? term : (isManualSelected ? (manualOption?.label || '') : selectedLabel);

    return React.createElement('div', { className: 'relative', ref: rootRef },
        label && React.createElement('label', { className: 'block text-[10px] font-bold text-slate-400 mb-1.5' }, label),
        React.createElement('input', {
            type: 'text',
            value: displayValue,
            onFocus: handleFocus,
            onChange: handleChange,
            placeholder: placeholder || 'ابحث بالاسم أو الرقم القومي...',
            'data-testid': testId,
            className: 'w-full p-2.5 text-xs rounded-xl border border-white/10 bg-black/30 text-white placeholder-slate-600',
            style: { fontFamily: 'Cairo,sans-serif', colorScheme: 'dark' },
            autoComplete: 'off',
        }),
        open && React.createElement('div', {
            className: 'absolute z-[80] mt-1 w-full max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-premium-bg shadow-2xl',
        },
            searching && React.createElement('div', { className: 'p-3 text-[10px] text-slate-500 text-center' }, 'جاري البحث...'),
            !searching && results.length === 0 && React.createElement('div', { className: 'p-3 text-[10px] text-slate-500 text-center' }, 'لا توجد نتائج'),
            !searching && results.map((c) => React.createElement('button', {
                key: c.id,
                type: 'button',
                onClick: () => pick(c),
                className: 'w-full text-right p-2.5 text-xs text-white hover:bg-white/5 active:bg-white/10 border-b border-white/5 last:border-b-0',
                style: { fontFamily: 'Cairo,sans-serif' },
            }, c.full_name || '—', c.national_id && React.createElement('span', { className: 'text-slate-500 text-[10px] mr-2' }, c.national_id))),
            manualOption && React.createElement('button', {
                type: 'button',
                onClick: pickManual,
                className: 'w-full text-right p-2.5 text-xs text-premium-gold font-bold hover:bg-white/5 active:bg-white/10',
                style: { fontFamily: 'Cairo,sans-serif' },
            }, manualOption.label)
        )
    );
}

export default ClientSearchSelect;
