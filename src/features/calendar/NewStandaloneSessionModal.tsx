import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '../../shared/lib/notifications';
import { escapeTelegramHtml } from '../../shared/lib/sanitize';
import { logActivity } from '../../shared/lib/dataAccess';
import { db } from '../../supabaseClient';
import { showErrorToast } from '../../shared/lib/errorReporting';
import { Inp } from '@/shared/ui/Inp';
import { Sel } from '@/shared/ui/Sel';
import { usePartyFields } from '@/shared/parties/usePartyFields';
import { PartyFieldsGroup } from '@/shared/parties/PartyFieldsGroup';
import { validateParties } from '@/shared/lib/casePartiesValidation';
import type { MappedCase } from '../../hooks/useAppData';
import { useClientLinking } from './hooks/useClientLinking';
import { makeOfflineTempId, withFkOfflineSentinel } from './hooks/caseSessionLinkingShared';
import type { OpenCreateClientForSession, OpenCreateClientForCase, OpenCreateClientForParty, OpenCreateClientForSessionParty } from './hooks/useClientLinking';

// ══════════════════════════════════════════
//  Modal إضافة جلسة مستقلة (بدون ربط بقضية)
// ══════════════════════════════════════════

const CASE_TYPES = ['مدني', 'تجاري', 'جنائي', 'عمالي', 'إداري', 'أسرة', 'أخرى'];

export interface Form {
    court: string;
    title: string;
    case_number: string;
    case_year: string;
    case_type: string;
    case_type_custom: string;
    circuit_number: string;
    court_level: string;
    court_level_other: string;
    session_date: string;
    session_time: string;
    // ⚡ ملحوظة (مرحلة 6.1 — خطة تعدد الأطراف، 22 يوليو 2026): الحقول دي
    // مبقاش لها UI مباشر في الفورم تحت (بدّلها PartyFieldsGroup +
    // usePartyFields — راجع مرحلة 4.1 في NewCaseModal.tsx لنفس النمط).
    // بتتحسب دلوقتي من "الطرف الأساسي" (أولوية لمن عليه ⭐) في handleSave
    // وقت الحفظ، وبتفضل موجودة هنا وفي Form لأن useClientLinking.ts
    // (ومنطق تحويل الجلسة لقضية بشكل عام) لسه بيقرأها من savedFormData.form
    // — دعم تعدد الأطراف في مسار الربط/التحويل ده نفسه هيتعمل في مرحلة 7.
    plaintiff: string;
    plaintiff_role: string;
    plaintiff_national_id: string;
    plaintiff_power_of_attorney: string;
    defendant: string;
    defendant_role: string;
    defendant_national_id: string;
    next_action: string;
    // ⚡ موحّد مع cases.session_hall — نص واحد "الدور الأول - قاعة 5"،
    // بدل session_floor/session_hall المنفصلين اللي كانوا هنا قبل كده
    // (نفس النمط القديم اللي اتشال من جدول cases). session_floor
    // اتسيب كعمود قديم في الداتابيز بس مبقاش بيتكتب فيه من هنا.
    session_hall: string;
    secretary_hall: string;
    secretary_name: string;
    secretary_mobile: string;
    description: string;
    result: string;
}

const EMPTY: Form = {
    court: '',
    title: '',
    case_number: '',
    case_year: '',
    case_type: '',
    case_type_custom: '',
    circuit_number: '',
    court_level: '',
    court_level_other: '',
    session_date: '',
    session_time: 'صباحي',
    plaintiff: '',
    plaintiff_role: '',
    plaintiff_national_id: '',
    plaintiff_power_of_attorney: '',
    defendant: '',
    defendant_role: '',
    defendant_national_id: '',
    next_action: '',
    session_hall: '',
    secretary_hall: '',
    secretary_name: '',
    secretary_mobile: '',
    description: '',
    result: '',
};

const COURT_LEVELS = ['ابتدائي', 'استئناف', 'نقض', 'أخرى'];

// أرقام بس، وبالظبط 14 رقم — بيتقص أي حرف مش رقم أول بأول
const onlyDigits = (v: string, max = 14) => v.replace(/\D/g, '').slice(0, max);

function SectionTitle({ children }: { children: string }) {
    return React.createElement('p', {
        className: 'text-[10px] font-black text-premium-gold/70 uppercase tracking-widest pt-2 pb-0.5 border-b border-white/5'
    }, children);
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children?: React.ReactNode }) {
    return React.createElement('div', null,
        React.createElement('label', { className: 'block text-[10px] font-bold text-slate-400 mb-1.5' },
            label,
            required && React.createElement('span', { className: 'text-rose-400 mr-0.5' }, ' *')
        ),
        children
    );
}

const inputCls = 'w-full p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600';
const inputStyle = { fontFamily: 'Cairo,sans-serif' };

