import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '../../../shared/lib/notifications';
import { safeUpdate } from '../../../shared/lib/dataAccess';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { I } from '../../../constants';
import { Inp } from '@/shared/ui/Inp';
import { Sel } from '@/shared/ui/Sel';
import SessionUpdateModal from './SessionUpdateModal';
import DeleteConfirmModal from '@/shared/modals/DeleteConfirmModal';
import { useSessionLinking } from '../hooks/useSessionLinking';
// ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 6): كشف التعارض بين البيانات
// الحرة في الجلسة وملف الموكل المختار وقت الربط اليدوي اللاحق.
import { findClientDataMismatches, type FieldMismatch } from '../hooks/caseSessionLinkingShared';
// ⚡ NEW (خطة تعدد الأطراف، مرحلة 6.4، 23 يوليو 2026): نفس Component/هوك
// مشترك مرحلة 5.1 (EditCaseModal.tsx) و6.1 (NewStandaloneSessionModal.tsx)
// بالحرف — بدل حقلي "الموكل"/"الخصم" المفردين هنا كمان. استيراد
// validateFullNameParts القديم اتشال (مبقاش مستخدم — الفاليديشن كلها بقت
// من casePartiesValidation.ts).
import { usePartyFields } from '@/shared/parties/usePartyFields';
import { PartyFieldsGroup } from '@/shared/parties/PartyFieldsGroup';
import { validateParties } from '@/shared/lib/casePartiesValidation';
import type { PartyFieldValue, PartySide } from '@/shared/parties/partyTypes';
import type { CaseSessionRow, ClientRow } from '../../../types';
import type { MappedCase } from '../../../hooks/useAppData';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';

const CASE_TYPES = ['مدني', 'تجاري', 'جنائي', 'عمالي', 'إداري', 'أسرة', 'أخرى'];
const inputCls = 'w-full p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600';
const inputStyle = { fontFamily: 'Cairo,sans-serif' };
// 🔒 FIX (تقرير الموثوقية — نتيجة 4، ثم CHANGED مرحلة 6.4 خطة تعدد الأطراف):
// onlyDigits القديمة (كانت بتقيّد حقلي الرقم القومي المفردين) اتشالت —
// فاليديشن الرقم القومي بقت بالكامل من casePartiesValidation.ts (نفس تغيير
// EditCaseModal.tsx مرحلة 5.1)، والحقل نفسه بقى جوه PartyFields.tsx.

// ⚡ شكل صف case_parties كما بيرجع من الداتابيز — نفس الشكل بالحرف المستخدم
// في EditCaseModal.tsx (مرحلة 5.1)؛ case_parties لسه مش موجودة في
// database.types.ts (اتضافت بـ SQL مباشر) فمفيش طريقة نولّد بيها الأنواع
// من هنا من غير نت.
interface CasePartyRow {
    id: string;
    side: PartySide;
    is_client: boolean;
    name: string;
    capacity: string;
    national_id: string | null;
    address: string | null;
    power_of_attorney: string | null;
    client_id: string | null;
    sort_order: number;
}

interface EditStandaloneModalProps {
    session: CaseSessionRow;
    db: SupabaseClient<Database>;
    onClose: () => void;
    onSaved: () => void;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 3): نفس فكرة EditCaseModal.tsx
    // بالظبط — لو الجلسة مربوطة بموكل حي (session.client_id + الموكل موجود
    // فعليًا)، الاسم/الرقم القومي/بيانات التوكيل بتتقفل وتتيجي من ملف الموكل
    // مباشرة. **بدون** عنوان هنا لأن case_sessions مفيهاش عمود plaintiff_address
    // أصلاً (مؤكد من الخطة). لو الموكل محذوف/orphaned، linkedClient بتوصل
    // null والحقول تفضل حرة (fallback المرحلة السابعة).
    linkedClient?: ClientRow | null;
    onOpenClientProfile?: () => void;
}

interface StandaloneEditForm {
    court: string;
    title: string;
    case_number: string;
    case_year: string;
    case_type: string;
    case_type_custom: string;
    circuit_number: string;
    session_date: string;
    session_time: string;
    // ⚡ CHANGED (مرحلة 6.4 — خطة تعدد الأطراف، 23 يوليو 2026): حقول
    // الموكل/الخصم المفردة (plaintiff/plaintiff_role/plaintiff_national_id/
    // plaintiff_power_of_attorney/defendant/defendant_role/
    // defendant_national_id) اتشالت من هنا بالكامل — بقت جوه usePartyFields()
    // تحت (array أطراف بلا حدود)، نفس تقليص EditCaseForm في EditCaseModal.tsx
    // مرحلة 5.1 بالظبط.
    next_action: string;
}

// ══════════════════════════════════════════════════════════════
//  EditStandaloneModal (outer shell) — مرحلة 6.4 من خطة تعدد الأطراف: نفس
//  فكرة EditCaseModal.tsx (مرحلة 5.1) بالحرف — قبل ما الفورم الحقيقي
//  (EditStandaloneModalForm تحت) يتبني، لازم نجيب أطراف الجلسة الموجودة
//  فعلاً من case_parties (بـ session_id مش case_id هنا)، عشان
//  usePartyFields() يتهيّأ بالقيم الصح من أول رندر. جلسة قديمة معهاش أي
//  صف في case_parties بترجع array فاضية، والفورم الداخلي بيعمل fallback
//  لبيانات الأعمدة القديمة (plaintiff/defendant) زي ما كان يحصل بالظبط
//  قبل التعديل ده.
// ══════════════════════════════════════════════════════════════
function EditStandaloneModal(props: EditStandaloneModalProps) {
    const { session, db } = props;
    const [partiesState, setPartiesState] = useState<{ loaded: boolean; rows: CasePartyRow[] }>({ loaded: false, rows: [] });

    useEffect(() => {
        let cancelled = false;
        setPartiesState({ loaded: false, rows: [] });
        (async () => {
            // ⚠️ case_parties بقت مضافة في database.types.ts (خطة تعدد
            // الأطراف، مرحلة 1) — مفيش داعي لكاست 'as cases' تاني هنا.
            const { data, error } = await db.from('case_parties')
                .select('*')
                .eq('session_id', session.id)
                .order('sort_order', { ascending: true });
            if (cancelled) return;
            // لو الاستعلام فشل: fallback لسلوك طرف واحد من الأعمدة القديمة
            // بدل ما نمنع فتح فورم التعديل بالكامل (نفس قرار EditCaseModal.tsx).
            setPartiesState({ loaded: true, rows: error ? [] : ((data as unknown as CasePartyRow[]) || []) });
        })();
        return () => { cancelled = true; };
    }, [session.id, db]);

    if (!partiesState.loaded) {
        return createPortal(
            React.createElement('div', {
                className: 'fixed inset-0 z-[60] flex items-center justify-center',
                style: { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }
            },
                React.createElement(I.Spin)
            ),
            document.body
        );
    }

    return React.createElement(EditStandaloneModalForm, { ...props, existingPartyRows: partiesState.rows });
}

