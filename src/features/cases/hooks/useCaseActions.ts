import { toast } from '../../../shared/lib/notifications';
import { escapeTelegramHtml } from '../../../shared/lib/sanitize';
import { logActivity } from '../../../shared/lib/dataAccess';
import { checkCaseNumberDuplicate } from '../../../shared/lib/caseValidation';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { db } from '../../../supabaseClient';
import { withFkOfflineSentinel } from '../../calendar/hooks/caseSessionLinkingShared';
import type { Dispatch, SetStateAction } from 'react';
import type { ClientRow, ProfileRow } from '../../../types';
import type { NavigationState } from '../../../useNavigation';
import type { MappedCase } from '../../../hooks/useAppData';
import type { PartyFieldValue } from '../../../shared/parties/partyTypes';
import { validateParties } from '../../../shared/lib/casePartiesValidation';

// شكل البيانات اللي بتوصل فعليًا من NewCaseModal/EditCaseModal لـ onSave —
// اتحقق من كل استخدام حقيقي في handleSaveCase/handleUpdateCase تحت، وبيغطي
// اتحاد الحقول اللي بيبعتها الفورمين (كل الحقول optional غير title، لأن
// EditCaseModal مثلاً مابيبعتش client_id خالص، وكل حقل تاني ممكن يوصل
// فاضي حسب حالة الفورم وقت الإرسال).
export interface CaseFormSubmitData {
    title: string;
    number?: string;
    caseNum?: string;
    caseYear?: string;
    court?: string;
    type?: string;
    status?: string;
    client_id?: string;
    plaintiff?: string;
    plaintiff_role?: string;
    defendant?: string;
    defendant_role?: string;
    court_level?: string;
    circuit_number?: string;
    date?: string;
    session_time?: string;
    court_floor?: string;
    court_hall?: string;
    session_hall?: string;
    secretary_hall?: string;
    secretary_name?: string;
    secretary_mobile?: string;
    plaintiff_national_id?: string;
    plaintiff_power_of_attorney?: string;
    defendant_national_id?: string;
    // ⚡ NEW (21 يوليو 2026): عنوان الموكل — راجع NewCaseModal/EditCaseModal.
    plaintiff_address?: string;
    // 🆕 (خطة "المسمى القانوني" — مرحلة 3، 23 يوليو 2026): المسمى الجامع
    // لكل جهة (usePartyFields().legalTitles) — بيوصل فاضي ('') من الفورم
    // لو الجهة فيها شخص واحد بس (نفس افتراضي validateParties).
    plaintiff_legal_title?: string;
    defendant_legal_title?: string;
    // ⚡ NEW (مرحلة 4.2 — خطة تعدد الأطراف، 22 يوليو 2026): array أطراف
    // الدعوى الكامل (usePartyFields().parties) — لو موجودة، handleSaveCase
    // بيكتب صف في case_parties لكل طرف (بالإضافة لمزامنة الأعمدة القديمة
    // فوق من "الطرف الأساسي" في كل جهة، اللي بتحصل زي ما هي بالظبط).
    // اختيارية عشان أي كود قديم/تستات بتبعت الشكل القديم من غيرها تفضل شغالة.
    parties?: PartyFieldValue[];
    // ⚡ NEW (مرحلة 5.2 — خطة تعدد الأطراف، 22 يوليو 2026): بس من
    // EditCaseModal — أرقام (ids) صفوف case_parties الحقيقية اللي كانت
    // موجودة فعلاً وقت فتح الفورم (existingPartyRows وقت الـ mount، شوف
    // مرحلة 5.1). handleUpdateCase بيستخدمها عشان يفرّق تعديل (id موجود
    // في القايمة دي) عن إضافة جديدة (id مؤقت `legacy-*`/`party-*` مش
    // موجود فيها)، وكمان عشان يحدد أي صف قديم اتشال من الفورم فيحذفه.
    // مفيش داعي نستعلم تاني من الداتابيز وقت الحفظ — النسخة اللي أُخذت
    // وقت الفتح كافية للمقارنة وبتشتغل حتى أوفلاين.
    existingPartyIds?: string[];
}

// شكل بيانات مودال تأكيد الحذف/الأرشفة (زي ما بيتبنى في handleDeleteCase تحت)
// مُصدَّرة عشان App.tsx يقدر يحدد نوع state الـ deleteConfirm بيها بدل any.
export interface DeleteConfirmState {
    type: string;
    id: string;
    name: string;
    itemType: string;
    title: string;
    // mode/onConfirm: تفضل شغالة لأي استخدام قديم بيثبّت وضع واحد (زي الموكلين حاليًا).
    // لما mode متبعتش، المودال بيعرض شاشة اختيار (أرشفة/حذف نهائي) وينده
    // onConfirmArchive أو onConfirmDelete حسب اختيار المستخدم (شوف handleDeleteCase تحت).
    mode?: 'archive' | 'delete';
    onConfirm?: () => void | Promise<void>;
    onConfirmArchive?: () => void | Promise<void>;
    onConfirmDelete?: () => void | Promise<void>;
    // نقاط تحذير مخصصة لحالة الحذف النهائي (شوف نفس الحقل فى DeleteConfirmModalProps) —
    // بتوضح للمستخدم بالظبط إيه اللي هيتحذف فعليًا وإيه اللي هيفضل موجود بربط مصفّر.
    deleteConsequences?: string[];
}

