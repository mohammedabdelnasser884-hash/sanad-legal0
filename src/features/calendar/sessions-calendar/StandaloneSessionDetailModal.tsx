import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '../../../shared/lib/notifications';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { I } from '../../../constants';
import { Inp } from '@/shared/ui/Inp';
import { Sel } from '@/shared/ui/Sel';
import SessionUpdateModal from './SessionUpdateModal';
import DeleteConfirmModal from '@/shared/modals/DeleteConfirmModal';
// ⚡ CHANGED (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، المرحلة 6 — 9
// أغسطس 2026): useSessionLinking.ts بالكامل اتحذف (كان كود ميت 100% منذ
// المرحلة 2 — آخر مستهلك ليه كان LinkSessionModal). SessionWithLegacyFields
// بس هو اللي كان مستخدم فعليًا من الملف ده — اتنقل لـ types.ts.
import type { SessionWithLegacyFields } from '../../../types';
// ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 6): كشف التعارض بين البيانات
// الحرة في الجلسة وملف الموكل المختار وقت الربط اليدوي اللاحق.
import { findClientDataMismatches, syncSessionIdentityToGroupSiblings, fetchSessionClientParties, unlinkClientFromSessionParty } from '../hooks/caseSessionLinkingShared';
// ⚡ NEW (خطة تعدد الأطراف، مرحلة 6.4، 23 يوليو 2026): نفس Component/هوك
// مشترك مرحلة 5.1 (EditCaseModal.tsx) و6.1 (NewStandaloneSessionModal.tsx)
// بالحرف — بدل حقلي "الموكل"/"الخصم" المفردين هنا كمان. استيراد
// validateFullNameParts القديم اتشال (مبقاش مستخدم — الفاليديشن كلها بقت
// من casePartiesValidation.ts).
import { usePartyFields } from '@/shared/parties/usePartyFields';
import { PartyFieldsGroup } from '@/shared/parties/PartyFieldsGroup';
import { validateParties } from '@/shared/lib/casePartiesValidation';
// 🆕 (خطة حفظ المسودات التلقائي — 1 أغسطس 2026، آخر فورم في الخطة):
// نفس منطق EditCaseModal.tsx/NewStandaloneSessionModal.tsx بالحرف.
import { useFormDraft } from '@/shared/hooks/useFormDraft';
import { useUnsavedChangesGuard } from '@/shared/hooks/useUnsavedChangesGuard';
import type { PartyFieldValue, PartySide } from '@/shared/parties/partyTypes';
// ⚡ NEW (طلب "عرض تعدد الأطراف في مودال عرض الجلسة المستقلة" — 3 أغسطس
// 2026): نفس دالة الملخص المستخدمة في InfoSection.tsx (تفاصيل القضية) —
// "الاسم الأول + آخرين" بدل عرض شخص واحد بس بصفته "الموكل"/"الخصم" ثابتة.
import { summarizePartySide, type PartyPersonLike } from '@/shared/parties/partyDisplay';
// 🆕 (خطة توحيد قفل الطرف، المرحلة 2 — 6 أغسطس 2026)
import {
    getPartyState,
    isLinkedState,
    isOrphanState,
    isOrphanedLink,
    canUnlinkParty,
    getPartyStateMessage,
    getPartyStateBadge,
    type PartyDomainContext,
} from '@/shared/parties/partyDomainService';
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
    // 🆕 (خطة توحيد "ربط طرف بموكل موجود" — مرحلة 2، 6 أغسطس 2026): نفس
    // إضافة CasePartyRow في EditCaseModal.tsx بالحرف.
    updated_at: string | null;
}