interface EditStandaloneModalFormProps extends EditStandaloneModalProps {
    existingPartyRows: CasePartyRow[];
}

function EditStandaloneModalForm({ session, db, onClose, onSaved, linkedClient = null, onOpenClientProfile, existingPartyRows }: EditStandaloneModalFormProps) {
    // ⚡ NEW: الجلسة مربوطة فعليًا بموكل حي لو linkedClient موصول (مش null).
    const isLinked = !!linkedClient;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 7 — fallback الموكل
    // المحذوف): الجلسة عندها client_id فعلي، لكن الأب مش لاقي صف الموكل
    // (اتمسح/soft-deleted). الحقول بترجع حرة تلقائيًا (isLinked=false)
    // من غير أي تغيير هنا — الإضافة الوحيدة تنبيه واضح للمستخدم.
    const isOrphaned = !!session.client_id && !isLinked;
    const [form, setForm] = useState<StandaloneEditForm>({
        court: session.court || '',
        title: session.title || '',
        case_number: session.case_number?.split('/')?.[0] || '',
        case_year: session.case_number?.split('/')?.[1] || '',
        case_type: CASE_TYPES.includes(session.case_type as string) ? (session.case_type as string) : (session.case_type ? 'أخرى' : ''),
        case_type_custom: CASE_TYPES.includes(session.case_type as string) ? '' : (session.case_type || ''),
        circuit_number: session.circuit_number || '',
        session_date: session.session_date || '',
        session_time: session.session_time || 'صباحي',
        next_action: session.next_action || '',
    });
    const [saving, setSaving] = useState(false);
    const set = (k: keyof StandaloneEditForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

    // ⚡ NEW (مرحلة 6.4 — خطة تعدد الأطراف): array أطراف الجلسة (مدعين
    // ومدعى عليهم، بلا حدود) بدل حقلي "الموكل"/"الخصم" المفردين القدامى —
    // نفس منطق EditCaseModal.tsx (مرحلة 5.1)، بس هنا القيم الابتدائية بتيجي
    // من case_parties (session_id) لو الجلسة دي دخل عليها بيانات فعلاً من
    // الفورم الجديد، وإلا fallback لنفس منطق الأعمدة القديمة (plaintiff/
    // defendant) — حساب لمرة واحدة بس وقت الـ mount.
    const [initialParties] = useState<{ plaintiffs: PartyFieldValue[]; defendants: PartyFieldValue[] }>(() => {
        if (existingPartyRows.length > 0) {
            const toField = (row: CasePartyRow): PartyFieldValue => ({
                id: row.id,
                side: row.side,
                is_client: row.is_client,
                name: row.name || '',
                capacity: row.capacity || '',
                national_id: row.national_id || '',
                address: row.address || '',
                power_of_attorney: row.power_of_attorney || '',
                client_id: row.client_id || null,
            });
            return {
                plaintiffs: existingPartyRows.filter((r) => r.side === 'plaintiff').map(toField),
                defendants: existingPartyRows.filter((r) => r.side === 'defendant').map(toField),
            };
        }
        // fallback لجلسة قديمة معهاش أي صف في case_parties لسه — طرف واحد
        // في كل جهة، بنفس القيم اللي كانت بتتعرض في الحقول المفردة القديمة
        // (بما فيها قفل بيانات الموكل المربوط لو isLinked). العنوان فاضي
        // دايمًا هنا — case_sessions مفيهاش عمود plaintiff_address أصلاً.
        // ⚠️ الـ id هنا نص ثابت ('legacy-plaintiff'/'legacy-defendant') مش
        // UUID حقيقي من case_parties — علامة واضحة لمنطق الحفظ تحت إن الصف
        // ده لسه ملوش نظير في الداتابيز (يحتاج INSERT مش UPDATE).
        return {
            plaintiffs: [{
                id: 'legacy-plaintiff',
                side: 'plaintiff' as PartySide,
                is_client: true,
                name: isLinked ? (linkedClient!.full_name || '') : (session.plaintiff || ''),
                capacity: session.plaintiff_role || '',
                national_id: isLinked ? (linkedClient!.national_id || '') : (session.plaintiff_national_id || ''),
                address: '',
                power_of_attorney: isLinked ? (linkedClient!.cr_number || '') : (session.plaintiff_power_of_attorney || ''),
                client_id: session.client_id || null,
            }],
            defendants: [{
                id: 'legacy-defendant',
                side: 'defendant' as PartySide,
                is_client: false,
                name: session.defendant || '',
                capacity: session.defendant_role || '',
                national_id: session.defendant_national_id || '',
                address: '',
                power_of_attorney: '',
                client_id: null,
            }],
        };
    });
    const partyFields = usePartyFields({ initialPlaintiffs: initialParties.plaintiffs, initialDefendants: initialParties.defendants });

    // الطرف اللي لازم يتقفل (readOnly) — الطرف المربوط فعليًا بموكل حي من
    // clients، بمطابقة client_id (بيتحسب مرة واحدة وقت الـ mount زي
    // initialParties فوق) — نفس فكرة EditCaseModal.tsx مرحلة 5.1.
    const [linkedPartyId] = useState<string | null>(() => {
        if (!isLinked) return null;
        const all = [...initialParties.plaintiffs, ...initialParties.defendants];
        return all.find((p) => p.client_id === session.client_id)?.id ?? null;
    });
    const renderPartyReadOnly = (party: PartyFieldValue) => party.id === linkedPartyId;

    // ⚡ NEW (مرحلة 6.4): مزامنة الحفظ الفعلي في case_parties — نفس فلسفة
    // syncCaseParties في useCaseActions.ts (مرحلة 5.2) بالحرف، بس بـ
    // session_id بدل case_id. existingIds بتيجي من existingPartyRows اللي
    // اتجابت وقت فتح الفورم (مفيش استعلام جديد وقت الحفظ)، فبتشتغل حتى
    // أوفلاين (window.__dbWrite بيتعامل مع الأوفلاين لوحده لكل نداء). صف
    // موجود في existingIds = UPDATE، صف مش موجود فيها (id مؤقت legacy-*/
    // party-*) = INSERT، صف كان موجود واختفى من الفورم دلوقتي = DELETE.
    type SyncPartiesResult = { ok: true } | { ok: false; reason: 'validation'; message: string } | { ok: false; reason: 'write' };
    const syncSessionParties = async (targetSessionId: string): Promise<SyncPartiesResult> => {
        const parties = partyFields.parties;
        const serverCheck = validateParties(parties);
        if (!serverCheck.valid) {
            return { ok: false, reason: 'validation', message: serverCheck.message || '⚠️ بيانات أطراف الدعوى غير مكتملة أو غير صحيحة' };
        }
        const existingIds = existingPartyRows.map((r) => r.id);
        const currentIds = new Set(parties.map((p) => p.id));
        let allOk = true;
        // 1) حذف أي صف كان موجود فعلاً وقت فتح الفورم واتشال منها دلوقتي
        for (const oldId of existingIds) {
            if (!currentIds.has(oldId)) {
                const delResult = await window.__dbWrite({ type: 'DELETE', table: 'case_parties', id: oldId });
                if (delResult.error) allOk = false;
            }
        }
        // 2) upsert لكل طرف موجود في الفورم دلوقتي
        for (let i = 0; i < parties.length; i++) {
            const p = parties[i];
            const rowData: Record<string, unknown> = {
                case_id: null,
                session_id: targetSessionId,
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
            const result = existingIds.includes(p.id)
                ? await window.__dbWrite({ type: 'UPDATE', table: 'case_parties', data: rowData, id: p.id })
                : await window.__dbWrite({ type: 'INSERT', table: 'case_parties', data: rowData });
            if (result.error) allOk = false;
        }
        return allOk ? { ok: true } : { ok: false, reason: 'write' };
    };

    const handleSave = async () => {
        if (!form.session_date) { toast('⚠️ تاريخ الجلسة مطلوب', true); return; }
        if (!form.title?.trim()) {
            toast('⚠️ يجب ملء الحقول الإجبارية المحددة بعلامة (*)', true);
            return;
        }
        // ⚡ CHANGED (مرحلة 6.4 — خطة تعدد الأطراف): فاليديشن أطراف الجلسة
        // كلها بقت من casePartiesValidation.ts (نفس قواعد NewCaseModal.tsx
        // مرحلة 4.1 وEditCaseModal.tsx مرحلة 5.1) بدل الفحوصات المفردة
        // القديمة (الاسم الثلاثي للخصم، طول الرقم القومي يدويًا).
        if (!partyFields.validation.valid) {
            toast(partyFields.validation.message || 'يرجى مراجعة بيانات أطراف الدعوى', true);
            return;
        }
        setSaving(true);
        const finalCaseType = form.case_type === 'أخرى' ? (form.case_type_custom || 'أخرى') : form.case_type;
        const fullCaseNumber = [form.case_number, form.case_year].filter(Boolean).join('/');
        // ⚡ NEW (مرحلة 6.4): "الطرف الأساسي" في كل جهة (أولوية لمن عليه ⭐،
        // وإلا أول طرف) بياخد مكان الحقول المفردة القديمة في مزامنة الأعمدة
        // القديمة — نفس آلية 4.1/5.1/6.1 بالحرف.
        const primaryPlaintiff = partyFields.plaintiffs.find((p) => p.is_client) || partyFields.plaintiffs[0];
        const primaryDefendant = partyFields.defendants.find((p) => p.is_client) || partyFields.defendants[0];
        const { success, conflict, error } = await safeUpdate(db, 'case_sessions', session.id, {
            court: form.court || null,
            title: form.title || null,
            case_number: fullCaseNumber || null,
            case_type: finalCaseType || null,
            circuit_number: form.circuit_number || null,
            session_date: form.session_date,
            session_time: form.session_time || null,
            plaintiff: primaryPlaintiff?.name || null,
            plaintiff_role: primaryPlaintiff?.capacity || null,
            plaintiff_national_id: primaryPlaintiff?.national_id || null,
            plaintiff_power_of_attorney: primaryPlaintiff?.power_of_attorney || null,
            defendant: primaryDefendant?.name || null,
            defendant_role: primaryDefendant?.capacity || null,
            defendant_national_id: primaryDefendant?.national_id || null,
            next_action: form.next_action || null,
        }, session.updated_at || null);
        // 🔒 FIX (تقرير الموثوقية — القسم 12، Concurrent Editing): توست بدل السكوت التام.
        if (conflict) { setSaving(false); toast('⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true); return; }
        if (!success) {
            setSaving(false);
            showErrorToast('session_save', error, 'تعذّر حفظ الجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'حفظ الجلسة');
            return;
        }
        // ⚡ NEW (مرحلة 6.4): مزامنة أطراف الدعوى الفعلية في case_parties —
        // بعد نجاح تحديث بيانات الجلسة نفسها، بالـ session_id الحقيقي
        // مباشرة (مفيش داعي لسنتينل، الجلسة أصلاً موجودة قبل التعديل).
        const partiesResult = await syncSessionParties(session.id);
        setSaving(false);
        if (!partiesResult.ok) {
            // 🔒 نفس مبدأ 4.3/5.2: توست واحد بس، برسالة الفاليديشن المحددة
            // لو ده السبب، أو رسالة عامة لو فشل الكتابة — من غير ما يمنع
            // نجاح حفظ الجلسة نفسها.
            toast(
                partiesResult.reason === 'validation'
                    ? partiesResult.message
                    : '⚠️ تم تعديل الجلسة، لكن حصل خطأ في مزامنة بعض أطراف الدعوى — راجعها بعد إعادة الفتح',
                true
            );
        }
        toast('✅ تم تعديل الجلسة');
        onSaved();
        onClose();
    };

    const modalTree = createPortal(
        React.createElement('div', {
            className: 'fixed inset-0 z-[60] flex items-end justify-center',
            style: { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' },
            onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }
        },
            React.createElement('div', {
                className: 'w-full max-w-lg rounded-t-3xl overflow-hidden',
                style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh' }
            },
                React.createElement('div', { className: 'flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5' },
                    React.createElement('div', { className: 'flex items-center gap-2' },
                        React.createElement('span', { className: 'text-xl' }, '✏️'),
                        React.createElement('h2', { className: 'text-sm font-black text-white' }, 'تعديل الجلسة المستقلة')
                    ),
                    React.createElement('button', { onClick: onClose, className: 'w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-slate-400' }, React.createElement(I.X))
                ),
                React.createElement('div', {
                    className: 'overflow-y-auto px-5 py-4 space-y-3',
                    style: { maxHeight: 'calc(92vh - 130px)' }
                },
                    React.createElement(Inp, { label: 'المحكمة', value: form.court, onChange: set('court'), placeholder: 'مثال: محكمة جنوب القاهرة' }),
                    React.createElement(Inp, { label: 'موضوع الجلسة / عنوان', required: true, value: form.title, onChange: set('title'), placeholder: 'مثال: قضية إيجار' }),
                    React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                        React.createElement(Inp, { label: 'رقم القضية', value: form.case_number, onChange: set('case_number'), placeholder: '1234' }),
                        React.createElement(Inp, { label: 'السنة', value: form.case_year, onChange: set('case_year'), placeholder: '2024' })
                    ),
                    React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                        React.createElement(Sel, { label: 'نوع القضية', value: form.case_type, onChange: set('case_type'), options: [{ value: '', label: '— اختر —' }, ...CASE_TYPES.map((t: string) => ({ value: t, label: t }))] }),
                        React.createElement(Inp, { label: 'الدائرة', value: form.circuit_number, onChange: set('circuit_number'), placeholder: 'الدائرة 7' })
                    ),
                    form.case_type === 'أخرى' && React.createElement(Inp, { label: 'نوع القضية (تفصيل)', value: form.case_type_custom, onChange: set('case_type_custom'), placeholder: 'أحوال شخصية' }),
                    React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                        React.createElement('div', null,
                            React.createElement('label', { className: 'block text-[10px] font-bold text-slate-400 mb-1.5' }, 'تاريخ الجلسة', React.createElement('span', { className: 'text-rose-400 mr-0.5' }, ' *')),
                            React.createElement('input', { type: 'date', value: form.session_date, onChange: set('session_date'), className: inputCls, style: inputStyle })
                        ),
                        React.createElement(Sel, { label: 'توقيت الجلسة', value: form.session_time, onChange: set('session_time'), options: [{ value: 'صباحي', label: '🌅 صباحي' }, { value: 'مسائي', label: '🌆 مسائي' }] })
                    ),
                    React.createElement('div', { className: 'border-t border-white/5 my-1' }),
                    // ══════════════ أطراف الدعوى ══════════════
                    // ⚡ CHANGED (مرحلة 6.4 — خطة تعدد الأطراف، 23 يوليو 2026):
                    // بدل حقلي "الموكل"/"الخصم" المفردين، PartyFieldsGroup
                    // بيدعم عدد بلا حدود من المدعين والمدعى عليهم — نفس تغيير
                    // EditCaseModal.tsx (مرحلة 5.1) بالحرف. الطرف المربوط فعليًا
                    // بموكل حي (linkedPartyId فوق) بيتقفل (readOnly).
                    isLinked && React.createElement('div', { className: 'flex items-center justify-between' },
                        React.createElement('p', { className: 'text-[9px] text-slate-500' }, '🔗 مربوط بموكل من النظام — بيانات الطرف ده بتتقرا من ملف الموكل'),
                        onOpenClientProfile && React.createElement('button', {
                            type: 'button', onClick: onOpenClientProfile,
                            className: 'text-[9px] font-black text-premium-gold shrink-0'
                        }, '✏️ عدّل من ملف الموكل')
                    ),
                    // ⚡ NEW (مرحلة 7 — fallback الموكل المحذوف): الجلسة كانت
                    // مربوطة بموكل اتحذف بعد كده. الحقول تحت رجعت حرة بقيمها
                    // الأخيرة المحفوظة في عمود الجلسة نفسه (مفيش كراش/فراغ).
                    isOrphaned && React.createElement('div', { className: 'bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2', 'data-testid': 'edit-standalone-orphaned-client-warning' },
                        React.createElement('p', { className: 'text-[9px] text-amber-400 font-bold leading-relaxed' },
                            '⚠️ الموكل محذوف — البيانات دي آخر ما هو معروف عن الموكل، وبقت قابلة للتعديل الحر.'
                        )
                    ),
                    React.createElement(PartyFieldsGroup, { controller: partyFields, testIdPrefix: 'edit-standalone-session', renderPartyReadOnly }),
                    React.createElement('div', { className: 'border-t border-white/5 my-1' }),
                    React.createElement(Inp, { label: 'الإجراء القادم', value: form.next_action, onChange: set('next_action'), placeholder: 'مثال: تقديم مذكرة دفاع' }),
                    React.createElement('div', { className: 'h-4' })
                ),
                React.createElement('div', { className: 'px-5 py-4 border-t border-white/5 flex gap-3' },
                    React.createElement('button', { onClick: onClose, className: 'flex-1 py-3 rounded-2xl text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 transition-all' }, 'إلغاء'),
                    React.createElement('button', {
                        onClick: handleSave, disabled: saving || !form.session_date,
                        className: 'flex-grow-[2] py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-40',
                        style: { background: saving ? '#888' : 'linear-gradient(135deg,#d4af37,#f0c040)' }
                    }, saving ? '⏳ جاري الحفظ...' : '✅ حفظ التعديلات')
                )
            )
        ),
        document.body
    );

    return modalTree;
}

// ══════════════════════════════════════════
//  موديل "🔗 ربط" — متاح في أي وقت على جلسة مستقلة محفوظة بالفعل
//  (نفس خيارات البوب أب اللي بيظهر أول مرة بعد الحفظ + خيار جديد:
//  ربط بموكل موجود بالفعل من غير إنشاء قضية)
// ══════════════════════════════════════════
interface LinkSessionModalProps {
    session: CaseSessionRow;
    db: SupabaseClient<Database>;
    onClose: () => void;
    onDone: () => void;
    // ⚠️ [مهم] لازم يتنادى (مش onClose بس) في أي خطوة بعد ما قضية جديدة
    // اتعملت فعلاً (found/notfound/done) — عشان يقفل StandaloneSessionDetailModal
    // بالكامل وراه، مش موديل الربط بس. لو سبناه مفتوح، هيفضل شايل نسخة
    // قديمة من الجلسة (case_id: null) في الذاكرة رغم إنها بقت مربوطة
    // فعليًا في الداتابيز — ولو المستخدم دوس "🗑 حذف" من هنا هيحذف جلسة
    // بقت جزء من قضية حقيقية من غير ما ياخد باله.
    onFullClose: () => void;
    // ⚡ [جديد] بينادى بس لما موكل جديد فعليًا يتضاف (مش أي إجراء ربط
    // عادي) — عشان قائمة الموكلين في التطبيق كله تتحدّث فورًا، بدل ما
    // الموكل الجديد يفضل مخفي لحد ما المستخدم يدخل تاب الموكلين يدويًا.
    onClientAdded?: () => void;
    // ⚡ FIX: الموكل ممكن يكون اتربط بالجلسة بالفعل من غير ما القضية
    // تتعمل (LinkSessionModal بقى بيتفتح طول ما !hasCase بس) — الفلاج ده
    // بيخفي اختيارات "إضافة/ربط موكل" بس، ويسيب "إنشاء ملف قضية" ظاهرة.
    hasClient?: boolean;
    // 🔧 FIX (خطة توحيد مصدر بيانات الموكل، مرحلة 6): البروب ده كان
    // مفقود من الـ interface والاستدعاء في StandaloneSessionDetailModal
    // خالص، رغم إن جسم الدالة تحت بيستخدمه (بيتبعت لـ useSessionLinking)
    // — متغيّر حر مش معرّف في أي scope، كان المفروض يطلع TS error فعلي
    // (tsc --noEmit) لو اتشغل. المعنى العملي: فيكس فاز 5 (handleLinkCase
    // بياخد بيانات الموكل الحي بدل نسخة الجلسة) ما كانش بيشتغل خالص لما
    // اللينك مودال ده هو نقطة الدخول (كان دايمًا undefined، فبيرجع
    // لنسخة الجلسة تلقائيًا). دلوقتي بيتوصل من الأب زي EditStandaloneModal
    // وSessionUpdateModal بالظبط.
    linkedClient?: ClientRow | null;
}

function LinkSessionModal({ session, db, onClose, onDone, onFullClose, onClientAdded, hasClient, linkedClient }: LinkSessionModalProps) {
    const {
        linkingCase, linkingClient, linkingToCase, linkingExisting,
        clientStep, setClientStep, foundClient, foundClientMatchType,
        clientSearch, searchResults, searching, selectedExistingClient, setSelectedExistingClient,
        // ⚡ NEW (7.2 جزء 2 — بند 2.4): partyList/partyIndex لعرض "طرف X من Y"،
        // وhandleSkipParty لتخطي الطرف الحالي بس وقت الـ wizard (بدل onFullClose
        // اللي بيقفل الموديل كله — مسار الجلسات القديمة قبل مرحلة 6).
        partyList, partyIndex, handleSkipParty,
        handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
        searchExistingClients, confirmLinkToExistingClient,
    } = useSessionLinking(session, db, onDone, onClientAdded, linkedClient);

    const hasPlaintiff = !!session.plaintiff?.trim();
    // ⚡ NEW (7.2 جزء 2 — بند 2.4): في وضع الـ wizard (partyList فيها أطراف)،
    // اسم الطرف الحالي بيحل محل session.plaintiff — غير كده (جلسة قديمة، صفر
    // تغيير سلوك) بنفضل نستخدم session.plaintiff زي ما هو.
    const currentPartyName = partyList.length > 0 ? (partyList[partyIndex]?.name || null) : (session.plaintiff || null);
    const onSkipOrFullClose = partyList.length > 0 ? handleSkipParty : onFullClose;
    // ⚡ NEW (مرحلة 6): الحقول المتعارضة بين بيانات الجلسة الحرة وملف
    // الموكل المختار من البحث اليدوي — بتتحسب لما يدوس "تأكيد الربط".
    const [pendingMismatches, setPendingMismatches] = useState<FieldMismatch[]>([]);
    const [showMismatchConfirm, setShowMismatchConfirm] = useState(false);

    return createPortal(
        React.createElement('div', {
            className: 'fixed inset-0 z-[60] flex items-center justify-center px-4',
            style: { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }
        },
            React.createElement('div', {
                className: 'w-full max-w-sm rounded-3xl p-6 space-y-4',
                style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)' }
            },

                // ── Step: idle — الخيارات الأساسية ──
                clientStep === 'idle' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '🔗'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'ربط الجلسة'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'اختر الإجراء المطلوب')
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
                        hasPlaintiff && !hasClient && React.createElement('button', {
                            onClick: handleAddClientOnly,
                            disabled: linkingClient,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '👤'),
                            React.createElement('span', null, linkingClient ? '⏳ جاري الإضافة...' : 'إضافة الموكل لقائمة الموكلين فقط')
                        ),
                        !hasClient && React.createElement('button', {
                            onClick: () => setClientStep('searching'),
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '🔗'),
                            React.createElement('span', null, 'ربط بموكل موجود بالفعل')
                        )
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'إغلاق')
                ),

                // ── Step: searching — بحث يدوي في الموكلين الموجودين ──
                clientStep === 'searching' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '🔍'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'ابحث عن موكل موجود'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'بالاسم أو الرقم القومي أو الهاتف')
                    ),
                    React.createElement('input', {
                        value: clientSearch,
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => searchExistingClients(e.target.value),
                        placeholder: 'اكتب اسم الموكل...',
                        className: inputCls,
                        style: inputStyle
                    }),
                    React.createElement('div', { className: 'max-h-48 overflow-y-auto space-y-1.5' },
                        searching && React.createElement('p', { className: 'text-[10px] text-slate-500 text-center py-2' }, '⏳ جاري البحث...'),
                        !searching && clientSearch.trim() && searchResults.length === 0 && React.createElement('p', { className: 'text-[10px] text-slate-500 text-center py-2' }, 'لا توجد نتائج'),
                        !searching && searchResults.map((c) => React.createElement('button', {
                            key: c.id,
                            onClick: () => { setSelectedExistingClient(c); setShowMismatchConfirm(false); setPendingMismatches([]); },
                            className: `w-full text-right p-2.5 rounded-xl text-[11px] border transition-all ${selectedExistingClient?.id === c.id ? 'border-premium-gold bg-premium-gold/10 text-premium-gold' : 'border-white/10 bg-white/5 text-slate-300'}`
                        }, (c.client_name || c.full_name || 'بدون اسم') + (c.national_id ? ' — ' + c.national_id : '')))
                    ),
                    selectedExistingClient && React.createElement('div', { className: 'p-2.5 rounded-xl bg-premium-gold/10 border border-premium-gold/20 text-[11px] text-premium-gold' },
                        '✓ الموكل المختار: ' + (selectedExistingClient.client_name || selectedExistingClient.full_name || '—')
                    ),
                    // ⚡ NEW (مرحلة 6): تنبيه تعارض بدل استبدال صامت — بيظهر بس لو فيه
                    // فرق حقيقي بين بيانات الجلسة الحرة وملف الموكل المختار.
                    showMismatchConfirm && pendingMismatches.length > 0 && React.createElement('div', { className: 'p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2' },
                        React.createElement('p', { className: 'text-[11px] font-black text-amber-400' }, '⚠️ القيم دي مختلفة عن ملف الموكل:'),
                        pendingMismatches.map((m: FieldMismatch) => React.createElement('div', { key: m.field, className: 'text-[10px]' },
                            React.createElement('span', { className: 'text-slate-400 font-bold' }, m.label + ': '),
                            React.createElement('span', { className: 'text-slate-300' }, `في الجلسة "${m.freeTextValue}"`),
                            React.createElement('span', { className: 'text-slate-500' }, ' ← '),
                            React.createElement('span', { className: 'text-premium-gold' }, `في ملف الموكل "${m.clientValue}"`)
                        )),
                        React.createElement('p', { className: 'text-[10px] text-slate-400' }, 'هل تحفظ باستخدام بيانات الموكل؟')
                    ),
                    selectedExistingClient && React.createElement('button', {
                        onClick: () => {
                            if (!showMismatchConfirm) {
                                const mismatches = findClientDataMismatches(
                                    {
                                        plaintiff: session.plaintiff,
                                        plaintiff_national_id: session.plaintiff_national_id,
                                        plaintiff_power_of_attorney: session.plaintiff_power_of_attorney,
                                        // case_sessions مفيهاش عمود عنوان أصلاً (فاز 3) — undefined
                                        // يخلي findClientDataMismatches يتجاهل مقارنة العنوان تلقائيًا.
                                    },
                                    selectedExistingClient,
                                );
                                if (mismatches.length > 0) { setPendingMismatches(mismatches); setShowMismatchConfirm(true); return; }
                            }
                            confirmLinkToExistingClient();
                        },
                        disabled: linkingExisting,
                        'data-testid': 'link-existing-client-confirm',
                        className: 'w-full py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-40',
                        style: { background: linkingExisting ? '#888' : 'linear-gradient(135deg,#d4af37,#f0c040)' }
                    }, linkingExisting ? '⏳ جاري الربط...' : (showMismatchConfirm ? '✅ نعم، استخدم بيانات الموكل' : '🔗 تأكيد الربط')),
                    React.createElement('button', {
                        onClick: () => { if (showMismatchConfirm) { setShowMismatchConfirm(false); setPendingMismatches([]); } else setClientStep('idle'); },
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, showMismatchConfirm ? 'إلغاء' : 'رجوع')
                ),

                // ── Step: found — بعد إنشاء القضية، لقينا موكل مطابق ──
                clientStep === 'found' && React.createElement(React.Fragment, null,
                    // ⚡ NEW (7.2 جزء 2 — بند 2.4): عرض تقدّم الـ wizard "طرف X من Y".
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
                        // ⚡ FIX: زي NewStandaloneSessionModal.tsx بالظبط — لو التطابق
                        // مؤكد (نفس الاسم بالظبط أو نفس الرقم القومي/التوكيل)، زرار
                        // "إضافة موكل جديد" كان بيوصل لطريق مسدود صامت: handleAddAndLinkClient
                        // بينده checkClientDuplicate بنفس البيانات فيرفضه ويرجّع نفس
                        // خطوة 'found' من غير أي رد فعل ظاهر للمستخدم. نعرضه بس لما
                        // يكون التطابق تخمين بالاسم فقط (fuzzy).
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
                        onClick: onSkipOrFullClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'تخطي')
                ),

                // ── Step: notfound — بعد إنشاء القضية، مفيش موكل مطابق ──
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
                        onClick: onSkipOrFullClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'تخطي')
                ),

                // ── Step: done ──
                clientStep === 'done' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-2 py-2' },
                        React.createElement('div', { className: 'text-3xl' }, '🎉'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'تم بنجاح'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'تم تنفيذ الربط بنجاح')
                    ),
                    React.createElement('button', {
                        onClick: onFullClose,
                        className: 'w-full py-3 rounded-2xl text-xs font-black text-premium-bg transition-all',
                        style: { background: 'linear-gradient(135deg,#d4af37,#f0c040)' }
                    }, 'إغلاق')
                )
            )
        ),
        document.body
    );
}