export function useCaseActions(params: {
    sendTelegram: (text: string) => void | Promise<void>;
    fetchCases: (page?: number, filter?: string) => void | Promise<void>;
    cases: MappedCase[];
    lawyers: ProfileRow[];
    clients: ClientRow[];
    selectedCase: MappedCase | null;
    setCases: Dispatch<SetStateAction<MappedCase[]>>;
    setLawyers: Dispatch<SetStateAction<ProfileRow[]>>;
    setClients: Dispatch<SetStateAction<ClientRow[]>>;
    setProfile: Dispatch<SetStateAction<ProfileRow | null>>;
    setAuthUser: (user: { id: string; email?: string | null } | null) => void;
    setSelectedCase: Dispatch<SetStateAction<MappedCase | null>>;
    setDeleteConfirm: (v: DeleteConfirmState | null) => void;
    setSavingCase: Dispatch<SetStateAction<boolean>>;
    // ⚠️ مش Dispatch حقيقي — دي دالة مخصصة في App.tsx بتنادي nav.openModal/
    // closeModal، مش useState setter. اتحقق من الشكل الفعلي في App.tsx
    // (BUILD FIX: كانت متعرّفة غلط كـ Dispatch<SetStateAction<boolean>>
    // وده كسر build حقيقي على Vercel).
    setShowCaseModal: (v: boolean) => void;
    casesFilter: string;
    nav: NavigationState;
    profile?: ProfileRow | null;
}) {
    const {
        sendTelegram, fetchCases, cases, clients, selectedCase,
        setCases, setLawyers, setClients, setProfile, setAuthUser,
        setSelectedCase, setDeleteConfirm, setSavingCase, setShowCaseModal,
        casesFilter, nav, profile,
    } = params;
    const _userName = profile?.full_name || null;

    // ─ تسجيل خروج ─
    const handleLogout = async () => {
        // نسجّل الخروج قبل signOut عشان الـ session لسه شغّالة
        logActivity(db, 'تسجيل خروج', { userName: _userName, entity_type: 'user', details: profile?.email || null });
        await db.auth.signOut();
        setCases([]); setLawyers([]); setClients([]); setProfile(null); setAuthUser(null);
    };

    // ─ حفظ قضية ─
    // شكل form بقى موصوف بـ CaseFormSubmitData (شوف تعريفه فوق) بدل
    // Record<string, any> — بيغطي بالظبط الحقول اللي NewCaseModal بيبعتها،
    // وكل استخدام لعمود DB حقيقي (زي payload تحت) موصول بنوع الجدول الحقيقي
    // من database.types.ts.
    const handleSaveCase = async (form: CaseFormSubmitData) => {
        if (!form.title || !form.title.trim()) {
            toast('❌ حقل "موضوع ومسمى الدعوى" مطلوب', true);
            return;
        }
        setSavingCase(true);
        // 🔒 FIX (تقرير الموثوقية — نتيجة 2، مُصحَّحة): فحص تكرار رقم القيد
        // الرسمي — نفس نمط checkClientDuplicate بالظبط (زرار مقفول قبل
        // الفحص، راجع نتيجة 0)، بيرفض الحفظ لو نفس الرقم مسجل بالفعل لقضية
        // بنفس المحكمة ونفس نوع الدعوى. رقم القيد لوحده مش كفاية — اتباعت
        // court_level/type كمان (راجع caseValidation.ts) عشان رقمين قضية
        // منفصلتين تمامًا يتصادفوا بنفس الرقم في محكمة أو نوع مختلف
        // ميترفضوش بالغلط كتكرار. مفيش فحص لو الرقم فاضي أصلاً
        // (caseValidation.ts بيرجع duplicate:false).
        let caseDup;
        try {
            caseDup = await checkCaseNumberDuplicate(db, form.number, form.court_level, form.type);
        } catch (e) {
            showErrorToast('case_number_duplicate_check', e, 'تعذّر التحقق من رقم القيد. حاول مرة أخرى.', 'إضافة قضية');
            setSavingCase(false);
            return;
        }
        if (caseDup.duplicate) { toast(caseDup.message!, true); setSavingCase(false); return; }
        // 🔒 FIX (تتبع زر "إضافة قضية" — 18 يوليو 2026): معرّف مؤقت client-side
        // فريد لكل عملية إضافة قضية أوفلاين. بيتبعت مع القضية نفسها (وبيتشال
        // قبل أي INSERT حقيقي — شوف stripOfflineSentinels في offlineQueue.ts)،
        // وبيتبعت تاني مع الجلسة الأولى بتاعتها كـ _offlineCaseTempId. وقت
        // المزامنة، الجلسة بتتربط بالـ id الحقيقي للقضية عن طريق مطابقة
        // المعرّف المؤقت ده (مطابقة مضمونة 100%) بدل البحث بالعنوان (اللي كان
        // ممكن يربط غلط لو فيه قضيتين اتضافوا أوفلاين بنفس العنوان بالظبط).
        // العنوان لسه متبعت (fallback) للحالة النادرة اللي القضية بتاعتها
        // اتزامنت في تشغيلة سابقة قبل ما الجلسة توصلها الدور.
        const offlineTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const payload = {
            case_number_official: form.number || null,
            title: form.title,
            court_name: form.court,
            case_type: form.type,
            status: 'نشطة',
            client_id: form.client_id || null,
            plaintiff: form.plaintiff || null,
            plaintiff_role: form.plaintiff_role || null,
            defendant: form.defendant || null,
            defendant_role: form.defendant_role || null,
            court_level: form.court_level || null,
            circuit_number: form.circuit_number || null,
            next_hearing: form.date || null,
            session_hall: form.session_hall || null,
            secretary_hall: form.secretary_hall || null,
            secretary_name: form.secretary_name || null,
            secretary_mobile: form.secretary_mobile || null,
            plaintiff_national_id: form.plaintiff_national_id || null,
            plaintiff_power_of_attorney: form.plaintiff_power_of_attorney || null,
            defendant_national_id: form.defendant_national_id || null,
            plaintiff_address: form.plaintiff_address || null,
            plaintiff_legal_title: form.plaintiff_legal_title || null,
            defendant_legal_title: form.defendant_legal_title || null,
            // 🔒 FIX (تقرير الموثوقية — نتيجة 3، ٦.٢): تحسين احتياطي —
            // التريجر trg_tenant_id_cases (set_tenant_id_from_profile) بيملّ
            // tenant_id تلقائيًا من current_tenant_id() لو الحقل جاي فاضي،
            // وده كافي لأي INSERT جاي من التطبيق (فيه auth.uid() سليم). إضافة
            // القيمة هنا صراحةً مش إصلاح باج — هي طبقة حماية إضافية لو حصل
            // مستقبلًا استدعاء INSERT من سياق مفيهوش auth.uid() سليم.
            tenant_id: profile?.tenant_id || null,
            _offlineTempId: offlineTempId,
        };
        const offlineId = 'offline-' + Date.now();

        // ⚡ NEW (مرحلة 4.2 — خطة تعدد الأطراف): بيكتب صف في case_parties لكل
        // طرف في form.parties، بنداءات __dbWrite منفصلة (قرار قسم 8 — خيار أ:
        // نتنازل عن الذرّية الكاملة مقابل التوافق مع الأوفلاين). لو القضية
        // نفسها لسه في الطابور (offline&&queued)، كل صف طرف بياخد
        // _offlineFkTempId (نفس آلية caseSessionLinkingShared.ts) عشان يتربط
        // بالـ case_id الحقيقي وقت المزامنة بدل ما ننتظر id حقيقي دلوقتي.
        // النتيجة بترجع سبب الفشل صراحةً (بدل boolean بس) عشان مكان النداء
        // يقدر يختار الرسالة المناسبة من غير ما نعرض توست مزدوج (واحد من
        // جوه الدالة وواحد تاني من بره) لنفس المشكلة.
        type InsertPartiesResult = { ok: true } | { ok: false; reason: 'validation'; message: string } | { ok: false; reason: 'write' };
        const insertCaseParties = async (caseId: string | null, isOffline: boolean, isQueued: boolean): Promise<InsertPartiesResult> => {
            const parties = form.parties;
            if (!parties || parties.length === 0) return { ok: true };
            // 🔒 NEW (خطوة 4.3 — خطة تعدد الأطراف، قسم 7-ج): فاليديشن سيرفر
            // مكرر — نفس قواعد casePartiesValidation.ts (اسم/صفة إجباريين،
            // رقم قومي 14 رقم لموكل المكتب، طرف is_client واحد على الأقل،
            // منع تكرار الرقم القومي...) بتتفحص تاني هنا قبل أي INSERT حقيقي،
            // مش بس فاليديشن الفورم (usePartyFields.ts). ده خط دفاع تاني —
            // فورم NewCaseModal.tsx بيمنع الحفظ أصلاً لو الفاليديشن فشلت، فمن
            // المفروض الحالة دي متوصلش هنا عمليًا، لكن لو مصدر حفظ تاني ظهر
            // مستقبلًا (أو state الفورم اتلاعب فيه برمجيًا قبل onSave)، بنرفض
            // كتابة أي صف بدل ما نسيب بيانات غير صالحة توصل case_parties —
            // ومفيش أي INSERT بيتبعت خالص لو الفحص فشل (رفض كامل قبل أول نداء).
            // 🆕 (خطة "المسمى القانوني" — مرحلة 3): بنبعت legalTitles من
            // form هنا كمان، وإلا الفحص السيرفري مش هيطبّق قاعدة 6 (إلزامية
            // المسمى القانوني عند ≥٢ أشخاص) خالص، حتى لو فورم الحفظ نفسه
            // بيطبّقها (فاليديشن الفورم بس مش كافي — نفس فلسفة باقي القواعد).
            const serverCheck = validateParties(parties, {
                plaintiff: form.plaintiff_legal_title || '',
                defendant: form.defendant_legal_title || '',
            });
            if (!serverCheck.valid) {
                return { ok: false, reason: 'validation', message: serverCheck.message || '⚠️ بيانات أطراف الدعوى غير مكتملة أو غير صحيحة' };
            }
            let allOk = true;
            for (let i = 0; i < parties.length; i++) {
                const p = parties[i];
                const rowData: Record<string, unknown> = {
                    case_id: caseId,
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
                const finalData = withFkOfflineSentinel(isOffline, isQueued, 'case_id', offlineTempId, 'cases', form.title, rowData);
                const partyResult = await window.__dbWrite({ type: 'INSERT', table: 'case_parties', data: finalData });
                if (partyResult.error) allOk = false;
            }
            return allOk ? { ok: true } : { ok: false, reason: 'write' };
        };

        const { error, offline, queued, data: insertedCase } = await window.__dbWrite({
            type: 'INSERT', table: 'cases', data: payload, returning: true
        });
        if (offline && queued) {
            // BUG-20 FIX: لو فيه تاريخ جلسة، نحفظها في الـ queue مع _offlineCaseTempId
            // (+ _offlineCaseTitle كـ fallback) عشان الـ sync handler يقدر يربطها
            // بالـ id الحقيقي بعد ما القضية تتزامن
            if (form.date) {
                await window.__dbWrite({
                    type: 'INSERT',
                    table: 'case_sessions',
                    data: {
                        _offlineCaseTempId: offlineTempId, // مطابقة أساسية دقيقة
                        _offlineCaseTitle: form.title,     // fallback لو التشغيلة مختلفة
                        case_id: null,                   // هيتملى وقت المزامنة
                        session_date: form.date,
                        session_time: form.session_time || 'صباحي',
                        session_floor: form.court_floor || null,
                        session_hall: form.court_hall || null,
                        description: 'الجلسة الأولى',
                        result: null,
                        next_action: null,
                    },
                });
            }
            toast('📥 محفوظة محلياً — ستُضاف فور عودة الإنترنت');
            // الأطراف بتتقيّد هي كمان في نفس طابور الأوفلاين — بتتحل تلقائيًا
            // بالـ case_id الحقيقي وقت المزامنة (_offlineFkTempId فوق).
            const offlinePartiesResult = await insertCaseParties(null, true, true);
            // ⚡ NEW (4.3): القضية نفسها اتقيّدت أوفلاين بنجاح (توست فوق)،
            // لكن لو فحص الأطراف فشل (نادر جدًا — يعني state الفورم اتلاعب
            // فيه برمجيًا بعد فاليديشن الفورم)، لازم نعلم المستخدم إن أطراف
            // الدعوى مانضافتش رغم إن القضية اتقيّدت، بدل ما نسكت عن الفشل.
            if (!offlinePartiesResult.ok) {
                toast(
                    offlinePartiesResult.reason === 'validation'
                        ? offlinePartiesResult.message
                        : '⚠️ القضية اتقيّدت محليًا، لكن حصل خطأ في حفظ بعض أطراف الدعوى الإضافية — راجعها بعد المزامنة',
                    true
                );
            }
            setCases((prev) => [{ ...payload, id: offlineId, ...form, status: 'نشطة', date: form.date || '—' } as unknown as MappedCase, ...prev]);
        } else if (error) {
            // 🔒 FIX (تقرير الموثوقية — نتيجة 3): خط دفاع أخير — راجع
            // التعليق المماثل في useClientActions.ts.
            if ((error as { code?: string }).code === '23505') {
                toast('⚠️ رقم القيد ده مسجل بالفعل لقضية موجودة', true);
            } else {
                toast('❌ فشل تسجيل القضية الجديدة — تحقق من الاتصال وأعد المحاولة', true);
            }
            setSavingCase(false);
            return;
        } else {
            // ── تسجيل الجلسة الأولى في case_sessions لو فيه تاريخ ──
            // بناخد id القضية مباشرة من نتيجة الإدراج (بدل التخمين
            // بإعادة استعلام بالعنوان — كان بيسبب ربط غلط لو فيه قضيتين
            // بنفس العنوان اتسجلوا في نفس اللحظة تقريبًا)
            const newCaseId: string | null = insertedCase?.id || null;
            if (form.date && newCaseId) {
                await db.from('case_sessions').insert([{
                    case_id: newCaseId,
                    session_date: form.date,
                    session_time: form.session_time || 'صباحي',
                    session_floor: form.court_floor || null,
                    session_hall: form.court_hall || null,
                    description: 'الجلسة الأولى',
                    result: null,
                    next_action: null,
                }]);
            } else if (form.date && !newCaseId) {
                // حالة نادرة: القضية اتسجلت بنجاح لكن السيرفر معادش الصف
                // المُدرج (مثلاً سياسة RLS بتمنع SELECT بعد INSERT) — القضية
                // موجودة فعليًا، بس الجلسة الأولى محتاجة تتضاف يدويًا.
                toast('⚠️ القضية اتسجلت، بس الجلسة الأولى محتاجة تتضاف يدويًا من صفحة القضية', true);
            }
            // ⚡ NEW (مرحلة 4.2): تسجيل كل أطراف الدعوى في case_parties — أونلاين
            // بالـ id الحقيقي مباشرة (مفيش داعي لسنتينل هنا).
            if (newCaseId) {
                const partiesResult = await insertCaseParties(newCaseId, false, false);
                if (!partiesResult.ok) {
                    // 🔒 (4.3): فشل الفاليديشن بيتعرض برسالته المحدّدة (نفس
                    // رسالة usePartyFields.ts)، وفشل الكتابة بيتعرض برسالة
                    // عامة — توست واحد بس في الحالتين، مش توست مزدوج.
                    toast(
                        partiesResult.reason === 'validation'
                            ? partiesResult.message
                            : '⚠️ القضية اتسجلت، لكن حصل خطأ في حفظ بعض أطراف الدعوى الإضافية — راجعها من تفاصيل القضية',
                        true
                    );
                }
            }
            toast('✅ تم الحفظ في نظام سند!');
            // إشعار تليجرام
            const caseNumLabel = form.caseNum && form.caseYear
                ? `${form.caseNum} لسنة ${form.caseYear}`
                : (form.number || '—');
            logActivity(db, 'إضافة قضية', {
                userName: _userName,
                entity_type: 'case', entity_id: newCaseId,
                details: `${form.title} — رقم القيد: ${caseNumLabel}`,
                case_name: form.title || null,
                case_type: form.type || null,
                client_name: clients.find((cl) => cl.id === form.client_id)?.full_name || null,
            });
            let caseMsg = `⚖️ <b>قضية جديدة تم تقييدها</b>\n`;
            caseMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
            caseMsg += `📋 <b>رقم القيد:</b> ${escapeTelegramHtml(caseNumLabel)}\n`;
            caseMsg += `📌 <b>الموضوع:</b> ${escapeTelegramHtml(form.title)}\n`;
            caseMsg += `🏛 <b>المحكمة:</b> ${escapeTelegramHtml(form.court || '—')}\n`;
            caseMsg += `📂 <b>التصنيف:</b> ${escapeTelegramHtml(form.type || '—')}\n`;
            // ⚡ FIX: الصفة بقت حقل منفصل (plaintiff_role/defendant_role) بدل ما تكون
            // متضمنة جوه نص plaintiff/defendant — نضيفها هنا صراحةً عشان الرسالة متفقدش المعلومة.
            if (form.plaintiff) caseMsg += `🟢 <b>المدعي:</b> ${escapeTelegramHtml(form.plaintiff)}${form.plaintiff_role ? ' — ' + escapeTelegramHtml(form.plaintiff_role) : ''}\n`;
            if (form.defendant) caseMsg += `🔴 <b>المدعى عليه:</b> ${escapeTelegramHtml(form.defendant)}${form.defendant_role ? ' — ' + escapeTelegramHtml(form.defendant_role) : ''}\n`;
            if (form.date) caseMsg += `📆 <b>أقرب جلسة:</b> ${escapeTelegramHtml(form.date)}\n`;
            sendTelegram(caseMsg);
            fetchCases(0, casesFilter);
        }
        setSavingCase(false);
        setShowCaseModal(false);
    };

    // ─ حذف قضية نهائيًا من قاعدة البيانات (مرحلة 2 — كاسكيد كامل، ومرحلة 3 — M-3: عكس الترتيب) ─
    // ⚠️ النطاق مبني على القرار المحسوم فى الخطة (18 يوليو 2026) بعد تحقق فعلي
    // من delete_rule الحقيقي لكل الـ FKs فى الداتابيز الحية:
    //   - case_sessions / case_events → CASCADE تلقائي مع حذف صف القضية (مفيش كود مطلوب)
    //   - case_documents (سجل DB) → CASCADE تلقائي كمان، لكن الملفات الفعلية فى
    //     Storage (bucket 'case-docs') لازم تتحذف يدويًا، فبنجيب storage_path بتاعتها
    //     الأول (SELECT بلا أي أثر جانبي) قبل ما صفوفها تتحذف تلقائيًا من الداتابيز.
    //   - case_fees / fee_payments / invoices → SET NULL تلقائي، مايتحذفوش خالص
    //     (القرار الصريح: حذف قضية ميحذفش الأتعاب المرتبطة بيها) — مفيش كود مطلوب هنا.
    // ⚠️ [مرحلة 3 — M-3] الترتيب بين حذف صف القضية وتنضيف Storage اتعكس عمدًا: حذف
    // صف القضية (DB) بقى أولًا، وتنضيف الـ Storage بقى تانيًا. لو حصل انقطاع بعد
    // الخطوة 1 (SELECT) وقبل حذف الصف، مفيش حاجة اتغيرت خالص (آمن). لو حصل انقطاع
    // بعد نجاح حذف الصف وقبل تنضيف الـ Storage، أسوأ حالة هي ملفات يتيمة فى bucket
    // 'case-docs' (تسرب تخزين بسيط) — مش روابط مكسورة أو صف قضية عالق زي ما كان
    // ممكن يحصل مع الترتيب القديم (Storage الأول، DB تاني).
    const handlePermanentDeleteCase = async (caseId: string) => {
        const c = cases.find((x) => x.id === caseId);

        // ─ خطوة 1: جلب storage_path لمستندات القضية (قبل ما صفوفها تتحذف تلقائيًا) ─
        const { data: docs, error: docsFetchError } = await db.from('case_documents')
            .select('storage_path').eq('case_id', caseId);
        if (docsFetchError) {
            toast('❌ فشل التحقق من مستندات القضية — تحقق من الاتصال وأعد المحاولة', true);
            return;
        }
        const paths = (docs || []).map((d) => d.storage_path).filter((p): p is string => !!p);

        // ─ خطوة 2: حذف صف القضية أولًا — الداتابيز بتكمل الباقي تلقائيًا (CASCADE/SET NULL) ─
        const { error } = await db.from('cases').delete().eq('id', caseId);
        if (error) {
            nav.closeModal('delete');
            setDeleteConfirm(null);
            toast('❌ فشل حذف القضية نهائياً — تحقق من الاتصال وأعد المحاولة', true);
            return;
        }

        // ─ خطوة 3: تنضيف ملفات Storage — بعد التأكد إن صف القضية اتمسح فعليًا ─
        if (paths.length > 0) {
            const { error: storageErr } = await db.storage.from('case-docs').remove(paths);
            // ⚠️ فشل حذف الملفات مش سبب لإيقاف/إلغاء حذف القضية (اتحذفت خلاص) —
            // بنحذّر المستخدم إنه يراجع bucket 'case-docs' يدويًا لو فيه ملفات يتيمة.
            if (storageErr) toast('⚠️ تعذّر حذف بعض ملفات المستندات من التخزين — راجع bucket المستندات يدويًا', true);
        }

        nav.closeModal('delete');
        setDeleteConfirm(null);
        toast('🗑️ تم حذف القضية نهائياً');
        logActivity(db, 'حذف قضية نهائياً', {
            userName: _userName,
            entity_type: 'case', entity_id: caseId, details: c?.title || null,
            case_name: c?.title || null,
            case_type: c?.type || null,
            client_name: clients.find((cl) => cl.id === c?.client_id)?.full_name || null,
        });
        setSelectedCase(null);
        setCases((prev) => prev.filter((cs) => cs.id !== caseId));
    };

    // ─ حذف قضية: يعرض اختيار (أرشفة/حذف نهائي) عن طريق DeleteConfirmModal ─
    const handleDeleteCase = async (caseId: string) => {
        const c = cases.find((x) => x.id === caseId);
        setDeleteConfirm({
            type: 'case', id: caseId,
            name: c?.title || 'القضية',
            itemType: 'القضية',
            title: 'حذف القضية',
            onConfirmArchive: async () => {
                const { error } = await db.from('cases').update({ deleted_at: new Date().toISOString() }).eq('id', caseId);
                nav.closeModal('delete');
                setDeleteConfirm(null);
                if (error) { toast('❌ فشل أرشفة القضية — تحقق من الاتصال وأعد المحاولة', true); return; }
                toast('📦 تم نقل القضية للأرشيف');
                // ⚠️ FIX (2 من 14 يوليو 2026 — اكتشاف تاني عن طريق التحقق من الأنواع):
                // كان الكود بيقرأ c?.case_type. الفيكس السابق (الأقدم) كان افترض إن
                // `c` (جاي من متغيّر `cases` بارامتر الهوك) نوعه CaseRow الخام (فيه
                // case_type)، لكن الداتا الفعلية وقت التشغيل هي MappedCase (النوع
                // المُطبَّع من useAppData.ts) اللي اسم الحقل فيها `type` مش `case_type`.
                // يعني c?.case_type كانت بترجع undefined دايمًا فعليًا، والحقل كان
                // بيتسجل null دايمًا في سجل النشاط لكل عملية أرشفة قضية — نفس فصيلة
                // الباگ القديم بالظبط لكن بالاتجاه العكسي. اتصلح دلوقتي بعد ما اتغيّر
                // نوع `cases`/`selectedCase` فعليًا لـ MappedCase[]/MappedCase|null.
                logActivity(db, 'أرشفة قضية', {
                    userName: _userName,
                    entity_type: 'case', entity_id: caseId, details: c?.title || null,
                    case_name: c?.title || null,
                    case_type: c?.type || null,
                    client_name: clients.find((cl) => cl.id === c?.client_id)?.full_name || null,
                });
                setSelectedCase(null);
                setCases((prev) => prev.filter((cs) => cs.id !== caseId));
            },
            onConfirmDelete: () => handlePermanentDeleteCase(caseId),
            deleteConsequences: [
                'سيُحذف نهائيًا: بيانات القضية، الجلسات، المستندات المرفوعة (والملفات الفعلية)، وأي عناصر أخرى تابعة للقضية فقط.',
                'الأتعاب والفواتير المرتبطة بالقضية تفضل محفوظة بالكامل — بس رابطها بالقضية بيتصفّر.',
                'لا يمكن التراجع عن هذا الإجراء.',
            ],
        });
    };

    // ─ استرجاع قضية من الأرشيف ─
    const handleRestoreCase = async (caseId: string) => {
        const { error } = await db.from('cases').update({ deleted_at: null }).eq('id', caseId);
        if (error) { toast('❌ فشل استرجاع القضية — تحقق من الاتصال وأعد المحاولة', true); return; }
        toast('✅ تم استرجاع القضية');
        logActivity(db, 'استرجاع قضية من الأرشيف', { userName: _userName, entity_type: 'case', entity_id: caseId });
        fetchCases(0, casesFilter);
    };

    // ─ تعديل قضية ─
    const handleUpdateCase = async (caseId: string, form: CaseFormSubmitData) => {
        if (!form.title || !form.title.trim()) {
            toast('❌ حقل "موضوع ومسمى الدعوى" مطلوب', true);
            return;
        }
        // 🔒 FIX (تقرير الموثوقية — نتيجة 1): الدالة دي ما كانش فيها أي
        // حماية دبل كليك خالص (بعكس handleSaveCase اللي فيها setSavingCase).
        // بنستخدم نفس savingCase state عشان EditCaseModal يقدر يقفل زراره.
        setSavingCase(true);
        try {
            // 🔒 FIX (تقرير الموثوقية — نتيجة 2، مُصحَّحة): نفس فحص تكرار
            // رقم القيد (رقم + محكمة + نوع مع بعض) المستخدم في
            // handleSaveCase، بس هنا بنستبعد القضية نفسها من المقارنة
            // (excludeCaseId) عشان تعديل قضية بنفس رقمها الحالي (من غير
            // تغيير) ميترفضش بالغلط كـ"تكرار مع نفسها".
            let caseDup;
            try {
                caseDup = await checkCaseNumberDuplicate(db, form.number, form.court_level, form.type, caseId);
            } catch (e) {
                showErrorToast('case_number_duplicate_check', e, 'تعذّر التحقق من رقم القيد. حاول مرة أخرى.', 'تعديل قضية');
                setSavingCase(false);
                return;
            }
            if (caseDup.duplicate) { toast(caseDup.message!, true); setSavingCase(false); return; }

            // ⚡ NEW (مرحلة 5.2 — خطة تعدد الأطراف، 22 يوليو 2026): نفس فلسفة
            // insertCaseParties في handleSaveCase (فاليديشن سيرفر مكرر أولاً،
            // رفض كامل قبل أي كتابة لو فشلت — راجع 4.3)، بس هنا upsert-by-id
            // بدل INSERT بس: id موجود في existingPartyIds (اللي جت من
            // EditCaseModal وقت فتح الفورم) = تعديل، id مؤقت (`legacy-*`/
            // `party-*`) أو أي id تاني مش في القايمة = إضافة جديدة، وأي id
            // كان في existingPartyIds واتشال من form.parties دلوقتي = حذف.
            // بنداءات __dbWrite منفصلة (زي 4.2 بالظبط — بدون ذرّية كاملة)،
            // ومفيش حاجة لـ _offlineFkTempId هنا (بعكس 4.2) لأن caseId هنا
            // حقيقي دايمًا (القضية أصلاً موجودة قبل التعديل)، أونلاين أو
            // أوفلاين — window.__dbWrite بيتعامل مع الأوفلاين لوحده لكل نداء.
            type SyncPartiesResult = { ok: true } | { ok: false; reason: 'validation'; message: string } | { ok: false; reason: 'write' };
            const syncCaseParties = async (targetCaseId: string): Promise<SyncPartiesResult> => {
                const parties = form.parties;
                if (!parties) return { ok: true };
                // 🆕 (خطة "المسمى القانوني" — مرحلة 3): نفس منطق insertCaseParties فوق.
                const serverCheck = validateParties(parties, {
                    plaintiff: form.plaintiff_legal_title || '',
                    defendant: form.defendant_legal_title || '',
                });
                if (!serverCheck.valid) {
                    return { ok: false, reason: 'validation', message: serverCheck.message || '⚠️ بيانات أطراف الدعوى غير مكتملة أو غير صحيحة' };
                }
                const existingIds = form.existingPartyIds || [];
                const currentIds = new Set(parties.map((p) => p.id));
                let allOk = true;
                // 1) حذف أي صف كان موجود فعلاً وقت فتح الفورم واتشال منها دلوقتي
                for (const oldId of existingIds) {
                    if (!currentIds.has(oldId)) {
                        const delResult = await window.__dbWrite({ type: 'DELETE', table: 'case_parties', id: oldId });
                        if (delResult.error) allOk = false;
                    }
                }
                // 2) upsert لكل طرف موجود في الفورم دلوقتي — تعديل لو الـ id
                // حقيقي وموجود في existingIds، إضافة جديدة لو مش موجود فيها
                // (id مؤقت من usePartyFields أو fallback القديم).
                for (let i = 0; i < parties.length; i++) {
                    const p = parties[i];
                    const rowData: Record<string, unknown> = {
                        case_id: targetCaseId,
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

            const payload = {
                case_number_official: form.number || null,
                title: form.title,
                court_name: form.court || null,
                case_type: form.type || null,
                status: form.status || undefined,
                client_id: (form.client_id !== undefined ? form.client_id : cases.find((c) => c.id === caseId)?.client_id) || null,
                plaintiff: form.plaintiff || null,
                plaintiff_role: form.plaintiff_role || null,
                defendant: form.defendant || null,
                defendant_role: form.defendant_role || null,
                court_level: form.court_level || null,
                circuit_number: form.circuit_number || null,
                next_hearing: form.date || null,
                session_hall: form.session_hall || null,
                secretary_hall: form.secretary_hall || null,
                secretary_name: form.secretary_name || null,
                secretary_mobile: form.secretary_mobile || null,
                plaintiff_national_id: form.plaintiff_national_id || null,
                plaintiff_power_of_attorney: form.plaintiff_power_of_attorney || null,
                defendant_national_id: form.defendant_national_id || null,
                plaintiff_address: form.plaintiff_address || null,
                plaintiff_legal_title: form.plaintiff_legal_title || null,
                defendant_legal_title: form.defendant_legal_title || null,
            };
            // FIX: Optimistic Locking لتعديل القضايا — كان `updated_at` بيتجاب
            // ويتخزّن في الـ state (شوف useAppData.ts) خصيصًا للاستخدام هنا، بس
            // مكانش بيتبعت فعليًا لـ __dbWrite، فحماية "تعارض التعديل" كانت
            // معطّلة تمامًا لتعديل القضايا (بعكس الأتعاب/الموكلين/الجلسات).
            const existingCase = cases.find((c) => c.id === caseId);
            const knownUpdatedAt = existingCase?.updated_at
                || (selectedCase?.id === caseId ? selectedCase?.updated_at : null)
                || null;

            const { error, offline, queued, conflict, data: writtenRow } = await window.__dbWrite({
                type: 'UPDATE', table: 'cases', data: payload, id: caseId, knownUpdatedAt
            });
            if (offline && queued) {
                toast('📥 التعديل محفوظ محلياً — سيُزامن عند عودة الإنترنت');
                // تحديث فوري في الـ state المحلي
                setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, ...form } : c));
                if (selectedCase?.id === caseId) setSelectedCase((p) => p ? { ...p, ...form } : p);
                // ⚡ NEW (5.2): القضية اتقيّدت أوفلاين — نفس مبدأ 4.3، نزامن
                // أطراف الدعوى (حذف/تعديل/إضافة) في نفس الطابور، ونعلم
                // المستخدم لو فيه فشل فاليديشن/كتابة من غير ما نمنع نجاح
                // تعديل القضية نفسها.
                const offlinePartiesResult = await syncCaseParties(caseId);
                if (!offlinePartiesResult.ok) {
                    toast(
                        offlinePartiesResult.reason === 'validation'
                            ? offlinePartiesResult.message
                            : '⚠️ التعديل اتحفظ محليًا، لكن حصل خطأ في مزامنة بعض أطراف الدعوى — راجعها بعد المزامنة',
                        true
                    );
                }
            } else if (conflict) {
                // 💥 حد تاني عدّل نفس القضية بعد ما إحنا فتحناها — منرفضش نكتب
                // فوق تعديله بصمت. بنسيب البيانات المعروضة زي ما هي ونطلب من
                // المستخدم يفتح القضية تاني عشان يشوف آخر نسخة قبل ما يعدّل.
                toast('⚠️ هذه القضية عدّلها شخص آخر بعد ما فتحتها — أعد فتحها وحاول التعديل مرة أخرى', true);
                setSavingCase(false);
                return;
            } else if (error) {
                if ((error as { code?: string }).code === '23505') {
                    toast('⚠️ رقم القيد ده مسجل بالفعل لقضية موجودة', true);
                } else {
                    toast('❌ فشل تعديل بيانات القضية — تحقق من الاتصال وأعد المحاولة', true);
                }
                setSavingCase(false);
                return;
            } else {
                // ── تسجيل جلسة جديدة لو تاريخ الجلسة تغيّر ──
                if (form.date) {
                    const oldDate = (selectedCase?.date === '—' ? '' : selectedCase?.date) || '';
                    if (form.date !== oldDate) {
                        const { data: existing } = await db.from('case_sessions')
                            .select('id')
                            .eq('case_id', caseId)
                            .eq('session_date', form.date)
                            .maybeSingle();
                        if (!existing) {
                            await db.from('case_sessions').insert([{
                                case_id: caseId,
                                session_date: form.date,
                                session_time: form.session_time || 'صباحي',
                                session_floor: form.court_floor || null,
                                session_hall: form.court_hall || null,
                                description: 'جلسة محددة',
                                result: null,
                                next_action: null,
                            }]);
                        }
                    }
                }
                // ⚡ NEW (5.2): مزامنة أطراف الدعوى الفعلية أونلاين — بالـ id
                // الحقيقي مباشرة (مفيش داعي لسنتينل، caseId حقيقي أصلاً).
                const partiesResult = await syncCaseParties(caseId);
                if (!partiesResult.ok) {
                    // 🔒 نفس مبدأ 4.3: توست واحد بس، برسالة الفاليديشن
                    // المحددة لو ده السبب، أو رسالة عامة لو فشل الكتابة.
                    toast(
                        partiesResult.reason === 'validation'
                            ? partiesResult.message
                            : '⚠️ تم تحديث القضية، لكن حصل خطأ في مزامنة بعض أطراف الدعوى — راجعها من تفاصيل القضية',
                        true
                    );
                }
                toast('✅ تم تحديث القضية');
                logActivity(db, 'تعديل قضية', {
                    userName: _userName,
                    entity_type: 'case', entity_id: caseId, details: form.title || null,
                    case_name: form.title || null,
                    case_type: form.type || cases.find((c) => c.id === caseId)?.type || null,
                    client_name: clients.find((cl) => cl.id === payload.client_id)?.full_name || null,
                });
                // تحديث فوري للحالة المحلية — عشان الشاشة المفتوحة (CaseDetailView) تعرض القيم الجديدة فورًا
                // ⚠️ بنحدّث updated_at كمان من قيمة السيرفر الفعلية بعد الكتابة (writtenRow) —
                // من غيرها، أي تعديل تاني على نفس القضية بعد التعديل ده مباشرة كان
                // هيتكشف غلط كـ"تعارض" مع نفسه (لأن آخر updated_at محفوظة محليًا
                // كانت هتفضل القديمة من قبل الحفظ، مش الجديدة بعده).
                const freshFields = writtenRow?.updated_at ? { updated_at: writtenRow.updated_at } : {};
                setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, ...form, ...freshFields } : c));
                if (selectedCase?.id === caseId) setSelectedCase((p) => p ? { ...p, ...form, ...freshFields } : p);
                // إشعار تليجرام - تعديل قضية
                let updMsg = `✏️ <b>تم تعديل بيانات قضية</b>\n`;
                updMsg += `━━━━━━━━━━━━━━━━━━━━\n`;
                updMsg += `📋 <b>رقم القيد:</b> ${escapeTelegramHtml(form.number || '—')}\n`;
                updMsg += `📌 <b>الموضوع:</b> ${escapeTelegramHtml(form.title)}\n`;
                updMsg += `🏛 <b>المحكمة:</b> ${escapeTelegramHtml(form.court || '—')}\n`;
                if (form.plaintiff) updMsg += `🟢 <b>المدعي:</b> ${escapeTelegramHtml(form.plaintiff)}${form.plaintiff_role ? ' — ' + escapeTelegramHtml(form.plaintiff_role) : ''}\n`;
                if (form.defendant) updMsg += `🔴 <b>المدعى عليه:</b> ${escapeTelegramHtml(form.defendant)}${form.defendant_role ? ' — ' + escapeTelegramHtml(form.defendant_role) : ''}\n`;
                if (form.date) updMsg += `📆 <b>الجلسة القادمة:</b> ${escapeTelegramHtml(form.date)}\n`;
                sendTelegram(updMsg);
                fetchCases(0, casesFilter);
            }
            setSavingCase(false);
        } catch (e) {
            toast('❌ خطأ في الاتصال، تحقق من الإنترنت وأعد المحاولة', true);
            setSavingCase(false);
        }
    };

    // ─ ربط قضية بموكل ─
    // ⚡ NEW (19 يوليو 2026): قبل كده مافيش أي طريقة تربط قضية بموكل بعد
    // إنشائها (NewCaseModal بس هو اللي بيحدد client_id وقت الإنشاء، و
    // EditCaseModal مابيبعتش client_id خالص — شوف تعليق CaseFormSubmitData
    // فوق). الدالة دي بتحدّث عمود client_id بس، من غير ما تلمس أي حقل تاني
    // في القضية (بعكس handleUpdateCase اللي بيعيد كتابة كل الحقول من الـ form).
    const handleLinkClient = async (caseId: string, clientId: string) => {
        const existingCase = cases.find((c) => c.id === caseId);
        const linkedClient = clients.find((cl) => cl.id === clientId);
        const knownUpdatedAt = existingCase?.updated_at
            || (selectedCase?.id === caseId ? selectedCase?.updated_at : null)
            || null;
        // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 6): قبل كده الدالة دي
        // كانت بتحدّث client_id بس، وتسيب plaintiff/plaintiff_national_id/
        // plaintiff_power_of_attorney/plaintiff_address زي ما هي (بيانات
        // حرة قديمة ممكن تكون مختلفة عن ملف الموكل الحقيقي) — أي مكان
        // بيقرا العمودين دول مباشرة من غير join كان هيعرض بيانات قديمة
        // رغم إن القضية بقت "مربوطة". دلوقتي بنزامن الحقول دي من ملف
        // الموكل الحي في نفس عملية الربط — الواجهة (InfoSection.tsx) هي
        // اللي بتعرض تنبيه التعارض قبل ما تنده الدالة دي أصلاً لو فيه
        // قيم حرة مختلفة عن الموكل، فبحلول ما نوصل هنا يبقى إما مفيش
        // تعارض أو المستخدم أكّد الاستبدال.
        const syncedFields = linkedClient ? {
            plaintiff: linkedClient.full_name || null,
            plaintiff_national_id: linkedClient.national_id || null,
            plaintiff_power_of_attorney: linkedClient.cr_number || null,
            plaintiff_address: linkedClient.address || null,
        } : {};
        const { error, offline, queued, conflict, data: writtenRow } = await window.__dbWrite({
            type: 'UPDATE', table: 'cases', data: { client_id: clientId, ...syncedFields }, id: caseId, knownUpdatedAt
        });
        if (offline && queued) {
            toast('📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
            setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, client_id: clientId, ...syncedFields } : c));
            if (selectedCase?.id === caseId) setSelectedCase((p) => p ? { ...p, client_id: clientId, ...syncedFields } : p);
            return;
        }
        if (conflict) {
            toast('⚠️ هذه القضية عدّلها شخص آخر بعد ما فتحتها — أعد فتحها وحاول الربط مرة أخرى', true);
            return;
        }
        if (error) {
            toast('❌ فشل ربط القضية بالموكل — تحقق من الاتصال وأعد المحاولة', true);
            return;
        }
        const clientName = linkedClient?.full_name || null;
        toast('✅ تم ربط القضية بالموكل');
        logActivity(db, 'ربط قضية بموكل', {
            userName: _userName,
            entity_type: 'case', entity_id: caseId, details: existingCase?.title || null,
            case_name: existingCase?.title || null,
            client_name: clientName,
        });
        const freshFields = writtenRow?.updated_at ? { updated_at: writtenRow.updated_at } : {};
        setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, client_id: clientId, ...syncedFields, ...freshFields } : c));
        if (selectedCase?.id === caseId) setSelectedCase((p) => p ? { ...p, client_id: clientId, ...syncedFields, ...freshFields } : p);
        fetchCases(0, casesFilter);
    };

    // ─ فك ربط قضية عن موكلها ─
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 4): عكس handleLinkClient
    // بالظبط — بتصفّر عمود client_id بس (ترجعه NULL) من غير ما تلمس أي
    // حقل تاني في القضية (الاسم/الرقم القومي/التوكيل/العنوان بتاعت
    // القضية بتفضل زي ما هي كانت آخر مرة، بس دلوقتي بقت بيانات حرة قابلة
    // للتعديل بدل ما تتقرا من ملف الموكل — نفس آلية EditCaseModal.tsx
    // اللي بتحدد isLinked من client_id).
    const handleUnlinkClient = async (caseId: string) => {
        const existingCase = cases.find((c) => c.id === caseId);
        const knownUpdatedAt = existingCase?.updated_at
            || (selectedCase?.id === caseId ? selectedCase?.updated_at : null)
            || null;
        const { error, offline, queued, conflict, data: writtenRow } = await window.__dbWrite({
            type: 'UPDATE', table: 'cases', data: { client_id: null }, id: caseId, knownUpdatedAt
        });
        if (offline && queued) {
            toast('📥 فك الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
            setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, client_id: null } : c));
            if (selectedCase?.id === caseId) setSelectedCase((p) => p ? { ...p, client_id: null } : p);
            return;
        }
        if (conflict) {
            toast('⚠️ هذه القضية عدّلها شخص آخر بعد ما فتحتها — أعد فتحها وحاول فك الربط مرة أخرى', true);
            return;
        }
        if (error) {
            toast('❌ فشل فك ربط القضية عن الموكل — تحقق من الاتصال وأعد المحاولة', true);
            return;
        }
        toast('✅ تم فك الربط — بيانات الموكل في القضية بقت قابلة للتعديل الحر');
        logActivity(db, 'فك ربط قضية عن موكل', {
            userName: _userName,
            entity_type: 'case', entity_id: caseId, details: existingCase?.title || null,
            case_name: existingCase?.title || null,
        });
        const freshFields = writtenRow?.updated_at ? { updated_at: writtenRow.updated_at } : {};
        setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, client_id: null, ...freshFields } : c));
        if (selectedCase?.id === caseId) setSelectedCase((p) => p ? { ...p, client_id: null, ...freshFields } : p);
        fetchCases(0, casesFilter);
    };

    // ─ إنشاء موكل جديد من بيانات القضية وربطه بها ─

    // ⚡ REMOVED (خطة توحيد إنشاء الموكل، Phase 1): كانت هنا نسخة كاملة من
    // منطق "إنشاء موكل" (INSERT مباشر بحقول ناقصة: اسم + رقم قومي بس، من
    // غير هاتف/نوع/فحص تكرار كامل). اتشالت واستُبدلت بفتح NewClientModal
    // نفسه (نفس موديل قسم الموكلين، بكل حقوله الإلزامية) عبر
    // openNewClientModal في App.tsx — شوف handleOpenCreateClientForCase.
    // الزرار بتاعها في InfoSection.tsx بقى بيستدعي onCreateAndLinkClient
    // اللي هو دلوقتي مجرد فتح-موديل، مش عملية حفظ.

    return { handleLogout, handleSaveCase, handleDeleteCase, handlePermanentDeleteCase, handleRestoreCase, handleUpdateCase, handleLinkClient, handleUnlinkClient };
}