interface EditStandaloneModalProps {
    session: SessionWithLegacyFields;
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
    // ⚡ CHANGED (قفل بيانات كل الأطراف المربوطة بموكل حقيقي، لا الطرف
    // الأساسي بس): نفس التغيير اللي حصل في EditCaseModal.tsx — بياخد
    // الموكل (ClientRow) بتاع الطرف اللي اتضغط عليه تحديدًا.
    onOpenClientProfile?: (client: ClientRow) => void;
    // ⚡ NEW: لازمة عشان نلاقي بيانات أي موكل مربوط بطرف *غير* الأساسي
    // (client_id بتاعه بيتحط وقت إنشاء الجلسة عن طريق الربط لكل طرف على حدة).
    clients?: ClientRow[];
    // ⚡ REMOVED (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، المرحلة 6 — 9
    // أغسطس 2026): openNewClientModal كانت هنا لزرار "➕ إنشاء موكل جديد"
    // جنب دروب-داون ربط طرف غير مربوط في EditStandaloneModalForm — الدروب-
    // داون والزرار اتشالوا بالكامل في المرحلة 3، فبقت prop بلا استخدام
    // داخلي من وقتها. اتشالت السلسلة كلها لحد المصدر (DashboardTab.tsx/
    // SessionsCalendar.tsx) — openNewClientModal نفسها في App.tsx لسه حية
    // (بتتستخدم في أماكن تانية زي NewCaseModal/EditCaseModal).
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

function EditStandaloneModalForm({ session, db, onClose, onSaved, linkedClient = null, onOpenClientProfile, existingPartyRows, clients = [] }: EditStandaloneModalFormProps) {
    // ⚡ NEW: الجلسة مربوطة فعليًا بموكل حي لو linkedClient موصول (مش null).
    const isLinked = !!linkedClient;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 7 — fallback الموكل
    // المحذوف): الجلسة عندها client_id فعلي، لكن الأب مش لاقي صف الموكل
    // (اتمسح/soft-deleted). الحقول بترجع حرة تلقائيًا (isLinked=false)
    // من غير أي تغيير هنا — الإضافة الوحيدة تنبيه واضح للمستخدم.
    // ⚡ CHANGED (خطة توحيد قفل الطرف، المرحلة 2): isOrphanedLink() الموحّدة
    // بدل الشرط المكتوب يدويًا — نفس النتيجة، مصدر واحد.
    const isOrphaned = isOrphanedLink(session.client_id, linkedClient);
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
                // 🆕 (خطة توحيد "ربط طرف بموكل موجود" — مرحلة 2): نفس
                // EditCaseModal.tsx بالحرف — تستخدمها syncSessionParties تحت
                // كـknownUpdatedAt.
                updated_at: row.updated_at || null,
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
    // ⚡ NEW (خطة توحيد قفل الطرف، المرحلة 2): سياق الربط الموحّد — نفس
    // فكرة EditCaseModal.tsx بالحرف (شوف تعليقها هناك للتفاصيل).
    const domainContext = useMemo<PartyDomainContext>(() => {
        const byId = new Map(clients.map((c) => [c.id, c]));
        if (linkedClient) byId.set(linkedClient.id, linkedClient);
        return { primaryClientId: session.client_id || null, clients: Array.from(byId.values()) };
    }, [clients, linkedClient, session.client_id]);

    const partyFields = usePartyFields({
        initialPlaintiffs: initialParties.plaintiffs,
        initialDefendants: initialParties.defendants,
        // 🆕 (خطة "المسمى القانوني" — مرحلة 3): تحميل القيمة الحالية من
        // session (لو موجودة) — نفس نمط EditCaseModal.tsx.
        initialLegalTitles: {
            plaintiff: session.plaintiff_legal_title || '',
            defendant: session.defendant_legal_title || '',
        },
        // 🆕 (المرحلة 2): نفس فكرة EditCaseModal.tsx — يغذّي فاليديشن
        // الاسم بالأطراف الـorphan فعليًا (إصلاح باگ 5.5).
        domainContext,
    });

    // الطرف اللي لازم يتقفل (readOnly) — الطرف المربوط فعليًا بموكل حي من
    // clients، بمطابقة client_id (بيتحسب مرة واحدة وقت الـ mount زي
    // initialParties فوق) — نفس فكرة EditCaseModal.tsx مرحلة 5.1.
    const [linkedPartyId] = useState<string | null>(() => {
        if (!isLinked) return null;
        const all = [...initialParties.plaintiffs, ...initialParties.defendants];
        return all.find((p) => p.client_id === session.client_id)?.id ?? null;
    });
    // ⚡ CHANGED (المرحلة 2): بدل !!party.client_id مباشرة — طرف orphan
    // (أساسي أو ثانوي) بيرجع false (قابل للتعديل الحر) دلوقتي.
    const renderPartyReadOnly = (party: PartyFieldValue) => isLinkedState(getPartyState(party, domainContext));
    // ⚡ CHANGED (المرحلة 2 — إصلاح باگ 5.1، dead-end حقيقي): قبل كده
    // الدالة دي كانت بترجع null بالكامل (مفيش أي محتوى إضافي خالص) لو
    // linkedPartyClient مش موجود — يعني طرف ثانوي اتربط بموكل وبعدين
    // الموكل اتمسح كان بيفضل مقفول (renderPartyReadOnly فوق) بلا أي مخرج:
    // بلا تنبيه، بلا زرار unlink (الملف ده أصلًا معهوش دروب-داون "ربط
    // بموكل من النظام" زي EditCaseModal.tsx — الإصلاح هنا هو أول زرار فك
    // ربط بيتضاف للملف ده أصلًا، مش بس تعديل موجود).
    // ⚡ NEW (خطة توحيد قفل الطرف — المرحلة 3، "preview قبل فك الربط"، 6
    // أغسطس 2026): نفس نمط EditCaseModal.tsx بالحرف — طرف LINKED فعليًا
    // (موكل حي) بيمر بخطوة تأكيد صغيرة قبل ما زرار "🔓 فك الربط" ينفذ.
    // طرف ORPHAN_PARTY (مالوش موكل حي أصلًا) بيتفك على طول زي ما كان،
    // مفيش حاجة تستاهل preview لموكل اتمسح بالفعل.
    const [unlinkConfirmPartyId, setUnlinkConfirmPartyId] = useState<string | null>(null);

    // ⚡ REMOVED (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، Phase 3 — 9
    // أغسطس 2026): linkClientToParty/requestLinkClientToParty/
    // applyCreatedClientToParty (دروب-داون "ربط بموكل من النظام" + زرار
    // "➕ إنشاء موكل جديد" لطرف غير مربوط) اتشالوا بالكامل. طرف غير مربوط
    // في الجلسة المستقلة دلوقتي بيفضل حر بلا أي طريق ربط/إنشاء موكل —
    // ده بيحصل بس بعد التحويل لقضية.

    const renderPartyExtra = (party: PartyFieldValue) => {
        if (party.id === linkedPartyId || !party.is_client) return null;
        const state = getPartyState(party, domainContext);
        const linkedPartyClient = clients.find((c) => c.id === party.client_id) || null;
        const confirmingUnlink = unlinkConfirmPartyId === party.id;
        if (!party.client_id) {
            // ⚡ REMOVED (Phase 3، 9 أغسطس 2026): طرف غير مربوط أصلًا —
            // مفيش دروب-داون ربط ولا زرار إنشاء موكل هنا تاني (كانا هنا
            // قبل كده). الطرف بيفضل بيانات حرة قابلة للتعديل، والربط/
            // الإنشاء بيبقى متاح بس بعد تحويل الجلسة لقضية.
            return null;
        }
        return React.createElement('div', { className: 'space-y-2' },
            isOrphanState(state) && React.createElement('div', { className: 'bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2', 'data-testid': `edit-standalone-session-party-orphaned-warning-${party.id}` },
                React.createElement('p', { className: 'text-[9px] text-amber-400 font-bold leading-relaxed' }, `⚠️ ${getPartyStateMessage(state)}`)
            ),
            isLinkedState(state) && onOpenClientProfile && linkedPartyClient && React.createElement('div', { className: 'flex items-center justify-between' },
                React.createElement('p', { className: 'text-[9px] text-slate-500' }, '🔗 مربوط بموكل من النظام — بيانات الطرف ده بتتقرا من ملف الموكل'),
                React.createElement('button', {
                    type: 'button',
                    onClick: () => onOpenClientProfile(linkedPartyClient),
                    className: 'text-[9px] font-black text-premium-gold shrink-0',
                    'data-testid': `edit-standalone-session-open-client-profile-${party.id}`,
                }, '✏️ عدّل من ملف الموكل')
            ),
            // 🆕 زرار فك الربط — كان مفقود بالكامل قبل كده، وده أصل الـ
            // dead-end. متاح لأي طرف عنده client_id (حي أو orphan) — بيصفّر
            // client_id بس محليًا في الفورم (نفس منطق linkClientToParty في
            // EditCaseModal.tsx وقت اختيار "— بدون ربط —")، فيرجع الطرف
            // بيانات حرة قابلة للتعديل فورًا.
            // ⚡ CHANGED (المرحلة 3): طرف LINKED فعليًا بيفتح تأكيد أول
            // بدل ما ينفذ فورًا؛ طرف ORPHAN_PARTY (مفيش موكل حي يتفك عنه
            // فعليًا) لسه بينفذ على طول.
            canUnlinkParty(state) && !confirmingUnlink && React.createElement('button', {
                type: 'button',
                onClick: () => {
                    if (isLinkedState(state) && linkedPartyClient) { setUnlinkConfirmPartyId(party.id); return; }
                    partyFields.updateParty(party.id, 'client_id', null);
                },
                className: 'text-[10px] font-bold text-rose-400 mt-1',
                'data-testid': `edit-standalone-session-unlink-party-${party.id}`,
            }, '🔓 فك الربط عن هذا الطرف'),
            confirmingUnlink && React.createElement('div', { className: 'bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5 space-y-2', 'data-testid': `edit-standalone-session-unlink-preview-${party.id}` },
                React.createElement('p', { className: 'text-[9px] text-rose-300 font-bold leading-relaxed' },
                    `⚠️ هيتم فك ربط "${party.name || 'هذا الطرف'}" عن الموكل "${linkedPartyClient?.full_name}". بيانات الطرف (الاسم/الرقم القومي/العنوان/التوكيل) هتفضل زي ما هي دلوقتي كنسخة يدوية قابلة للتعديل الحر، ومش هتتحدّث تلقائيًا من ملف الموكل تاني.`
                ),
                React.createElement('div', { className: 'flex gap-2' },
                    React.createElement('button', {
                        type: 'button',
                        onClick: () => { partyFields.updateParty(party.id, 'client_id', null); setUnlinkConfirmPartyId(null); },
                        className: 'flex-1 py-2 rounded-lg bg-rose-500 text-white text-[10px] font-black',
                        'data-testid': `edit-standalone-session-unlink-confirm-${party.id}`,
                    }, 'فك الربط'),
                    React.createElement('button', {
                        type: 'button',
                        onClick: () => setUnlinkConfirmPartyId(null),
                        className: 'flex-1 py-2 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[10px] font-black',
                        'data-testid': `edit-standalone-session-unlink-cancel-${party.id}`,
                    }, 'إلغاء')
                )
            ),
        );
    };

    // ══════════════ حفظ مسودة تلقائي (خطة 1 أغسطس 2026 — آخر فورم) ══════════════
    // نفس منطق EditCaseModal.tsx بالحرف، بمفتاح متضمّن session.id عشان
    // مسودة جلسة متختلطش بمسودة جلسة تانية. EditStandaloneModalForm بيتبني
    // بس بعد ما existingPartyRows اتجابت فعلاً من الأب (EditStandaloneModal
    // فوق)، فالفورم هنا دايمًا بيبدأ ببيانات الجلسة الحقيقية من أول رندر —
    // مفيش داعي لـenabled=false.
    interface EditStandaloneDraftData {
        form: StandaloneEditForm;
        parties: PartyFieldValue[];
        legalTitles: { plaintiff: string; defendant: string };
    }
    const draftData: EditStandaloneDraftData = { form, parties: partyFields.parties, legalTitles: partyFields.legalTitles };
    const draft = useFormDraft<EditStandaloneDraftData>({ key: `edit-standalone-session:${session.id}`, data: draftData });

    useEffect(() => {
        if (!draft.restoredDraft) return;
        setForm(draft.restoredDraft.form);
        partyFields.replaceParties(draft.restoredDraft.parties);
        partyFields.replaceLegalTitles(draft.restoredDraft.legalTitles);
        toast('📝 تم استرجاع بيانات كنت بتكتبها قبل كده');
        draft.dismissRestoredDraft();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [draft.restoredDraft]);

    // تحذير قبل الإغلاق لو فيه بيانات مكتوبة لسه ما اتحفظتش (الـbaseline
    // هنا هو بيانات الجلسة المحمّلة فعليًا، مش فورم فاضي)
    const { guardedClose, confirmModal } = useUnsavedChangesGuard(draftData, { form, parties: partyFields.parties, legalTitles: partyFields.legalTitles }, onClose, draft.clearDraft);

    // ⚡ NEW (مرحلة 6.4): مزامنة الحفظ الفعلي في case_parties — نفس فلسفة
    // syncCaseParties في useCaseActions.ts (مرحلة 5.2) بالحرف، بس بـ
    // session_id بدل case_id. existingIds بتيجي من existingPartyRows اللي
    // اتجابت وقت فتح الفورم (مفيش استعلام جديد وقت الحفظ)، فبتشتغل حتى
    // أوفلاين (window.__dbWrite بيتعامل مع الأوفلاين لوحده لكل نداء). صف
    // موجود في existingIds = UPDATE، صف مش موجود فيها (id مؤقت legacy-*/
    // party-*) = INSERT، صف كان موجود واختفى من الفورم دلوقتي = DELETE.
    // ⚡ CHANGED (خطة توحيد "ربط طرف بموكل موجود" — مرحلة 4، 6 أغسطس
    // 2026): نفس تعديل syncCaseParties في useCaseActions.ts بالحرف —
    // 'conflict' بقت reason مستقلة بتحمل أسماء الأطراف المتعارضة.
    type SyncPartiesResult = { ok: true } | { ok: false; reason: 'validation'; message: string } | { ok: false; reason: 'write' } | { ok: false; reason: 'conflict'; conflictNames: string[] };
    const syncSessionParties = async (targetSessionId: string): Promise<SyncPartiesResult> => {
        const parties = partyFields.parties;
        // 🆕 (خطة "المسمى القانوني" — مرحلة 3): نفس منطق useCaseActions.ts/
        // NewStandaloneSessionModal.tsx — خط دفاع تاني لقاعدة 6.
        const serverCheck = validateParties(parties, {
            plaintiff: partyFields.legalTitles.plaintiff || '',
            defendant: partyFields.legalTitles.defendant || '',
        });
        if (!serverCheck.valid) {
            return { ok: false, reason: 'validation', message: serverCheck.message || '⚠️ بيانات أطراف الدعوى غير مكتملة أو غير صحيحة' };
        }
        const existingIds = existingPartyRows.map((r) => r.id);
        const currentIds = new Set(parties.map((p) => p.id));
        let allOk = true;
        const conflictNames: string[] = [];
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
                ? await window.__dbWrite({ type: 'UPDATE', table: 'case_parties', data: rowData, id: p.id, knownUpdatedAt: p.updated_at || null })
                : await window.__dbWrite({ type: 'INSERT', table: 'case_parties', data: rowData });
            if (result.conflict) {
                conflictNames.push(p.name?.trim() || `طرف رقم ${i + 1}`);
                allOk = false;
            } else if (result.error) {
                allOk = false;
            }
        }
        if (allOk) return { ok: true };
        if (conflictNames.length > 0) return { ok: false, reason: 'conflict', conflictNames };
        return { ok: false, reason: 'write' };
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
        // ⚡ CHANGED (خطة تفكيك legacy columns — Phase F.2، 6 أغسطس 2026):
        // primaryPlaintiff/primaryDefendant كانوا بيتحسبوا هنا عشان يتبعتوا
        // كنسخة احتياطية على الأعمدة القديمة (تحت + في مزامنة السلاسل) —
        // اتشالت الكتابتين الاتنين. partyFields.legalTitles لسه لازمة
        // كمدخل فاليديشن بس في syncSessionParties تحت.
        const { error, offline, queued, conflict } = await window.__dbWrite({
            type: 'UPDATE', table: 'case_sessions', id: session.id,
            data: {
                court: form.court || null,
                title: form.title || null,
                case_number: fullCaseNumber || null,
                case_type: finalCaseType || null,
                circuit_number: form.circuit_number || null,
                session_date: form.session_date,
                session_time: form.session_time || null,
                next_action: form.next_action || null,
            },
            knownUpdatedAt: session.updated_at || null,
        });
        // 🔒 FIX (تقرير الموثوقية — القسم 12، Concurrent Editing): توست بدل السكوت التام.
        if (conflict) { setSaving(false); toast('⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true); return; }
        // ⚠️ `error` هنا بيبقى null في حالة النجاح أونلاين *وكمان* في حالة
        // التقييد الناجح في طابور الأوفلاين (offline && queued) — __dbWrite
        // بيرجّع error حقيقي بس لو فشل الاتصال أونلاين، أو لو فشل الحفظ محليًا
        // في IndexedDB نفسها وقت الأوفلاين. يعني الفحص ده وحده كافي للحالتين.
        if (error) {
            setSaving(false);
            showErrorToast('session_save', error, 'تعذّر حفظ الجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'حفظ الجلسة');
            return;
        }
        // 🆕 (خطة حفظ المسودات — 1 أغسطس 2026): نفس قرار NewStandaloneSessionModal.tsx
        // — بيانات الجلسة اتحفظت فعليًا في الداتابيز (أو اتقيّدت في طابور
        // الأوفلاين بأمان لو النت مقطوع) بحلول هنا (مش مجرد الضغط على "حفظ")،
        // فالمسودة بتتمسح دلوقتي بالظبط في الحالتين.
        draft.clearDraft();
        // 🔒 FIX (تناسق "هوية" السلسلة — 5 أغسطس 2026): لو الجلسة دي عضو في
        // سلسلة session_group_id، نفس حقول "هوية القضية" (محكمة/عنوان/رقم
        // قضية/نوع/دائرة/بيانات المدعي والمدعى عليه) اللي اتصححت هنا لازم
        // تتزامن مع باقي جلسات السلسلة التاريخية — عمدًا من غير
        // session_date/session_time/next_action (دول خاصين بكل جلسة على
        // حدة). syncSessionIdentityToGroupSiblings بترجع {siblingCount:0}
        // لو مفيش session_group_id أصلاً (صفر تغيير سلوك للجلسة العادية).
        const identitySyncResult = await syncSessionIdentityToGroupSiblings(db, session, {
            court: form.court || null,
            title: form.title || null,
            case_number: fullCaseNumber || null,
            case_type: finalCaseType || null,
            circuit_number: form.circuit_number || null,
            // ⚡ CHANGED (Phase F.2، 6 أغسطس 2026): كانت هنا مزامنة نفس
            // الأعمدة القديمة (plaintiff/defendant/...) لكل جلسات السلسلة
            // التاريخية — اتشالت (نفس تعديل نداء __dbWrite فوق بالحرف).
            // أطراف كل جلسة في السلسلة بقت مستقلة في case_parties الخاصة
            // بيها، مش محتاجة "هوية" مشتركة للأطراف عبر السلسلة أصلًا.
        });
        // ⚡ NEW (مرحلة 6.4): مزامنة أطراف الدعوى الفعلية في case_parties —
        // بعد نجاح تحديث بيانات الجلسة نفسها، بالـ session_id الحقيقي
        // مباشرة (مفيش داعي لسنتينل، الجلسة أصلاً موجودة قبل التعديل).
        const partiesResult = await syncSessionParties(session.id);
        setSaving(false);
        if (!identitySyncResult.ok) {
            toast('⚠️ تم تعديل الجلسة، لكن حصل خطأ في مزامنة بيانات بعض جلسات السلسلة التاريخية — راجعها يدويًا', true);
        }
        if (!partiesResult.ok) {
            // 🔒 نفس مبدأ 4.3/5.2: توست واحد بس، برسالة الفاليديشن المحددة
            // لو ده السبب، رسالة تعارض تسمي الأطراف بالظبط (مرحلة 4)، أو
            // رسالة عامة لو فشل الكتابة — من غير ما يمنع نجاح حفظ الجلسة نفسها.
            toast(
                partiesResult.reason === 'validation'
                    ? partiesResult.message
                    : partiesResult.reason === 'conflict'
                    ? `⚠️ تم تعديل الجلسة، لكن الأطراف التالية عدّلها شخص آخر بعد ما فتحت الفورم: ${partiesResult.conflictNames.join('، ')} — راجعها بعد إعادة الفتح`
                    : '⚠️ تم تعديل الجلسة، لكن حصل خطأ في مزامنة بعض أطراف الدعوى — راجعها بعد إعادة الفتح',
                true
            );
        }
        // 🆕 (توحيد الأوفلاين): توست مختلف لو التعديل الأساسي اتقيّد في
        // الطابور بدل ما يوصل السيرفر فورًا — نفس صياغة handleUpdateSession
        // في useCaseSessions.ts.
        toast(offline && queued ? '📥 تعديل الجلسة محفوظ محلياً — سيُزامن عند عودة الإنترنت' : '✅ تم تعديل الجلسة');
        onSaved();
        onClose();
    };

    const modalTree = createPortal(
        React.createElement('div', {
            className: 'fixed inset-0 z-[60] flex items-end justify-center',
            style: { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' },
            onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) guardedClose(); }
        },
            React.createElement('div', {
                className: 'w-full max-w-lg rounded-t-3xl overflow-hidden bg-premium-card border border-white/8',
                style: { maxHeight: '92vh' },
                'data-testid': 'edit-standalone-session-modal'
            },
                React.createElement('div', { className: 'flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5' },
                    React.createElement('div', { className: 'flex items-center gap-2' },
                        React.createElement('span', { className: 'text-xl' }, '✏️'),
                        React.createElement('h2', { className: 'text-sm font-black text-white' }, 'تعديل الجلسة المستقلة')
                    ),
                    React.createElement('button', { onClick: guardedClose, className: 'w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-slate-400', 'data-testid': 'edit-standalone-session-close' }, React.createElement(I.X))
                ),
                React.createElement('div', {
                    className: 'overflow-y-auto px-5 py-4 space-y-3',
                    style: { maxHeight: 'calc(92vh - 130px)' }
                },
                    React.createElement(Inp, { label: 'المحكمة', value: form.court, onChange: set('court'), placeholder: 'مثال: محكمة جنوب القاهرة' }),
                    React.createElement(Inp, { label: 'موضوع الجلسة / عنوان', required: true, value: form.title, onChange: set('title'), placeholder: 'مثال: قضية إيجار', 'data-testid': 'edit-standalone-session-title' }),
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
                            React.createElement('input', { type: 'date', value: form.session_date, onChange: set('session_date'), className: inputCls, style: inputStyle, 'data-testid': 'edit-standalone-session-date' })
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
                        onOpenClientProfile && linkedClient && React.createElement('button', {
                            type: 'button', onClick: () => onOpenClientProfile(linkedClient),
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
                    React.createElement(PartyFieldsGroup, { controller: partyFields, testIdPrefix: 'edit-standalone-session', renderPartyReadOnly, renderPartyExtra, getPartyState: (party: PartyFieldValue) => getPartyState(party, domainContext) }),
                    React.createElement('div', { className: 'border-t border-white/5 my-1' }),
                    React.createElement(Inp, { label: 'الإجراء القادم', value: form.next_action, onChange: set('next_action'), placeholder: 'مثال: تقديم مذكرة دفاع' }),
                    React.createElement('div', { className: 'h-4' })
                ),
                React.createElement('div', { className: 'px-5 py-4 border-t border-white/5 flex gap-3' },
                    React.createElement('button', { onClick: guardedClose, className: 'flex-1 py-3 rounded-2xl text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 transition-all', 'data-testid': 'edit-standalone-session-cancel' }, 'إلغاء'),
                    React.createElement('button', {
                        onClick: handleSave, disabled: saving || !form.session_date,
                        className: 'flex-grow-[2] py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-40',
                        style: { background: saving ? '#888' : 'linear-gradient(135deg,#d4af37,#f0c040)' },
                        'data-testid': 'edit-standalone-session-save'
                    }, saving ? '⏳ جاري الحفظ...' : '✅ حفظ التعديلات')
                )
            )
        ),
        document.body
    );

    return React.createElement(React.Fragment, null, modalTree, confirmModal);
}

interface StandaloneSessionDetailModalProps {
    session: SessionWithLegacyFields;
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
    // ⚡ REMOVED (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، المرحلة 6 — 9
    // أغسطس 2026): onOpenCreateClientForSessionParty وopenNewClientModal
    // كانوا هنا خدمة لـ LinkSessionModal (اتشال Phase 2) وزرار "➕ إنشاء
    // موكل جديد" جوه EditStandaloneModalForm (اتشال Phase 3) — الاتنين
    // بقوا بلا مستهلك حقيقي من وقتها. اتشالت السلسلة كلها من DashboardTab.tsx
    // وSessionsCalendar.tsx كمان.
}

function StandaloneSessionDetailModal({ session: partialSession, db, onClose, onDone, onNotify, onClientAdded, clients = [], onOpenClientProfile }: StandaloneSessionDetailModalProps) {
    const [showUpdate, setShowUpdate] = useState(false);
    const [showEdit, setShowEdit] = useState(false);
    const [showConfirmDelete, setShowConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    // ⚡ NEW (نقل زرار فك الربط من EditStandaloneModal لجنب سطر "👤 الموكل"
    // هنا مباشرة).
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
    const [fullSession, setFullSession] = useState<SessionWithLegacyFields>(partialSession);
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

    // ⚡ NEW (طلب "عرض تعدد الأطراف في مودال عرض الجلسة المستقلة" — 3
    // أغسطس 2026): نفس استعلام EditStandaloneModal بالحرف (case_parties
    // بـ session_id) — بس هنا للعرض القرائي فقط. جلسة قديمة/بلا صفوف
    // ترجع array فاضية، وبنعمل fallback لعمودي plaintiff/defendant
    // القدامى تحت زي ما كان يحصل بالظبط قبل التعديل ده.
    // ⚡ CHANGED (خطة توحيد قفل الطرف — المرحلة 3، سد فجوة 5.4، 6 أغسطس
    // 2026): client_id بقى جزء من الـselect — قبل كده الاستعلام كان
    // بيجيب side/name/capacity بس، فمكانش فيه بيانات كفاية لحساب حالة
    // الطرف (getPartyState) وعرض شارة في العرض القرائي هنا. مفيش تغيير
    // في شكل fallback الأعمدة القديمة تحت — عمود جديد بس بيتضاف كخيار.
    const [sessionParties, setSessionParties] = useState<{ side: PartySide; name: string; capacity: string; client_id: string | null }[]>([]);
    useEffect(() => {
        let cancelled = false;
        db.from('case_parties').select('side,name,capacity,client_id').eq('session_id', partialSession.id).order('sort_order', { ascending: true })
            .then(({ data, error }) => {
                if (cancelled) return;
                setSessionParties(error ? [] : ((data as unknown as { side: PartySide; name: string; capacity: string; client_id: string | null }[]) || []));
            });
        return () => { cancelled = true; };
    }, [partialSession.id, db]);

    // 🆕 (خطة تسلسل الجلسة المستقلة، 3 أغسطس 2026): كل الجلسات اللي شاركت
    // نفس session_group_id — يعني نتجت كلها عن نفس الجلسة المستقلة
    // الأصلية عبر ضغطات "⚡ تحديث الجلسة" المتتالية. لو fullSession
    // مالهاش session_group_id (لسه ما "اتحدّثت" ولا مرة، أو جلسة قديمة
    // قبل الفيكس ده)، القائمة تفضل فاضية والسكشن مش بيظهر خالص.
    const [chainSessions, setChainSessions] = useState<CaseSessionRow[]>([]);
    useEffect(() => {
        let cancelled = false;
        const groupId = fullSession.session_group_id;
        if (!groupId) { setChainSessions([]); return; }
        db.from('case_sessions').select('*').eq('session_group_id', groupId).order('session_date', { ascending: true })
            .then(({ data, error }) => {
                if (cancelled) return;
                setChainSessions(error ? [] : ((data as CaseSessionRow[]) || []));
            });
        return () => { cancelled = true; };
    }, [fullSession.session_group_id, db]);

    const session = fullSession;
    // ⚡ REMOVED (خطة إلغاء ربط/إنشاء موكل من الجلسة المستقلة، Phase 2 — 9
    // أغسطس 2026): hasCase كان بيتحكم بس في ظهور زرار "🔗 ربط" (اتشال
    // بالكامل). لو احتجناه تاني مستقبلاً لغرض تاني، يترجع بسهولة.
    const hasClient = !!session.client_id;
    // ⚡ FIX (8 أغسطس 2026 — نفس باگ "الموكل محذوف" غلط اللي اتصلح في
    // CasesTab.tsx/CaseDetailView.tsx): كان بيعتمد على session.client_id
    // القديم بس. لو الجلسة اترّبط طرفها الأساسي بموكل عبر case_parties
    // (sessionParties فوق، محمّلة أصلاً لعرض تعدد الأطراف) بعد ما
    // session.client_id فضل من غير مزامنة، كان بيظهر "محذوف" غلط مع إن
    // الموكل حي ومربوط فعلاً. primaryPartyClientId بياخد أول طرف عنده
    // client_id من sessionParties كـ fallback لو العمود القديم فاضي/غلط.
    // ⚠️ لازم نجرّب نتيجة كل id على حدة (مش || على الـids الخام) — لو
    // session.client_id نفسه موجود بس غلط/قديم (مش null، بس مش بيتلاقى
    // في clients)، الـ|| كان هيوقف عنده وميوصلش لـprimaryPartyClientId
    // الصحيح خالص.
    const primaryPartyClientId = sessionParties.find((p) => p.client_id)?.client_id || null;
    const linkedClient = [session.client_id, primaryPartyClientId]
        .filter((id): id is string => !!id)
        .map((id) => clients.find((c) => c.id === id))
        .find((c): c is ClientRow => !!c) || null;
    const effectiveClientId = linkedClient?.id || session.client_id || primaryPartyClientId || null;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 7 — fallback الموكل
    // المحذوف): hasClient=true (effectiveClientId موجود) لكن linkedClient
    // طلع null — يعني الموكل ده اتحذف (soft-deleted) بعد ما الجلسة
    // اتربطت بيه، مش إن الجلسة مش مربوطة بحد أصلاً.
    // ⚡ CHANGED (خطة توحيد قفل الطرف، المرحلة 2): isOrphanedLink() الموحّدة
    // بدل الشرط اليدوي — نفس النتيجة بالظبط (hasClient && !linkedClient).
    const isOrphaned = isOrphanedLink(effectiveClientId, linkedClient);

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

    // ⚡ NEW: لو فيه صفوف case_parties لهذه الجلسة بنستخدمها، وإلا
    // fallback لعمودي plaintiff/defendant المفردين (جلسة قديمة). الاسم
    // المعروض = اسم أول طرف مسمّى + "وآخرين" لو الجهة فيها أكتر من شخص،
    // والصفة بتتاخد من حقل capacity المسجل فعليًا لأول شخص — مش كلمة
    // "موكل"/"خصم" ثابتة زي ما كان قبل كده.
    const plaintiffPersons: PartyPersonLike[] = (() => {
        const rows = sessionParties.filter((p) => p.side === 'plaintiff' && p.name?.trim());
        if (rows.length > 0) return rows;
        return session.plaintiff ? [{ name: session.plaintiff, capacity: session.plaintiff_role || '' }] : [];
    })();
    const defendantPersons: PartyPersonLike[] = (() => {
        const rows = sessionParties.filter((p) => p.side === 'defendant' && p.name?.trim());
        if (rows.length > 0) return rows;
        return session.defendant ? [{ name: session.defendant, capacity: session.defendant_role || '' }] : [];
    })();
    const plaintiffSummary = summarizePartySide(plaintiffPersons);
    const defendantSummary = summarizePartySide(defendantPersons);
    const partyLine = (s: ReturnType<typeof summarizePartySide>) =>
        s ? (s.othersCount > 0 ? `${s.primaryName} وآخرين` : s.primaryName) : null;
    // ⚡ NEW (خطة توحيد قفل الطرف — المرحلة 3، سد فجوة 5.4، 6 أغسطس 2026):
    // شارة نصية صغيرة (إيموجي) بتتلحق باسم أول شخص مسمّى في الجهة، لو
    // بيانات case_parties.client_id متاحة له (بعد إضافتها للاستعلام
    // فوق). صفوف الـfallback القديمة (plaintiff/defendant المفردين،
    // جلسة قبل تعدد الأطراف) client_id مالهاش قيمة أصلًا فبترجع '' —
    // نفس شكل العرض القديم بالظبط بلا أي تغيير. الصفوف هنا كلها للعرض
    // القرائي فقط (rows أدناه بتاخد value: string|null بسيط، مش JSX)،
    // فالشارة نص مضغوط جنب الاسم بدل pill ملوّن كامل زي كارت الفورم.
    const sessionDomainContext: PartyDomainContext = { primaryClientId: session.client_id || null, clients };
    const partyStateBadgeSuffix = (persons: PartyPersonLike[]): string => {
        const first = persons[0] as (PartyPersonLike & { client_id?: string | null }) | undefined;
        if (!first?.client_id) return '';
        const badge = getPartyStateBadge(getPartyState({ client_id: first.client_id }, sessionDomainContext));
        return badge ? ` ${badge.emoji}` : '';
    };

    const rows: { label: string; value: string | null; key?: string }[] = [
        { label: '📅 التاريخ', value: session.session_date || null },
        { label: '🕐 التوقيت', value: session.session_time || null },
        { label: '🏛 المحكمة', value: session.court || null },
        { label: '📋 رقم القضية', value: session.case_number || null },
        { label: '📂 نوع القضية', value: session.case_type || null },
        { label: '⚖️ الدائرة', value: session.circuit_number || null },
        { label: '👤 الطرف الأول', value: partyLine(plaintiffSummary) ? partyLine(plaintiffSummary) + partyStateBadgeSuffix(plaintiffPersons) : null, key: 'primaryParty' },
        { label: '🏷 صفة الطرف الأول', value: plaintiffSummary?.primaryCapacity || null },
        { label: '👤 الطرف الثاني', value: partyLine(defendantSummary) ? partyLine(defendantSummary) + partyStateBadgeSuffix(defendantPersons) : null },
        { label: '🏷 صفة الطرف الثاني', value: defendantSummary?.primaryCapacity || null },
        { label: '⚡ الإجراء القادم', value: session.next_action || null },
        { label: '📝 ما تم', value: session.result || null },
    ].filter((r) => r.value);

    // 🆕 (توحيد الأوفلاين لشاشة الجلسة المستقلة — 5 أغسطس 2026): __dbWrite
    // بدل db.from(...).delete() المباشر — لو النت مقطوع، الحذف بيتقيّد في
    // طابور الأوفلاين (window.__dbWrite) بدل ما يفشل بتوست خطأ عادي، ويتزامن
    // فعليًا لما النت يرجع. مفيش داعي لسنتينل `_offlineSessionCaseId` هنا
    // (زي useCaseSessions.ts) لأن دي أصلاً جلسة *مستقلة* — case_id بتاعها
    // null دايمًا، فمفيش next_hearing لقضية نعيد حسابه بعد المزامنة.
    const handleDelete = async () => {
        setDeleting(true);
        try {
            const { error, offline, queued } = await window.__dbWrite({ type: 'DELETE', table: 'case_sessions', id: session.id });
            if (error) {
                showErrorToast('session_delete', error, 'تعذّر حذف الجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'حذف الجلسة');
                return;
            }
            toast(offline && queued ? '📥 حذف الجلسة محفوظ محلياً — سيُزامن عند عودة الإنترنت' : '✅ تم حذف الجلسة');
            onDone();
            onClose();
        } catch { toast('❌ خطأ غير متوقع', true); }
        finally { setDeleting(false); setShowConfirmDelete(false); }
    };

    // ⚡ NEW: نفس منطق handleUnlink اللي كان جوه EditStandaloneModal بالظبط،
    // بس هنا بيحدّث fullSession محليًا كمان عشان زرار الربط/فك الربط يتحدّث
    // فورًا من غير ما يقفل الشاشة (بعكس الحذف).
    // 🆕 (توحيد الأوفلاين — 5 أغسطس 2026): __dbWrite بدل safeUpdate — بيحافظ
    // على نفس فحص التعارض (knownUpdatedAt) أونلاين، وبيقيّد في طابور
    // الأوفلاين لو النت مقطوع بدل الفشل المباشر.
    // 🔒 FIX (توحيد فك ربط الطرف الأساسي — 8 أغسطس 2026): قبل كده الدالة
    // دي كانت بتصفّر case_sessions.client_id بس، من غير ما تلمس صف
    // case_parties المطابق للطرف الأساسي — فيسيبه شايل client_id قديم،
    // ولما الفورم يتفتح تاني getPartyState يصنّفه "طرف ثانوي مربوط" بدل
    // حر (رغم إن التوست بيقول "بقت قابلة للتعديل"). دلوقتي بنجيب صفوف
    // case_parties بتاعة الجلسة أول (fetchSessionClientParties — نفس
    // الدالة المستخدمة في مكان تاني، مفيش استعلام جديد)، ولو لقينا الطرف
    // اللي client_id بتاعه بيطابق session.client_id، بنستخدم
    // unlinkClientFromSessionParty (بتصفّر الجدولين مع بعض بفحص تعارض
    // منفصل لكل واحد). لو مفيش أي صف case_parties أصلًا (جلسة قديمة قبل
    // نظام تعدد الأطراف)، بنرجع بالظبط لنفس السلوك القديم (تحديث
    // case_sessions بس) — صفر تغيير سلوك لهذه الحالة.
    const handleUnlinkClient = async () => {
        setUnlinkingClient(true);
        const sessionParties = await fetchSessionClientParties(db, session.id);
        const matchedParty = session.client_id
            ? sessionParties.find((p) => p.client_id === session.client_id)
            : undefined;

        if (matchedParty) {
            const result = await unlinkClientFromSessionParty(
                matchedParty.id, true, session.id,
                matchedParty.updated_at ?? null, session.updated_at || null,
            );
            setUnlinkingClient(false);
            if (result.conflict) {
                toast(result.conflictScope === 'session'
                    ? '⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة'
                    : '⚠️ بيانات هذا الطرف عدّلها شخص آخر بعد ما فتحت الجلسة — أعد المحاولة', true);
                return;
            }
            if (!result.ok) {
                showErrorToast('session_unlink', new Error('unlink session primary party failed'), 'تعذّر فك ربط الجلسة عن الموكل. حاول مرة أخرى.', 'فك ربط الجلسة');
                return;
            }
            toast('✅ تم فك الربط — بيانات الموكل في الجلسة بقت قابلة للتعديل الحر');
            setFullSession((prev) => ({ ...prev, client_id: null }));
            setShowUnlinkConfirm(false);
            onDone();
            return;
        }

        // فولباك: مفيش صف case_parties مطابق (جلسة قديمة قبل مرحلة تعدد
        // الأطراف) — نفس الكتابة المباشرة القديمة بالظبط.
        const { error, offline, queued, conflict } = await window.__dbWrite({
            type: 'UPDATE', table: 'case_sessions', id: session.id,
            data: { client_id: null },
            knownUpdatedAt: session.updated_at || null,
        });
        setUnlinkingClient(false);
        if (conflict) { toast('⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true); return; }
        if (error) {
            showErrorToast('session_unlink', error, 'تعذّر فك ربط الجلسة عن الموكل. حاول مرة أخرى.', 'فك ربط الجلسة');
            return;
        }
        toast(offline && queued
            ? '📥 فك الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت'
            : '✅ تم فك الربط — بيانات الموكل في الجلسة بقت قابلة للتعديل الحر');
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
            className: 'w-full max-w-lg rounded-t-3xl overflow-hidden bg-premium-card border border-white/8',
            style: { maxHeight: '90vh' },
            'data-testid': 'standalone-session-detail-modal'
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
                    className: 'w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-slate-400 hover:bg-white/10',
                    'data-testid': 'standalone-session-detail-header-close'
                }, React.createElement(I.X))
            ),

            // ── تفاصيل ──
            React.createElement('div', {
                className: 'overflow-y-auto px-5 py-4 space-y-2',
                style: { maxHeight: 'calc(90vh - 160px)' }
            },
                ...rows.map(({ label, value, key }) => {
                    // ⚡ سطر "👤 الموكل" بس — لو الجلسة مربوطة بموكل حي
                    // (hasClient)، بيظهر تحته زرار "🔓 فك الربط".
                    if (key === 'primaryParty' && hasClient) {
                        return React.createElement('div', {
                            key: label,
                            className: 'py-2 border-b border-white/5'
                        },
                            React.createElement('div', { className: 'flex items-start justify-between gap-3' },
                                React.createElement('span', { className: 'text-[10px] font-bold text-slate-500 shrink-0' }, label),
                                ' ',
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
                                            className: 'flex-1 bg-rose-500 text-white rounded-lg py-1.5 text-[10px] font-black disabled:opacity-60',
                                            'data-testid': 'standalone-session-unlink-confirm'
                                        }, unlinkingClient ? '⏳ جارٍ فك الربط...' : 'نعم، افصل الربط'),
                                        React.createElement('button', {
                                            disabled: unlinkingClient,
                                            onClick: () => setShowUnlinkConfirm(false),
                                            className: 'flex-1 bg-white/5 border border-white/10 text-slate-300 rounded-lg py-1.5 text-[10px] font-black disabled:opacity-60',
                                            'data-testid': 'standalone-session-unlink-cancel'
                                        }, 'إلغاء')
                                    )
                                  )
                                : React.createElement('div', { className: 'flex justify-end mt-1' },
                                    React.createElement('button', {
                                        onClick: () => setShowUnlinkConfirm(true),
                                        className: 'text-[9px] font-black text-rose-400',
                                        'data-testid': 'standalone-session-unlink-trigger'
                                    }, '🔓 فك الربط')
                                  )
                        );
                    }
                    return React.createElement('div', {
                        key: label,
                        className: 'flex items-start justify-between gap-3 py-2 border-b border-white/5'
                    },
                        React.createElement('span', { className: 'text-[10px] font-bold text-slate-500 shrink-0' }, label),
                        ' ',
                        React.createElement('span', { className: 'text-[11px] font-semibold text-white text-left' }, value)
                    );
                }),

                // ── 🕓 سجل هذه الجلسة (خطة تسلسل الجلسة المستقلة، 3 أغسطس 2026) ──
                // بيظهر بس لو فيه أكتر من جلسة واحدة في نفس السلسلة (مفيش
                // فايدة تعرض سجل من عنصر واحد). قرائي بالكامل — قصده يورّي
                // "الجلسات القديمة لسه موجودة" مش تعديلها من هنا.
                chainSessions.length > 1 && React.createElement('div', {
                    className: 'pt-3 mt-1',
                    'data-testid': 'standalone-session-chain-history'
                },
                    React.createElement('h4', { className: 'text-[10px] font-black text-slate-400 mb-2' }, '🕓 سجل هذه الجلسة'),
                    ...chainSessions.map((s) => {
                        const isCurrent = s.id === session.id;
                        return React.createElement('div', {
                            key: s.id,
                            className: `py-1.5 border-b border-white/5 ${isCurrent ? '' : 'opacity-70'}`
                        },
                            React.createElement('div', { className: 'flex items-center justify-between gap-3' },
                                React.createElement('span', { className: 'text-[10px] font-bold text-slate-300' },
                                    `📅 ${s.session_date || '—'}${isCurrent ? ' (الحالية)' : ''}`
                                )
                            ),
                            s.result && React.createElement('p', { className: 'text-[10px] text-slate-500 mt-0.5' }, `📝 ${s.result}`)
                        );
                    })
                )
            ),

            // ── Footer ──
            React.createElement('div', { className: 'px-5 pb-5 pt-3 border-t border-white/5 space-y-2' },
                // زر تحديث الجلسة — كبير ذهبي
                React.createElement('button', {
                    onClick: () => setShowUpdate(true),
                    disabled: loadingFull,
                    className: 'w-full py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-50',
                    style: { background: 'linear-gradient(135deg,#d4af37,#f0c040)' },
                    'data-testid': 'standalone-session-update-trigger'
                }, loadingFull ? '⏳ جاري تحميل بيانات الجلسة...' : '⚡ تحديث الجلسة'),

                // صف الأزرار الصغيرة
                React.createElement('div', { className: 'flex gap-2' },
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 transition-all',
                        'data-testid': 'standalone-session-footer-close'
                    }, 'إغلاق'),
                    React.createElement('button', {
                        onClick: () => setShowEdit(true),
                        disabled: loadingFull,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-300 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-50',
                        'data-testid': 'standalone-session-edit-trigger'
                    }, '✏️ تعديل'),
                    React.createElement('button', {
                        onClick: () => setShowConfirmDelete(true),
                        disabled: deleting,
                        className: 'flex-1 py-2.5 rounded-2xl text-xs font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 transition-all disabled:opacity-40',
                        'data-testid': 'standalone-session-delete-trigger'
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
            onCancel: () => setShowConfirmDelete(false),
            inputTestId: 'standalone-session-delete-input',
            confirmTestId: 'standalone-session-delete-confirm',
            cancelTestId: 'standalone-session-delete-cancel',
        }), document.body),
        showEdit && React.createElement(EditStandaloneModal, {
            session, db,
            onClose: () => setShowEdit(false),
            onSaved: () => { onDone(); onClose(); },
            linkedClient,
            clients,
            onOpenClientProfile: onOpenClientProfile ? (c: ClientRow) => { setShowEdit(false); onOpenClientProfile(c); } : undefined,
        }),
        showUpdate && React.createElement(SessionUpdateModal, {
            session, caseData, db,
            onClose: () => setShowUpdate(false),
            onDone: () => { onDone(); onClose(); },
            onNotify,
            linkedClient,
        })
    );
}

export default StandaloneSessionDetailModal;