export default function NewStandaloneSessionModal({ onClose, onSaved, onClientAdded, onNotify, cases = [], onOpenCreateClient, onOpenCreateClientForCase, onOpenCreateClientForParty, onOpenCreateClientForSessionParty }: {
    onClose: () => void;
    onSaved: () => void;
    onClientAdded?: () => void;
    onNotify?: (msg: string) => void;
    cases?: MappedCase[];
    // ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 3): فتح NewClientModal الموحّد
    // من "إضافة الموكل لقائمة الموكلين فقط" — شوف App.tsx
    // (handleOpenCreateClientForSession) وuseClientLinking.ts.
    onOpenCreateClient?: OpenCreateClientForSession;
    // ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 2): فتح NewClientModal الموحّد
    // من "إنشاء موكل جديد وربطه" (بعد تحويل جلسة مستقلة لقضية) — شوف
    // App.tsx (handleOpenCreateClientForCase) وuseClientLinking.ts.
    onOpenCreateClientForCase?: OpenCreateClientForCase;
    // ⚡ NEW (خطة تعدد الأطراف، 7.2 جزء 2 بند 2.3 — 23 يوليو 2026): نفس
    // onOpenCreateClientForCase بس لطرف بعينه وسط wizard "طرف واحد في
    // المرة" — شوف App.tsx (handleOpenCreateClientForParty) وuseClientLinking.ts
    // (OpenCreateClientForParty).
    onOpenCreateClientForParty?: OpenCreateClientForParty;
    // ⚡ NEW (خطة تعدد الأطراف، مرحلة 13 جزء 2 — 23 يوليو 2026): مرآة لـ
    // onOpenCreateClientForParty بس لخطوة "idle" (زرار "إضافة الموكل
    // لقائمة الموكلين فقط" — قبل حتى ما نعرف هيتحول لقضية ولا لأ) —
    // شوف App.tsx (handleOpenCreateClientForSessionParty) وuseClientLinking.ts.
    onOpenCreateClientForSessionParty?: OpenCreateClientForSessionParty;
}) {
    const [form, setForm] = useState<Form>(EMPTY);
    // ⚡ NEW (مرحلة 6.1 — خطة تعدد الأطراف): array أطراف الجلسة المستقلة
    // (مدعين ومدعى عليهم، بلا حدود) بدل حقلي "الموكل"/"الخصم" المفردين
    // القدامى — نفس مكوّن/هوك مرحلة 4.1 (NewCaseModal.tsx) بالحرف. مفيش
    // سلوت "ربط بموكل من النظام" هنا (الفورم ده أصلاً معندوش prop
    // للموكلين — نفس نطاق الفورم القديم قبل التعديل).
    const partyFields = usePartyFields();
    const [linkMode, setLinkMode] = useState<'standalone' | 'existing'>('standalone');
    const [caseSearch, setCaseSearch] = useState('');
    const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [postSaveModal, setPostSaveModal] = useState(false);
    // 🆕 (خطة "المسمى القانوني" — بند مؤجل من التقرير): plaintiffLegalTitle/
    // defendantLegalTitle اتضافوا هنا (مطابقة لـ SavedFormData في
    // useClientLinking.ts) عشان يتنقلوا للقضية الجديدة وقت التحويل.
    const [savedFormData, setSavedFormData] = useState<{ form: Form; finalCaseType: string; finalCourtLevel: string; fullCaseNumber: string; sessionId: string | null; plaintiffLegalTitle?: string | null; defendantLegalTitle?: string | null } | null>(null);
    const {
        linkingCase, linkingClient, linkingToCase,
        createdCaseId, setCreatedCaseId,
        clientStep, setClientStep,
        foundClient, setFoundClient, foundClientMatchType,
        // ⚡ NEW (7.2 جزء 2 — بند 2.4): partyList/partyIndex لعرض "طرف X من Y"،
        // وhandleSkipParty لتخطي الطرف الحالي بس وقت الـ wizard (بدل onClose
        // اللي بيقفل الموديل كله — مسار الجلسات القديمة قبل مرحلة 6).
        partyList, partyIndex, handleSkipParty,
        // ⚡ NEW (مرحلة 13 جزء 2): idlePartyList/linkedIdlePartyIds لتحديد
        // أي زرار يظهر في خطوة "idle"، وhandleAddClientOnlyForParty لفتح
        // NewClientModal لطرف بعينه.
        idlePartyList, linkedIdlePartyIds, handleAddClientOnlyForParty,
        handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
    } = useClientLinking(savedFormData, onSaved, onClientAdded, onOpenCreateClient, onOpenCreateClientForCase, onOpenCreateClientForParty, onOpenCreateClientForSessionParty);
    // ⚡ NEW (7.2 جزء 2 — بند 2.4): في وضع الـ wizard (partyList فيها أطراف)،
    // اسم الطرف الحالي بيحل محل savedFormData.form.plaintiff (اللي بقى بيمثل
    // بس أول مدعي زي ما كان قبل تعدد الأطراف) — غير كده (جلسة قديمة، صفر
    // تغيير سلوك) بنفضل نستخدم savedFormData.form.plaintiff زي ما هو.
    const currentPartyName = partyList.length > 0 ? (partyList[partyIndex]?.name || null) : (savedFormData?.form.plaintiff || null);
    const onSkipOrClose = partyList.length > 0 ? handleSkipParty : onClose;

    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f: Form) => ({ ...f, [k]: e.target.value }));

    const finalCaseType = form.case_type === 'أخرى' ? (form.case_type_custom || 'أخرى') : form.case_type;
    const finalCourtLevel = form.court_level === 'أخرى' ? (form.court_level_other || '') : form.court_level;
    const fullCaseNumber = [form.case_number, form.case_year].filter(Boolean).join('/');
    const selectedCase = cases.find((c: MappedCase) => c.id === selectedCaseId) || null;
    const filteredCases = !caseSearch ? cases : cases.filter((c: MappedCase) =>
        c.title?.includes(caseSearch) || c.number?.includes(caseSearch) ||
        c.plaintiff?.includes(caseSearch) || c.defendant?.includes(caseSearch)
    );

    const handleSave = async () => {
        if (!form.session_date) { toast('⚠️ تاريخ الجلسة مطلوب', true); return; }
        if (linkMode === 'existing' && !selectedCaseId) { toast('⚠️ اختر القضية أولاً', true); return; }
        if (linkMode === 'standalone') {
            if (!form.title?.trim()) {
                toast('⚠️ يجب ملء الحقول الإجبارية المحددة بعلامة (*)', true);
                return;
            }
            // ⚡ CHANGED (مرحلة 6.1 — خطة تعدد الأطراف): فاليديشن أطراف
            // الجلسة كلها بقت من casePartiesValidation.ts (نفس القواعد
            // المطبّقة في NewCaseModal.tsx مرحلة 4.1: اسم/صفة كل طرف،
            // الرقم القومي 14 رقم لمن عليه ⭐، طرف واحد ⭐ على الأقل، عدم
            // تكرار الرقم القومي) — بدل الفحوصات المفردة القديمة
            // (validateFullNameParts للخصم، طول الرقم القومي يدويًا...).
            if (!partyFields.validation.valid) {
                toast(partyFields.validation.message || 'يرجى مراجعة بيانات أطراف الدعوى', true);
                return;
            }
        }
        // ⚡ NEW (مرحلة 6.1): "الطرف الأساسي" في كل جهة (أولوية لمن عليه ⭐،
        // وإلا أول طرف) بياخد مكان الحقول المفردة القديمة (plaintiff/
        // defendant/...) — نفس آلية "مزامنة الأعمدة القديمة" في مرحلة 4.1
        // (NewCaseModal.tsx). حفظ كل الأطراف فعليًا في case_parties (لجلسة
        // مستقلة) هيتضاف في مرحلة 6.2 التالية.
        const primaryPlaintiff = linkMode === 'standalone'
            ? (partyFields.plaintiffs.find((p) => p.is_client) || partyFields.plaintiffs[0])
            : undefined;
        const primaryDefendant = linkMode === 'standalone'
            ? (partyFields.defendants.find((p) => p.is_client) || partyFields.defendants[0])
            : undefined;
        // ⚡ NEW (مرحلة 6.2 — خطة تعدد الأطراف): معرّف مؤقت لصف الجلسة
        // نفسها — بيتبعت دايمًا مع نداء __dbWrite بغض النظر عن حالة
        // الاتصال (نفس نمط offlineTempId في useCaseActions.ts)، عشان لو
        // الجلسة اتقيّدت أوفلاين، صفوف case_parties المرتبطة بيها تقدر
        // تتحل لـ session_id الحقيقي وقت المزامنة (withFkOfflineSentinel
        // تحت). لو أونلاين، __dbWrite بيشيله تلقائيًا قبل الـ INSERT
        // الحقيقي (stripOfflineSentinels في offlineQueue.ts) — صفر أثر.
        const sessionOfflineTempId = makeOfflineTempId();
        // ⚡ NEW (مرحلة 6.2): بيكتب صف في case_parties لكل طرف في
        // partyFields.parties، بنداءات __dbWrite منفصلة — نفس آلية
        // insertCaseParties في useCaseActions.ts (مرحلة 4.2) بالحرف، لكن
        // بـ session_id بدل case_id (case_id بيتبعت null صراحة، مطابقةً
        // لقيد case_parties_one_parent في الداتابيز — قسم 3 من الخطة).
        // لا تُنادى إلا في وضع "standalone" (وضع "existing" مفيهوش أطراف
        // خاصة بالجلسة نفسها — الأطراف بتاعة القضية المختارة أصلاً).
        type InsertPartiesResult = { ok: true } | { ok: false; reason: 'validation'; message: string } | { ok: false; reason: 'write' };
        const insertSessionParties = async (sessionId: string | null, isOffline: boolean, isQueued: boolean): Promise<InsertPartiesResult> => {
            if (linkMode !== 'standalone') return { ok: true };
            const parties = partyFields.parties;
            if (!parties || parties.length === 0) return { ok: true };
            // 🔒 فاليديشن سيرفر مكرر (نفس نمط 4.3/5.2) — دفاع في العمق لو
            // مصدر حفظ تاني ظهر مستقبلًا أو state اتلاعب فيه بعد فاليديشن
            // الفورم أعلى handleSave.
            // 🆕 (خطة "المسمى القانوني" — مرحلة 3): بنبعت legalTitles هنا
            // كمان، وإلا قاعدة 6 (إلزامية المسمى القانوني عند ≥٢ أشخاص)
            // مش هتتفحص كخط دفاع تاني (نفس ملحوظة useCaseActions.ts).
            const serverCheck = validateParties(parties, {
                plaintiff: partyFields.legalTitles.plaintiff || '',
                defendant: partyFields.legalTitles.defendant || '',
            });
            if (!serverCheck.valid) {
                return { ok: false, reason: 'validation', message: serverCheck.message || '⚠️ بيانات أطراف الدعوى غير مكتملة أو غير صحيحة' };
            }
            let allOk = true;
            for (let i = 0; i < parties.length; i++) {
                const p = parties[i];
                const rowData: Record<string, unknown> = {
                    case_id: null,
                    session_id: sessionId,
                    side: p.side,
                    is_client: p.is_client,
                    name: p.name,
                    capacity: p.capacity,
                    national_id: p.national_id || null,
                    address: p.address || null,
                    power_of_attorney: p.power_of_attorney || null,
                    client_id: p.client_id || null,
                    sort_order: i,
                };
                // fallbackNameValue null — case_sessions مفيهوش عمود "اسم"
                // فريد منطقي (زي title القضايا) للبحث الاحتياطي بالاسم؛
                // الحل هيعتمد بس على تطابق التمبيد في نفس دورة المزامنة
                // (تعليق موضّح بالتفصيل جوه withFkOfflineSentinel نفسها).
                const finalData = withFkOfflineSentinel(isOffline, isQueued, 'session_id', sessionOfflineTempId, 'case_sessions', null, rowData);
                const partyResult = await window.__dbWrite({ type: 'INSERT', table: 'case_parties', data: finalData });
                if (partyResult.error) allOk = false;
            }
            return allOk ? { ok: true } : { ok: false, reason: 'write' };
        };
        setSaving(true);
        try {
            // ⚡ FIX (مرحلة 0 — توسيع الأوفلاين): تحويل من db.from() المباشر لـ
            // __dbWrite. النداء ده مستقل تمامًا (case_id إما null أو id قضية
            // حقيقي مُختار من الدروب داون في وضع "existing" — مفيش سلسلة
            // تعتمد على id لسه في الطابور)، فآمن يتحول فورًا من غير أي توسيع
            // في نظام الطابور نفسه. لو أوفلاين، sessionData.id هيبقى مفقود
            // (العملية اتقيدت بس)، فـ savedFormData.sessionId هيبقى null —
            // ده متعامل معاه بالفعل في useClientLinking.ts (خطوة ربط الجلسة
            // بالقضية بتتخطى لو sessionId فاضي)، صفر تغيير سلوك إضافي مطلوب.
            const { data: sessionData, error, offline, queued } = await window.__dbWrite({
                type: 'INSERT',
                table: 'case_sessions',
                data: {
                    case_id: linkMode === 'existing' ? selectedCaseId : null,
                    session_date: form.session_date,
                    session_time: form.session_time || null,
                    court_level: finalCourtLevel || null,
                    session_hall: form.session_hall || null,
                    secretary_hall: form.secretary_hall || null,
                    secretary_name: form.secretary_name || null,
                    secretary_mobile: form.secretary_mobile || null,
                    title: form.title || null,
                    case_number: fullCaseNumber || null,
                    court: form.court || null,
                    case_type: finalCaseType || null,
                    circuit_number: form.circuit_number || null,
                    plaintiff: primaryPlaintiff?.name || null,
                    plaintiff_role: primaryPlaintiff?.capacity || null,
                    plaintiff_national_id: primaryPlaintiff?.national_id || null,
                    plaintiff_power_of_attorney: primaryPlaintiff?.power_of_attorney || null,
                    defendant: primaryDefendant?.name || null,
                    defendant_role: primaryDefendant?.capacity || null,
                    defendant_national_id: primaryDefendant?.national_id || null,
                    // 🆕 (خطة "المسمى القانوني" — مرحلة 3): زي primaryPlaintiff/
                    // primaryDefendant فوق، بتتبعت بس في وضع standalone —
                    // partyFields.legalTitles تفضل فاضية ('') في وضع
                    // "existing" (أطراف القضية المختارة أصلاً، مش أطراف
                    // خاصة بالجلسة نفسها).
                    plaintiff_legal_title: linkMode === 'standalone' ? (partyFields.legalTitles.plaintiff || null) : null,
                    defendant_legal_title: linkMode === 'standalone' ? (partyFields.legalTitles.defendant || null) : null,
                    description: form.description || null,
                    result: form.result || null,
                    next_action: form.next_action || null,
                    // ⚡ NEW (مرحلة 6.2): راجع تعليق sessionOfflineTempId فوق.
                    _offlineTempId: sessionOfflineTempId,
                },
                returning: true,
            });

            if (error) {
                showErrorToast('session_save', error, 'تعذّر حفظ الجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'حفظ الجلسة');
                return;
            }

            if (offline && queued) {
                toast(linkMode === 'existing' ? '📥 الجلسة محفوظة محلياً — ستُضاف فور عودة الإنترنت' : '📥 الجلسة المستقلة محفوظة محلياً — ستُضاف فور عودة الإنترنت');
                // ⚡ NEW (مرحلة 6.2): أطراف الجلسة (لو وضع standalone) بتتقيّد
                // هي كمان في نفس طابور الأوفلاين — بتتحل تلقائيًا بـ session_id
                // الحقيقي وقت المزامنة (_offlineFkTempId فوق في insertSessionParties).
                const offlinePartiesResult = await insertSessionParties(null, true, true);
                if (!offlinePartiesResult.ok) {
                    toast(
                        offlinePartiesResult.reason === 'validation'
                            ? offlinePartiesResult.message
                            : '⚠️ الجلسة اتقيّدت محليًا، لكن حصل خطأ في حفظ بعض أطراف الدعوى الإضافية — راجعها بعد المزامنة',
                        true
                    );
                }
                onSaved();
                onClose();
                return;
            }

            // ⚡ NEW (مرحلة 6.2): تسجيل كل أطراف الجلسة في case_parties — أونلاين
            // بالـ session_id الحقيقي مباشرة (مفيش داعي لسنتينل هنا). بترجع
            // {ok:true} فورًا لو linkMode==='existing' (مفيش أطراف خاصة
            // بالجلسة نفسها في الوضع ده — راجع insertSessionParties فوق).
            // الفحص على sessionData?.id (زي newCaseId في useCaseActions.ts):
            // حالة نادرة ممكن الجلسة تتسجل بنجاح لكن الصف المُدرج ميترجعش
            // (RLS بتمنع SELECT بعد INSERT مثلاً) — لو حصل، مفيش session_id
            // حقيقي نربط بيه case_parties، فبنعرض تحذير بدل ما نبعت INSERT
            // بـ session_id فاضي (هيترفض من قيد case_parties_one_parent أصلاً).
            if (sessionData?.id) {
                const partiesResult = await insertSessionParties(sessionData.id, false, false);
                if (!partiesResult.ok) {
                    toast(
                        partiesResult.reason === 'validation'
                            ? partiesResult.message
                            : '⚠️ الجلسة اتسجلت، لكن حصل خطأ في حفظ بعض أطراف الدعوى الإضافية — راجعها لاحقًا',
                        true
                    );
                }
            } else if (linkMode === 'standalone' && partyFields.parties.length > 0) {
                toast('⚠️ الجلسة اتسجلت، لكن أطراف الدعوى محتاجة تتضاف يدويًا من تفاصيل الجلسة', true);
            }

            // إشعار تيليجرام
            try {
                if (onNotify) {
                    let msg = linkMode === 'existing'
                        ? `📅 <b>جلسة جديدة</b>\n\n`
                        : `📅 <b>جلسة مستقلة جديدة</b>\n\n`;
                    if (linkMode === 'existing' && selectedCase) {
                        msg += `⚖️ <b>${escapeTelegramHtml(selectedCase.title || '—')}</b>\n`;
                        msg += `📋 رقم القيد: ${escapeTelegramHtml(selectedCase.number || '—')}\n`;
                        msg += `🏛 المحكمة: ${escapeTelegramHtml(selectedCase.court || '—')}\n`;
                    } else {
                        if (form.title)       msg += `⚖️ <b>${escapeTelegramHtml(form.title)}</b>\n`;
                        if (fullCaseNumber)   msg += `📋 رقم القضية: ${escapeTelegramHtml(fullCaseNumber)}\n`;
                        if (form.court)       msg += `🏛 المحكمة: ${escapeTelegramHtml(form.court)}\n`;
                        if (finalCaseType)    msg += `📂 النوع: ${escapeTelegramHtml(finalCaseType)}\n`;
                    }
                    msg += `📆 تاريخ الجلسة: ${escapeTelegramHtml(form.session_date)} (${escapeTelegramHtml(form.session_time)})\n`;
                    if (linkMode === 'standalone') {
                        if (primaryPlaintiff?.name) msg += `👤 الموكل: ${escapeTelegramHtml(primaryPlaintiff.name)}${primaryPlaintiff.capacity ? ' — ' + escapeTelegramHtml(primaryPlaintiff.capacity) : ''}\n`;
                        if (primaryDefendant?.name) msg += `👤 الخصم: ${escapeTelegramHtml(primaryDefendant.name)}${primaryDefendant.capacity ? ' — ' + escapeTelegramHtml(primaryDefendant.capacity) : ''}\n`;
                    }
                    if (form.next_action) msg += `⚡ الإجراء القادم: ${escapeTelegramHtml(form.next_action)}\n`;
                    onNotify(msg);
                }
            } catch { /* تيليجرام اختياري */ }

            try {
                logActivity(db, linkMode === 'existing' ? 'إضافة جلسة لقضية موجودة' : 'إضافة جلسة مستقلة', {
                    entity_type: 'session',
                    details: form.session_date || null,
                });
            } catch { /* activity log اختياري */ }

            if (linkMode === 'existing') {
                toast('✅ تمت إضافة الجلسة');
                onSaved();
                onClose();
                return;
            }

            toast('✅ تمت إضافة الجلسة المستقلة');
            onSaved();
            // ⚡ NEW (مرحلة 6.1): useClientLinking.ts (منطق "تحويل الجلسة
            // لقضية"/"ربط الموكل") لسه بيقرا savedFormData.form.plaintiff/...
            // (حقول مفردة قديمة) — دعم تعدد الأطراف في المسار ده نفسه هيتعمل
            // في مرحلة 7. لحد ما نوصلها، بنبعت له "الطرف الأساسي" بنفس شكل
            // Form القديم تمامًا، صفر تغيير سلوك في مسار الربط الحالي.
            const formForLinking: Form = {
                ...form,
                plaintiff: primaryPlaintiff?.name || '',
                plaintiff_role: primaryPlaintiff?.capacity || '',
                plaintiff_national_id: primaryPlaintiff?.national_id || '',
                plaintiff_power_of_attorney: primaryPlaintiff?.power_of_attorney || '',
                defendant: primaryDefendant?.name || '',
                defendant_role: primaryDefendant?.capacity || '',
                defendant_national_id: primaryDefendant?.national_id || '',
            };
            setSavedFormData({
                form: formForLinking,
                finalCaseType,
                finalCourtLevel,
                fullCaseNumber,
                sessionId: sessionData?.id || null,
                // 🆕 (خطة "المسمى القانوني" — بند مؤجل من التقرير): نفس شرط
                // primaryPlaintiff/primaryDefendant فوق — بس في وضع
                // standalone (أطراف خاصة بالجلسة نفسها، مش أطراف قضية
                // مختارة أصلاً في وضع "existing").
                plaintiffLegalTitle: linkMode === 'standalone' ? (partyFields.legalTitles.plaintiff || null) : null,
                defendantLegalTitle: linkMode === 'standalone' ? (partyFields.legalTitles.defendant || null) : null,
            });
            setPostSaveModal(true);
        } catch {
            toast('❌ حدث خطأ غير متوقع، حاول مرة أخرى', true);
        } finally {
            setSaving(false);
        }
    };

    const postSave = postSaveModal ? createPortal(
        React.createElement('div', {
            className: 'fixed inset-0 z-[60] flex items-center justify-center px-4',
            style: { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }
        },
            React.createElement('div', {
                className: 'w-full max-w-sm rounded-3xl p-6 space-y-4',
                style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)' }
            },

                // ── Step 1: الخيارات الأساسية (قبل إنشاء القضية) ──
                clientStep === 'idle' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '✅'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'تمت إضافة الجلسة'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'هل تريد إنشاء سجلات إضافية؟')
                    ),
                    React.createElement('div', { className: 'space-y-2 pt-1' },
                        React.createElement('button', {
                            onClick: handleLinkCase,
                            disabled: linkingCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '⚖️'),
                            React.createElement('span', null, linkingCase ? '⏳ جاري الإنشاء...' : 'إنشاء ملف قضية من هذه البيانات')
                        ),
                        // ⚡ CHANGED (خطة تعدد الأطراف، مرحلة 13 جزء 2 — 23 يوليو 2026):
                        // زرار مستقل لكل طرف is_client=true في idlePartyList (بدل
                        // زرار واحد مبني على savedFormData.form.plaintiff بس) — نفس
                        // فكرة InfoSection.tsx في مرحلة 13 جزء 1 بالحرف. جلسة قديمة/
                        // بلا case_parties (idlePartyList فاضية) → فولباك كامل للزرار
                        // الواحد القديم، صفر تغيير سلوك.
                        ...(idlePartyList.length === 0
                            ? [savedFormData?.form.plaintiff?.trim() && React.createElement('button', {
                                key: 'add-client-only-legacy',
                                onClick: handleAddClientOnly,
                                disabled: linkingClient,
                                className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                            },
                                React.createElement('span', null, '👤'),
                                React.createElement('span', null, linkingClient ? '⏳ جاري الإضافة...' : 'إضافة الموكل لقائمة الموكلين فقط')
                            )]
                            : idlePartyList.filter((p) => !linkedIdlePartyIds.has(p.id)).map((p) => {
                                const single = idlePartyList.length === 1;
                                return React.createElement('button', {
                                    key: `add-client-only-${p.id}`,
                                    onClick: () => handleAddClientOnlyForParty(p),
                                    disabled: linkingClient,
                                    className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                                },
                                    React.createElement('span', null, '👤'),
                                    React.createElement('span', null, linkingClient
                                        ? '⏳ جاري الإضافة...'
                                        : (single ? `إضافة ${p.name} لقائمة الموكلين` : `إضافة "${p.name}" لقائمة الموكلين`))
                                );
                            }))
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'لا شكراً، إغلاق')
                ),

                // ── Step 2a: لقينا موكل في الـ DB ──
                clientStep === 'found' && React.createElement(React.Fragment, null,
                    // ⚡ NEW (7.2 جزء 2 — بند 2.4): عرض تقدّم الـ wizard "طرف X من Y"
                    // لما partyList فيها أكتر من طرف — مفيش لمسة للمسار القديم
                    // (جلسة من غير case_parties، partyList فاضية) هنا.
                    partyList.length > 0 && React.createElement('p', {
                        className: 'text-[10px] font-bold text-premium-gold text-center'
                    }, `طرف ${partyIndex + 1} من ${partyList.length}`),
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '👤'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' },
                            partyList.length > 0 ? `وجدنا موكلاً مطابقاً لـ"${currentPartyName}"` : 'وجدنا موكلاً مطابقاً'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'هل تريد ربط القضية الجديدة بـ'),
                        React.createElement('p', { className: 'text-xs font-bold text-premium-gold mt-1' }, foundClient?.full_name)
                    ),
                    React.createElement('div', { className: 'space-y-2 pt-1' },
                        React.createElement('button', {
                            onClick: handleLinkExistingClient,
                            disabled: linkingToCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '🔗'),
                            React.createElement('span', null, linkingToCase ? '⏳ جاري الربط...' : 'نعم، ربط بهذا الموكل')
                        ),
                        // ⚡ FIX: التطابق ده لما يكون مؤكد (اسم/رقم قومي/توكيل بالظبط —
                        // foundClientMatchType === 'exact') فزرار "موكل جديد" كان بيوصل
                        // لطريق مسدود، لأن checkClientDuplicate هيرفضه تاني بنفس السبب.
                        // نعرضه بس لما يكون التطابق تخمين بالاسم فقط (fuzzy).
                        foundClientMatchType !== 'exact' && React.createElement('button', {
                            onClick: handleAddAndLinkClient,
                            disabled: linkingToCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '➕'),
                            React.createElement('span', null, 'إضافة موكل جديد وربطه')
                        ),
                        foundClientMatchType === 'exact' && React.createElement('p', {
                            className: 'text-[10px] text-slate-500 text-center px-2'
                        }, 'الاسم أو الرقم القومي أو رقم التوكيل مطابق تمامًا لموكل مسجل بالفعل — لو ده شخص مختلف فعلاً، عدّل بياناته من صفحة الموكلين مباشرة.')
                    ),
                    React.createElement('button', {
                        onClick: onSkipOrClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'تخطي')
                ),

                // ── Step 2b: مفيش موكل ──
                clientStep === 'notfound' && React.createElement(React.Fragment, null,
                    // ⚡ NEW (7.2 جزء 2 — بند 2.4): عرض تقدّم "طرف X من Y".
                    partyList.length > 0 && React.createElement('p', {
                        className: 'text-[10px] font-bold text-premium-gold text-center'
                    }, `طرف ${partyIndex + 1} من ${partyList.length}`),
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '👤'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'ربط الموكل بالقضية'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, currentPartyName
                            ? `"${currentPartyName}" غير موجود في الموكلين`
                            : 'لا يوجد اسم موكل في البيانات')
                    ),
                    !!currentPartyName?.trim() && React.createElement('div', { className: 'space-y-2 pt-1' },
                        React.createElement('button', {
                            onClick: handleAddAndLinkClient,
                            disabled: linkingToCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '➕'),
                            React.createElement('span', null, linkingToCase ? '⏳ جاري الإضافة...' : 'إضافة الموكل وربطه بالقضية')
                        )
                    ),
                    React.createElement('button', {
                        onClick: onSkipOrClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'تخطي')
                ),

                // ── Step 3: كل حاجة تمت ──
                clientStep === 'done' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-2 py-2' },
                        React.createElement('div', { className: 'text-3xl' }, '🎉'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'تم بنجاح'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, createdCaseId
                            ? 'تمت إضافة الجلسة وإنشاء القضية وربط الموكل'
                            : 'تمت إضافة الجلسة وربط الموكل بها')
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-3 rounded-2xl text-xs font-black text-premium-bg transition-all',
                        style: { background: 'linear-gradient(135deg,#d4af37,#f0c040)' }
                    }, 'إغلاق')
                )
            )
        ),
        document.body
    ) : null;

    const modal = React.createElement('div', {
        className: 'fixed inset-0 z-50 flex items-end justify-center',
        style: { background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' },
        onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }
    },
        React.createElement('div', {
            className: 'w-full max-w-lg rounded-t-3xl overflow-hidden',
            style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh' }
        },
            // ── هيدر ──
            React.createElement('div', {
                className: 'flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5'
            },
                React.createElement('div', { className: 'flex items-center gap-2' },
                    React.createElement('span', { className: 'text-xl' }, '⚡'),
                    React.createElement('div', null,
                        React.createElement('h2', { className: 'text-sm font-black text-white' }, linkMode === 'existing' ? 'إضافة جلسة' : 'جلسة مستقلة'),
                        React.createElement('p', { className: 'text-[10px] text-slate-400' }, linkMode === 'existing' ? 'لقضية موجودة' : 'بدون ربط بملف قضية')
                    )
                ),
                React.createElement('button', {
                    onClick: onClose,
                    className: 'w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-slate-400 text-sm hover:bg-white/10'
                }, '✕')
            ),

            // ── محتوى ──
            React.createElement('div', {
                className: 'overflow-y-auto px-5 py-4 space-y-3',
                style: { maxHeight: 'calc(92vh - 130px)' }
            },

                // ── تبديل: قضية مستقلة / قضية موجودة ──
                React.createElement('div', { className: 'flex items-center bg-white/5 rounded-2xl p-1 gap-1' },
                    React.createElement('button', {
                        onClick: () => setLinkMode('standalone'),
                        className: `flex-1 py-2 rounded-xl text-[11px] font-black transition-all ${linkMode === 'standalone' ? 'bg-premium-gold text-premium-bg' : 'text-slate-400'}`
                    }, 'قضية مستقلة'),
                    React.createElement('button', {
                        onClick: () => setLinkMode('existing'),
                        className: `flex-1 py-2 rounded-xl text-[11px] font-black transition-all ${linkMode === 'existing' ? 'bg-premium-gold text-premium-bg' : 'text-slate-400'}`
                    }, 'قضية موجودة')
                ),

                // ── اختيار قضية موجودة (يظهر بس في وضع "قضية موجودة") ──
                linkMode === 'existing' && React.createElement(React.Fragment, null,
                    React.createElement(Field, { label: 'ابحث عن القضية', required: true },
                        React.createElement('input', {
                            value: caseSearch,
                            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCaseSearch(e.target.value),
                            placeholder: 'اسم القضية، رقمها، أو اسم الموكل/الخصم',
                            className: inputCls,
                            style: inputStyle
                        })
                    ),
                    React.createElement('div', { className: 'max-h-40 overflow-y-auto space-y-1.5 rounded-xl' },
                        filteredCases.slice(0, 20).map((c: MappedCase) => React.createElement('button', {
                            key: c.id,
                            onClick: () => { setSelectedCaseId(c.id); setCaseSearch(''); },
                            className: `w-full text-right p-2.5 rounded-xl text-[11px] border transition-all ${selectedCaseId === c.id ? 'border-premium-gold bg-premium-gold/10 text-premium-gold' : 'border-white/10 bg-white/5 text-slate-300'}`
                        }, (c.title || 'بدون عنوان') + (c.number ? ' — ' + c.number : ''))),
                        filteredCases.length === 0 && React.createElement('p', { className: 'text-[10px] text-slate-500 text-center py-2' }, 'لا توجد نتائج')
                    ),
                    selectedCase && React.createElement('div', { className: 'p-2.5 rounded-xl bg-premium-gold/10 border border-premium-gold/20 text-[11px] text-premium-gold' },
                        '✓ القضية المختارة: ' + (selectedCase.title || selectedCase.number || '—')
                    )
                ),

                // ── بيانات القضية (يظهر بس في وضع "قضية مستقلة") ──
                linkMode === 'standalone' && React.createElement(React.Fragment, null,
                React.createElement(SectionTitle, null, '⚖️ بيانات القضية'),

                // المحكمة — نص حر
                React.createElement(Field, { label: 'المحكمة' },
                    React.createElement('input', {
                        value: form.court,
                        onChange: set('court'),
                        placeholder: 'مثال: محكمة جنوب القاهرة الابتدائية',
                        className: inputCls,
                        style: inputStyle
                    })
                ),

                // موضوع الجلسة / عنوان
                React.createElement(Inp, {
                    label: 'موضوع الجلسة / عنوان',
                    required: true,
                    value: form.title,
                    onChange: set('title'),
                    placeholder: 'مثال: قضية إيجار — استئناف'
                }),

                // رقم القضية + السنة
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Inp, {
                        label: 'رقم القضية',
                        value: form.case_number,
                        onChange: set('case_number'),
                        placeholder: 'مثال: 1234'
                    }),
                    React.createElement(Inp, {
                        label: 'السنة',
                        value: form.case_year,
                        onChange: set('case_year'),
                        placeholder: 'مثال: 2024'
                    })
                ),

                // نوع القضية + الدائرة جمب بعض
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Sel, {
                        label: 'نوع القضية',
                        value: form.case_type,
                        onChange: set('case_type'),
                        options: [{ value: '', label: '— اختر —' }, ...CASE_TYPES.map((t: string) => ({ value: t, label: t }))]
                    }),
                    React.createElement(Inp, {
                        label: 'الدائرة',
                        value: form.circuit_number,
                        onChange: set('circuit_number'),
                        placeholder: 'مثال: الدائرة 7'
                    })
                ),
                form.case_type === 'أخرى' && React.createElement(Inp, {
                    label: 'نوع القضية (تفصيل)',
                    value: form.case_type_custom,
                    onChange: set('case_type_custom'),
                    placeholder: 'مثال: أحوال شخصية'
                })
                ),

                // درجة التقاضي — نفس أزرار مودال إنشاء القضية بالظبط
                React.createElement(Field, { label: 'درجة التقاضي' },
                    React.createElement('div', { className: 'flex gap-2' },
                        COURT_LEVELS.map((lvl: string) => React.createElement('button', {
                            key: lvl,
                            type: 'button',
                            onClick: () => setForm((f: Form) => ({ ...f, court_level: lvl })),
                            className: `flex-1 py-2.5 rounded-xl text-[10px] font-black transition-all active:scale-95 ${form.court_level === lvl ? 'bg-premium-gold text-premium-bg' : 'bg-white/5 border border-white/10 text-slate-400'}`
                        }, lvl))
                    ),
                    form.court_level === 'أخرى' && React.createElement('input', {
                        value: form.court_level_other,
                        onChange: set('court_level_other'),
                        placeholder: 'اكتب درجة التقاضي',
                        className: `${inputCls} mt-2`,
                        style: inputStyle
                    })
                ),

                // تاريخ الجلسة + توقيت الجلسة
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Field, { label: 'تاريخ الجلسة', required: true },
                        React.createElement('input', {
                            type: 'date',
                            value: form.session_date,
                            onChange: set('session_date'),
                            className: inputCls,
                            style: inputStyle
                        })
                    ),
                    React.createElement(Sel, {
                        label: 'توقيت الجلسة',
                        value: form.session_time,
                        onChange: set('session_time'),
                        options: [
                            { value: 'صباحي', label: '🌅 صباحي' },
                            { value: 'مسائي', label: '🌆 مسائي' },
                        ]
                    })
                ),

                // ── بيانات الخصوم ──
                // ⚡ CHANGED (مرحلة 6.1 — خطة تعدد الأطراف، 22 يوليو 2026): بدل
                // حقلي "الموكل"/"الخصم" المفردين، PartyFieldsGroup بيدعم عدد
                // بلا حدود من المدعين والمدعى عليهم، وأي عدد منهم ممكن يتحدد
                // كـ"موكلنا" (⭐) — نفس نمط مرحلة 4.1 (NewCaseModal.tsx) بالحرف.
                linkMode === 'standalone' && React.createElement(React.Fragment, null,
                React.createElement(SectionTitle, null, '👥 بيانات الخصوم'),
                React.createElement(PartyFieldsGroup, { controller: partyFields, testIdPrefix: 'new-session' })
                ),

                // ── الإجراء القادم ──
                React.createElement(SectionTitle, null, '⚡ الإجراء القادم'),
                React.createElement(Inp, {
                    label: 'الإجراء القادم',
                    value: form.next_action,
                    onChange: set('next_action'),
                    placeholder: 'مثال: تقديم مذكرة دفاع'
                }),

                // الطابق وقاعة الجلسة + قاعة/اسم/موبايل سكرتير الجلسة
                React.createElement(Inp, {
                    label: 'الطابق وقاعة الجلسة',
                    value: form.session_hall,
                    onChange: set('session_hall'),
                    placeholder: 'مثال: الدور الأول - قاعة 5'
                }),
                React.createElement(Inp, {
                    label: 'قاعة سكرتير الجلسة',
                    value: form.secretary_hall,
                    onChange: set('secretary_hall'),
                    placeholder: 'رقم أو اسم قاعة السكرتير'
                }),
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Inp, {
                        label: 'اسم سكرتير الجلسة',
                        value: form.secretary_name,
                        onChange: set('secretary_name'),
                        placeholder: 'اسم السكرتير'
                    }),
                    React.createElement(Inp, {
                        label: 'موبايل السكرتير',
                        value: form.secretary_mobile,
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f: Form) => ({ ...f, secretary_mobile: onlyDigits(e.target.value, 11) })),
                        placeholder: 'رقم الموبايل',
                        inputMode: 'numeric',
                        maxLength: 11
                    })
                ),

                React.createElement('div', { className: 'h-4' })
            ),

            // ── Footer ──
            React.createElement('div', {
                className: 'px-5 py-4 border-t border-white/5 flex gap-3'
            },
                React.createElement('button', {
                    onClick: onClose,
                    className: 'flex-1 py-3 rounded-2xl text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 transition-all'
                }, 'إلغاء'),
                React.createElement('button', {
                    onClick: handleSave,
                    disabled: saving || !form.session_date || (linkMode === 'existing' && !selectedCaseId),
                    className: 'flex-2 flex-grow-[2] py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-40',
                    style: { background: saving ? '#888' : 'linear-gradient(135deg,#d4af37,#f0c040)' }
                }, saving ? '⏳ جاري الحفظ...' : '✅ حفظ الجلسة')
            )
        )
    );

    return React.createElement(React.Fragment, null,
        createPortal(modal, document.body),
        postSave
    );
}