interface StandaloneSessionDetailModalProps {
    session: CaseSessionRow;
    db: SupabaseClient<Database>;
    onClose: () => void;
    onDone: () => void;
    onNotify?: (msg: string) => void;
    onClientAdded?: () => void;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 3): لازمين عشان نلاقي
    // الموكل الحي المرتبط بالجلسة (session.client_id) ونمرره لـ
    // EditStandaloneModal، ونفتح تفاصيل الموكل من زرار "✏️ عدّل من ملف الموكل".
    clients?: ClientRow[];
    onOpenClientProfile?: (client: ClientRow) => void;
}

function StandaloneSessionDetailModal({ session: partialSession, db, onClose, onDone, onNotify, onClientAdded, clients = [], onOpenClientProfile }: StandaloneSessionDetailModalProps) {
    const [showUpdate, setShowUpdate] = useState(false);
    const [showEdit, setShowEdit] = useState(false);
    const [showLink, setShowLink] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // ⚡ NEW (نقل زرار فك الربط من EditStandaloneModal لجنب سطر "👤 الموكل"
    // هنا مباشرة — منفصل تمامًا عن زرار "🔗 ربط" اللي وظيفته تحويل الجلسة
    // لقضية، مش ربط الموكل).
    const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
    const [unlinkingClient, setUnlinkingClient] = useState(false);

    // ⚡ [حل جذري] الـ session الجاي كـ prop غالبًا مصدره استعلام select()
    // مبني بأعمدة محدودة (CalendarTab.tsx / useDashboardFeed.ts، مبنيين
    // كده عمدًا لتخفيف تحميل قوائم العرض) — فمش فيه plaintiff_national_id/
    // plaintiff_power_of_attorney/defendant_national_id وغيرهم. من غير
    // الفتش ده، أي إجراء هنا (تعديل/تحديث الجلسة/ربط) هيسجّل null في
    // الحقول دي بدل القيمة الحقيقية ("البيانات بتطير"). فبمجرد ما
    // المودال يفتح، بنجيب الصف كامل (select *) بالـ id مرة واحدة،
    // ونستخدمه هو بس في كل حاجة تحت (عرض + تمرير لكل الموديلات
    // الفرعية) — مش الـ prop الناقص. كده أي عمود جديد يتضاف مستقبلاً
    // في case_sessions بيوصل تلقائي من غير ما نلمس أي select() تاني.
    const [fullSession, setFullSession] = useState<CaseSessionRow>(partialSession);
    const [loadingFull, setLoadingFull] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoadingFull(true);
        db.from('case_sessions').select('*').eq('id', partialSession.id).single()
            .then(({ data, error }) => {
                if (cancelled) return;
                if (!error && data) setFullSession(data as CaseSessionRow);
                setLoadingFull(false);
            });
        return () => { cancelled = true; };
    }, [partialSession.id, db]);

    const session = fullSession;
    // زرار "🔗 ربط" بيتاح طول ما لسه مفيش قضية اتعملت من الجلسة دي —
    // مش شرطه إن الموكل يكون لسه مش مربوط. ربط/إضافة الموكل حاجة مستقلة
    // تمامًا عن إنشاء القضية، فمينفعش اختفاء واحد يخفي التاني.
    const hasCase = !!session.case_id;
    const hasClient = !!session.client_id;
    // ⚡ NEW: الموكل الحي المرتبط بالجلسة (لو موجود وغير محذوف) — بيتمرر
    // لـ EditStandaloneModal عشان يقفل حقول الموكل الثلاثة.
    const linkedClient = session.client_id ? (clients.find((c) => c.id === session.client_id) || null) : null;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 7 — fallback الموكل
    // المحذوف): hasClient=true (session.client_id موجود) لكن linkedClient
    // طلع null — يعني الموكل ده اتحذف (soft-deleted) بعد ما الجلسة
    // اتربطت بيه، مش إن الجلسة مش مربوطة بحد أصلاً.
    const isOrphaned = hasClient && !linkedClient;

    // كائن قضية اصطناعي خفيف بيتبنى من بيانات الجلسة المستقلة نفسها (مفيش قضية حقيقية أصلاً)
    // عشان يتمرر لـ SessionUpdateModal اللي بيتوقع caseData: MappedCase — نفس القيم بالظبط
    // اللي كانت بتتبني قبل التنظيف، مع كاست موثّق واحد لأن الشكل مش مطابق 100% لـ MappedCase
    // الحقيقي (الحقول دي بس شكل محلي يخدم الحقول اللي SessionUpdateModal.tsx بيقرأها فعليًا:
    // id/title/number/court).
    const caseData = {
        id: null,
        title: session.title || session.case_number || 'جلسة مستقلة',
        number: session.case_number || null,
        court: session.court || null,
        plaintiff: session.plaintiff || null,
        defendant: session.defendant || null,
        type: session.case_type || null,
        case_type: session.case_type || null,
    } as unknown as MappedCase;

    const rows: { label: string; value: string | null }[] = [
        { label: '📅 التاريخ', value: session.session_date || null },
        { label: '🕐 التوقيت', value: session.session_time || null },
        { label: '🏛 المحكمة', value: session.court || null },
        { label: '📋 رقم القضية', value: session.case_number || null },
        { label: '📂 نوع القضية', value: session.case_type || null },
        { label: '⚖️ الدائرة', value: session.circuit_number || null },
        { label: '👤 الموكل', value: session.plaintiff || null },
        { label: '🏷 صفة الموكل', value: session.plaintiff_role || null },
        { label: '👤 الخصم', value: session.defendant || null },
        { label: '🏷 صفة الخصم', value: session.defendant_role || null },
        { label: '⚡ الإجراء القادم', value: session.next_action || null },
        { label: '📝 ما تم', value: session.result || null },
    ].filter((r) => r.value);

    const handleDelete = async () => {
        setDeleting(true);
        try {
            const { error } = await db.from('case_sessions').delete().eq('id', session.id);
            if (error) {
                showErrorToast('session_delete', error, 'تعذّر حذف الجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'حذف الجلسة');
                return;
            }
            toast('✅ تم حذف الجلسة');
            onDone();
            onClose();
        } catch { toast('❌ خطأ غير متوقع', true); }
        finally { setDeleting(false); setShowConfirmDelete(false); }
    };

    // ⚡ NEW: نفس منطق handleUnlink اللي كان جوه EditStandaloneModal بالظبط
    // (كتابة مباشرة على case_sessions.client_id عبر safeUpdate)، بس هنا
    // بيحدّث fullSession محليًا كمان عشان زرار الربط/فك الربط يتحدّث فورًا
    // من غير ما يقفل الشاشة (بعكس الحذف).
    const handleUnlinkClient = async () => {
        setUnlinkingClient(true);
        const { success, conflict, error } = await safeUpdate(db, 'case_sessions', session.id, { client_id: null }, session.updated_at || null);
        setUnlinkingClient(false);
        if (conflict) { toast('⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true); return; }
        if (!success) {
            showErrorToast('session_unlink', error, 'تعذّر فك ربط الجلسة عن الموكل. حاول مرة أخرى.', 'فك ربط الجلسة');
            return;
        }
        toast('✅ تم فك الربط — بيانات الموكل في الجلسة بقت قابلة للتعديل الحر');
        setFullSession((prev) => ({ ...prev, client_id: null }));
        setShowUnlinkConfirm(false);
        onDone();
    };

    const modal = React.createElement('div', {
        className: 'fixed inset-0 z-50 flex items-end justify-center',
        style: { background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' },
        onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }
    },
        React.createElement('div', {
            className: 'w-full max-w-lg rounded-t-3xl overflow-hidden',
            style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '90vh' }
        },
            // ── هيدر ──
            React.createElement('div', { className: 'flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5' },
                React.createElement('div', { className: 'flex items-center gap-2' },
                    React.createElement('span', { className: 'text-xl' }, '⚡'),
                    React.createElement('div', null,
                        React.createElement('h2', { className: 'text-sm font-black text-white' }, session.title || 'جلسة مستقلة'),
                        React.createElement('p', { className: 'text-[10px] text-amber-400/70' }, 'جلسة غير مرتبطة بملف قضية')
                    )
                ),
                React.createElement('button', {
                    onClick: onClose,
                    className: 'w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10'
                }, React.createElement(I.X))
            ),

            // ── تفاصيل ──
            React.createElement('div', {
                className: 'overflow-y-auto px-5 py-4 space-y-2',
                style: { maxHeight: 'calc(90vh - 160px)' }
            },
                ...rows.map(({ label, value }) => {
                    // ⚡ NEW: سطر "👤 الموكل" بس — لو الجلسة مربوطة بموكل حي
                    // (hasClient)، بيظهر تحته زرار "🔓 فك الربط" (منفصل تمامًا
                    // عن زرار "🔗 ربط" في الفوتر، اللي وظيفته تحويل الجلسة
                    // لقضية مش ربط الموكل).
                    if (label === '👤 الموكل' && hasClient) {
                        return React.createElement('div', {
                            key: label,
                            className: 'py-2 border-b border-white/5'
                        },
                            React.createElement('div', { className: 'flex items-start justify-between gap-3' },
                                React.createElement('span', { className: 'text-[10px] font-bold text-slate-500 shrink-0' }, label),
                                React.createElement('span', { className: 'text-[11px] font-semibold text-white text-left' }, value)
                            ),
                            // ⚡ NEW (مرحلة 7 — fallback الموكل المحذوف): الموكل
                            // المرتبط بالجلسة دي اتحذف — القيمة فوق آخر نسخة معروفة.
                            isOrphaned && React.createElement('p', {
                                className: 'text-[9px] text-amber-400 font-bold mt-1',
                                'data-testid': 'standalone-orphaned-client-note'
                            }, '⚠️ الموكل ده محذوف من قائمة الموكلين'),
                            showUnlinkConfirm
                                ? React.createElement('div', { className: 'mt-2 space-y-2' },
                                    React.createElement('p', { className: 'text-[9px] text-slate-500 leading-relaxed' },
                                        'متأكد؟ هيتصفّر ربط الجلسة بملف الموكل، وترجع بياناته قابلة للتعديل الحر.'
                                    ),
                                    React.createElement('div', { className: 'flex gap-2' },
                                        React.createElement('button', {
                                            disabled: unlinkingClient,
                                            onClick: handleUnlinkClient,
                                            className: 'flex-1 bg-rose-500 text-white rounded-lg py-1.5 text-[10px] font-black disabled:opacity-60'
                                        }, unlinkingClient ? '⏳ جارٍ فك الربط...' : 'نعم، افصل الربط'),
                                        React.createElement('button', {
                                            disabled: unlinkingClient,
                                            onClick: () => setShowUnlinkConfirm(false),
                                            className: 'flex-1 bg-white/5 border border-white/10 text-slate-300 rounded-lg py-1.5 text-[10px] font-black disabled:opacity-60'
                                        }, 'إلغاء')
                                    )
                                  )
                                : React.createElement('div', { className: 'flex justify-end mt-1' },
                                    React.createElement('button', {
                                        onClick: () => setShowUnlinkConfirm(true),
                                        className: 'text-[9px] font-black text-rose-400'
                                    }, '🔓 فك الربط')
                                  )
                        );
                    }
                    return React.createElement('div', {
                        key: label,
                        className: 'flex items-start justify-between gap-3 py-2 border-b border-white/5'
                    },
                        React.createElement('span', { className: 'text-[10px] font-bold text-slate-500 shrink-0' }, label),
                        React.createElement('span', { className: 'text-[11px] font-semibold text-white text-left' }, value)
                    );
                })
            ),

            // ── Footer ──
            React.createElement('div', { className: 'px-5 pb-5 pt-3 border-t border-white/5 space-y-2' },
                // زر تحديث الجلسة — كبير ذهبي
                React.createElement('button', {
                    onClick: () => setShowUpdate(true),
                    disabled: loadingFull,
                    className: 'w-full py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-50',
                    style: { background: 'linear-gradient(135deg,#d4af37,#f0c040)' }
                }, loadingFull ? '⏳ جاري تحميل بيانات الجلسة...' : '⚡ تحديث الجلسة'),

                // صف الأزرار الصغيرة
                React.createElement('div', { className: 'flex gap-2' },
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 transition-all'
                    }, 'إغلاق'),
                    !hasCase && React.createElement('button', {
                        onClick: () => setShowLink(true),
                        disabled: loadingFull,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-300 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-50'
                    }, '🔗 ربط'),
                    React.createElement('button', {
                        onClick: () => setShowEdit(true),
                        disabled: loadingFull,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-300 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-50'
                    }, '✏️ تعديل'),
                    React.createElement('button', {
                        onClick: () => setShowConfirmDelete(true),
                        disabled: deleting,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-all disabled:opacity-40'
                    }, '🗑 حذف')
                )
            )
        )
    );

    return React.createElement(React.Fragment, null,
        createPortal(modal, document.body),
        showConfirmDelete && createPortal(React.createElement(DeleteConfirmModal, {
            title: "حذف الجلسة",
            itemName: session.title || session.case_number || 'جلسة مستقلة',
            itemType: "الجلسة",
            mode: "delete",
            loading: deleting,
            onConfirm: handleDelete,
            onCancel: () => setShowConfirmDelete(false)
        }), document.body),
        showEdit && React.createElement(EditStandaloneModal, {
            session, db,
            onClose: () => setShowEdit(false),
            onSaved: () => { onDone(); onClose(); },
            linkedClient,
            onOpenClientProfile: linkedClient ? () => { setShowEdit(false); onOpenClientProfile?.(linkedClient); } : undefined,
        }),
        showUpdate && React.createElement(SessionUpdateModal, {
            session, caseData, db,
            onClose: () => setShowUpdate(false),
            onDone: () => { onDone(); onClose(); },
            onNotify,
            linkedClient,
        }),
        showLink && React.createElement(LinkSessionModal, {
            session, db, hasClient,
            onClose: () => setShowLink(false),
            onDone,
            onFullClose: () => { setShowLink(false); onDone(); onClose(); },
            onClientAdded,
            linkedClient,
        })
    );
}

export default StandaloneSessionDetailModal;
