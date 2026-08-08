import React, { useState, useCallback, useMemo } from 'react';
import { db } from '../supabaseClient';
import { recordError, recordSuccess } from '../systemHealth';
import { ilikeOrClause } from '../shared/lib/sanitize';
import type { CaseRow, ClientRow, ProfileRow } from '../types';
// ⚡ NEW (خطة تفكيك الأعمدة القديمة، المرحلة B.4 — 6 أغسطس 2026): نفس
// شكل صف الطرف المستخدم في B.1/B.2/B.3 (`PartyDisplayRow`) — بيتاح دلوقتي
// كحقل جاهز على MappedCase نفسها (`parties`) عشان أي مستهلك مستقبلي
// لـ useAppData (شاشات تانية غير الكالندر/الداشبورد/البحث اللي اتغطوا
// فعليًا) يقدر يستخدم derivePartiesDisplay/derivePartiesLine مباشرة من
// غير ما يحتاج نداء useSessionsPartiesMap منفصل بتاعه — حقل إضافي بحت،
// صفر تغيير على أي حقل موجود.
import type { PartyDisplayRow } from '@/shared/parties/partiesDisplay';

// شكل عنصر القضية بعد التطبيع (mapping) في fetchCases/searchCases —
// نفس الحقول اللي كانت بترجع فعليًا من الـ `.map(...)` تحت، من غير أي تغيير.
//
// ⚠️ FIX (14 يوليو 2026): court_floor/court_hall/session_hall/secretary_hall/
// secretary_name/session_time كانوا مش موجودين هنا مع إنهم أعمدة حقيقية موجودة
// في جدول `cases`. الأول أربعة (session_hall/secretary_hall/secretary_name)
// بيتحفظوا صح وقت إنشاء القضية (handleSaveCase) وكان ده باگ فقدان بيانات فعلي:
// EditCaseModal.tsx كان بيقرا caseData.session_hall/secretary_hall/secretary_name
// (دايمًا undefined لأنها مش في النوع القديم)، وعلى الحفظ handleUpdateCase كان
// بيكتبهم null فوق القيم الحقيقية المحفوظة — يعني كل تعديل لقضية (حتى لو تغيير
// بسيط في العنوان) كان بيمسح قاعة/سكرتير الجلسة المحفوظين فعليًا.
// `session_time` مختلف: عمود موجود في السكيما بس مش متكتوب في جدول `cases` أصلاً
// (لا في handleSaveCase ولا handleUpdateCase — القيمة الفعلية بتتخزن على مستوى
// الجلسة في `case_sessions`)، فمفيش فقدان بيانات هنا، بس كان عرض غلط (شاشة
// التعديل كانت دايمًا بترجع لـ "صباحي" الافتراضي بدل القيمة الحقيقية لو موجودة).
// اتصلح الكل بإضافة الحقول هنا وفي الـ .map() تحت.
export interface MappedCase {
    id: string;
    number: string;
    title: string;
    court: string;
    type: string;
    court_level: string | null;
    circuit_number: string | null;
    status: string;
    date: string;
    client_id: string | null;
    plaintiff: string | null;
    plaintiff_role: string | null;
    defendant: string | null;
    defendant_role: string | null;
    year: number;
    updated_at: string | null;
    court_floor: string | null;
    court_hall: string | null;
    session_hall: string | null;
    secretary_hall: string | null;
    secretary_name: string | null;
    secretary_mobile: string | null;
    session_time: string | null;
    // ⚡ NEW (19 يوليو 2026): بيانات رسمية إضافية للأطراف — كانت متسجلة في
    // جدول cases فعليًا (من فلو تحويل جلسة مستقلة لقضية بس)، دلوقتي
    // NewCaseModal/EditCaseModal بقوا بيسجلوها كمان عشان التوحيد ومفيش
    // بيانات تضيع بغض النظر عن الفلو اللي القضية جت منه.
    plaintiff_national_id: string | null;
    plaintiff_power_of_attorney: string | null;
    defendant_national_id: string | null;
    // ⚡ NEW (21 يوليو 2026): عنوان الموكل — نفس نمط plaintiff_national_id
    // فوق، حقل رسمي إضافي بيتسجل من NewCaseModal/EditCaseModal.
    plaintiff_address: string | null;
    // 🆕 (خطة "المسمى القانوني" — مرحلة 3، 23 يوليو 2026): المسمى الجامع
    // لكل جهة، بيظهر بس لو الجهة دي فيها شخصان فأكثر (case_parties) —
    // مخزّن على مستوى القضية نفسها، مش جوه صف طرف بعينه.
    plaintiff_legal_title: string | null;
    defendant_legal_title: string | null;
    // ⚡ NEW (المرحلة B.4 — 6 أغسطس 2026): صفوف case_parties الفعلية
    // للقضية دي (لو موجودة — مصفوفة فاضية لو لسه معتمدة على plaintiff/
    // defendant القدامى بس). بتتجاب دفعة واحدة لكل صفحة/نتيجة بحث (نفس
    // نمط useSessionsPartiesMap في B.1) مش نداء لكل قضية. الاستخدام
    // المقصود: derivePartiesDisplay(c.parties, {plaintiff: c.plaintiff, ...})
    // بدل قراءة c.plaintiff/c.defendant مباشرة في أي شاشة جديدة أو لسه
    // متلمسّة.
    parties?: PartyDisplayRow[];
}

// شكل عنصر الموكل بعد التطبيع في fetchClients — كل حقول ClientRow
// زي ما هي، بالإضافة لـ full_name/type اللي بيتم اشتقاقهم من client_name/client_type.
export type MappedClient = ClientRow;

// ── FIX (2.2): بناء خريطة "أقرب جلسة" الصحيحة لكل قضية ──
// ⚠️ قبل الإصلاح ده، كان بيتم الترتيب تنازليًا وأخذ أول ظهور — يعني
// كان بياخد أكبر تاريخ جلسة مسجّل للقضية (أبعد جلسة)، مش أقربها فعليًا.
// لو قضية عندها جلستين مستقبليتين، كان بيعرض الأبعد بدل الأقرب.
//
// المنطق الصحيح: "أقرب جلسة" = أقرب تاريخ من اليوم فصاعدًا (جلسة قادمة).
// لو مفيش جلسات قادمة، بنرجع لآخر جلسة ماضية (أحدث تاريخ) كـ fallback
// للعرض بس، بدل ما نسيب القضية من غير أي تاريخ.
function buildNearestSessionMap(sessionsData: { case_id: string | null; session_date: string | null }[]): { [k: string]: string } {
    const todayStr = new Date().toISOString().slice(0, 10);
    const upcoming: { [k: string]: string } = {};   // أقرب تاريخ >= اليوم
    const latestPast: { [k: string]: string } = {}; // أحدث تاريخ ماضي (fallback)

    (sessionsData || []).forEach((s) => {
        if (!s.session_date || !s.case_id) return;
        const caseId = s.case_id;
        const sessionDate = s.session_date;
        if (sessionDate >= todayStr) {
            if (!upcoming[caseId] || sessionDate < upcoming[caseId]) {
                upcoming[caseId] = sessionDate;
            }
        } else {
            if (!latestPast[caseId] || sessionDate > latestPast[caseId]) {
                latestPast[caseId] = sessionDate;
            }
        }
    });

    const merged: { [k: string]: string } = { ...latestPast, ...upcoming }; // القادمة لها أولوية لو موجودة
    return merged;
}

// ── B.4: جلب صفوف case_parties دفعة واحدة لمجموعة case_ids ──
// نفس نمط useSessionsPartiesMap (B.1) بس هنا بشكل دالة عادية (مش hook)
// لأنها بتتنادى جوه useCallback موجودة أصلًا (fetchCases/searchCases)،
// مش من جوه component body.
async function fetchPartiesMapByCaseIds(caseIds: string[]): Promise<{ [k: string]: PartyDisplayRow[] }> {
    if (caseIds.length === 0) return {};
    const { data, error } = await db
        .from('case_parties')
        .select('case_id,side,name,capacity,client_id')
        .in('case_id', caseIds)
        .order('sort_order', { ascending: true });
    if (error) {
        recordError('db_case_parties', error.message);
        return {};
    }
    const map: { [k: string]: PartyDisplayRow[] } = {};
    (data || []).forEach((p: { case_id: string | null } & PartyDisplayRow) => {
        if (!p.case_id) return;
        (map[p.case_id] ||= []).push(p);
    });
    return map;
}

// ⚡ NEW (فيكس فئة "اليتيم الوهمي" على القضايا — 8 أغسطس 2026): نفس منطق
// الـ .map() المكرر في fetchCases/searchCases بالحرف — مستخرج هنا كدالة
// مشتركة عشان ensureCasesLoaded (تحت) يقدر يبني MappedCase بنفس الشكل
// بالظبط لأي قضية بتتجاب بالـid مباشرة (برّه الصفحة/الفلتر الحالي).
function mapCaseRow(
    r: CaseRow,
    sessionsMap: { [k: string]: string },
    partiesMap: { [k: string]: PartyDisplayRow[] },
): MappedCase {
    return {
        id:             r.id,
        number:         r.case_number_official || '—',
        title:          r.title || '—',
        court:          r.court_name || '—',
        type:           r.case_type || 'عام',
        court_level:    r.court_level || null,
        circuit_number: r.circuit_number || null,
        status:         r.status || 'نشطة',
        date:           sessionsMap[r.id] || r.next_hearing || '—',
        client_id:      r.client_id,
        plaintiff:      null,
        plaintiff_role: null,
        defendant:      null,
        defendant_role: null,
        year:           r.created_at ? new Date(r.created_at).getFullYear() : new Date().getFullYear(),
        updated_at:     r.updated_at || null,
        court_floor:    r.court_floor || null,
        court_hall:     r.court_hall || null,
        session_hall:   r.session_hall || null,
        secretary_hall: r.secretary_hall || null,
        secretary_name: r.secretary_name || null,
        secretary_mobile: r.secretary_mobile || null,
        session_time:   r.session_time || null,
        plaintiff_national_id: null,
        plaintiff_power_of_attorney: null,
        defendant_national_id: null,
        plaintiff_address: null,
        plaintiff_legal_title: (r as unknown as { plaintiff_legal_title: string | null }).plaintiff_legal_title || null,
        defendant_legal_title: (r as unknown as { defendant_legal_title: string | null }).defendant_legal_title || null,
        parties:        partiesMap[r.id] || [],
    };
}

export function useAppData(profile: ProfileRow | null) {
    const isAdmin = profile?.role === 'admin';
    const PAGE_SIZE = 15;

    // ── State ──────────────────────────────────────────────
    const [cases,        setCases]        = useState<MappedCase[]>([]);
    const [clients,      setClients]      = useState<MappedClient[]>([]);
    const [lawyers,      setLawyers]      = useState<ProfileRow[]>([]);

    const [casesFilter,  setCasesFilter]  = useState('نشطة');
    const [casesPage,    setCasesPage]    = useState(0);
    const [casesTotal,   setCasesTotal]   = useState(0);
    const [casesLoading, setCasesLoading] = useState(false);
    const [dbError,      setDbError]      = useState<string|null>(null);
    const [casesSearch,  setCasesSearch]  = useState('');

    const [clientsPage,    setClientsPage]    = useState(0);
    const [clientsTotal,   setClientsTotal]   = useState(0);
    const [clientsLoading, setClientsLoading] = useState(false);

    // ⚡ FIX (باگ "الموكل محذوف" غلط — 8 أغسطس 2026): `clients` فوق
    // مقيّدة بالصفحة (PAGE_SIZE=15) وبتتحمّل بالتدريج ("عرض المزيد").
    // أي مكان بيدوّر على موكل معيّن بـ clients.find(id) (تفاصيل القضية،
    // بادچ "موكل محذوف"، دروب-داون الربط...) كان بيفشل غلط لو الموكل
    // موجود فعليًا في قاعدة البيانات لكن لسه مش من ضمن أول 15 المحمّلين
    // محليًا — فبيتعرض كـ"محذوف" مع إنه مش محذوف أصلاً. extraClients
    // كاش منفصل لموكلين اتجابوا بالـ id مباشرة (مش بالصفحة) عشان نسد
    // الفجوة دي من غير ما نلمس عدّاد/ترقيم تاب الموكلين نفسه.
    const [extraClients, setExtraClients] = useState<Record<string, MappedClient>>({});

    const ensureClientsLoaded = useCallback(async (ids: (string | null | undefined)[]) => {
        if (!profile) return;
        const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
        const missing = wanted.filter((id) => !clients.some((c) => c.id === id) && !extraClients[id]);
        if (missing.length === 0) return;

        const { data, error } = await db
            .from('clients')
            .select('*')
            .is('deleted_at', null)
            .in('id', missing);

        if (error) {
            recordError('db_clients_by_id', error.message);
            return;
        }
        const mapped: MappedClient[] = (data || []).map((c: ClientRow) => ({
            ...c,
            full_name: c.client_name || '—',
            type: c.client_type || 'individual',
        }));
        if (mapped.length === 0) return;
        setExtraClients((prev) => {
            const next = { ...prev };
            mapped.forEach((c) => { next[c.id] = c; });
            return next;
        });
    }, [profile, clients, extraClients]);

    // القايمة الموحّدة اللي يستخدمها أي مكان بيدوّر على موكل بالـid
    // (مش بيعرض قايمة مُرقّمة/معدودة) — بديل مباشر لـ`clients` الخام
    // في CaseDetailView/EditCaseModal وأخواتهم.
    const clientsWithExtras = useMemo(() => {
        const extras = Object.values(extraClients).filter((ec) => !clients.some((c) => c.id === ec.id));
        return extras.length ? [...clients, ...extras] : clients;
    }, [clients, extraClients]);

    // ⚡ NEW (فيكس فئة "اليتيم الوهمي" على القضايا — 8 أغسطس 2026): نفس فكرة
    // extraClients/ensureClientsLoaded/clientsWithExtras فوق بالظبط، بس
    // للقضايا. `cases` مقيّدة بالصفحة (PAGE_SIZE=15) *وكمان* بفلتر
    // `casesFilter` — يعني قضية بحالة مختلفة عن الفلتر المفتوح حاليًا
    // (مثلاً قضية مقفولة والفلتر "نشطة") مش هتكون موجودة في `cases` أصلًا
    // حتى لو في الصفحة الأولى. أماكن زي useCaseActions.ts (حساب
    // knownUpdatedAt للقفل التفاؤلي، أو client_id fallback) وuseFeesActions.ts
    // (case_name/case_type snapshot) كانت بتدوّر بـ cases.find(id) على
    // القايمة المحدودة دي مباشرة — casesWithExtras هي البديل الموثوق.
    const [extraCases, setExtraCases] = useState<Record<string, MappedCase>>({});

    const ensureCasesLoaded = useCallback(async (ids: (string | null | undefined)[]) => {
        if (!profile) return;
        const wanted = Array.from(new Set(ids.filter((id): id is string => !!id)));
        const missing = wanted.filter((id) => !cases.some((c) => c.id === id) && !extraCases[id]);
        if (missing.length === 0) return;

        const { data, error } = await db
            .from('cases')
            .select('*')
            .is('deleted_at', null)
            .in('id', missing);

        if (error) {
            recordError('db_cases_by_id', error.message);
            return;
        }
        const rows = (data || []) as CaseRow[];
        if (rows.length === 0) return;

        const caseIds = rows.map((r) => r.id);
        let sessionsMap: { [k: string]: string } = {};
        const { data: sessionsData, error: sessErr } = await db
            .from('case_sessions')
            .select('case_id,session_date')
            .in('case_id', caseIds);
        if (sessErr) recordError('db_sessions_by_case_ids', sessErr.message);
        else sessionsMap = buildNearestSessionMap(sessionsData || []);
        const partiesMap = await fetchPartiesMapByCaseIds(caseIds);

        const mapped = rows.map((r) => mapCaseRow(r, sessionsMap, partiesMap));
        setExtraCases((prev) => {
            const next = { ...prev };
            mapped.forEach((c) => { next[c.id] = c; });
            return next;
        });
    }, [profile, cases, extraCases]);

    // القايمة الموحّدة اللي يستخدمها أي مكان بيدوّر على قضية بالـid
    // (مش بيعرض قايمة مُرقّمة/معدودة أو مفلترة بالحالة) — بديل مباشر
    // لـ`cases` الخام في useCaseActions.ts/useFeesActions.ts وأخواتهم.
    const casesWithExtras = useMemo(() => {
        const extras = Object.values(extraCases).filter((ec) => !cases.some((c) => c.id === ec.id));
        return extras.length ? [...cases, ...extras] : cases;
    }, [cases, extraCases]);

    // ── fetchCases ──────────────────────────────────────────
    const fetchCases = useCallback(async (page = 0, filter = casesFilter) => {
        if (!profile) return;
        setCasesLoading(true);
        setDbError(null);

        const from = page * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        const { data, error, count } = await db
            .from('cases')
            .select('*', { count: 'exact' })
            .eq('status', filter)
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) {
            setDbError('فشل تحميل القضايا — تحقق من الاتصال وأعد المحاولة');
            setCasesLoading(false);
            recordError('db_cases', error.message);
            return;
        }

        // جلب أقرب جلسة للقضايا المحملة فقط
        const caseIds = (data || []).map((r: CaseRow) => r.id);
        let sessionsMap: { [k: string]: string } = {};
        if (caseIds.length > 0) {
            const { data: sessionsData, error: sessErr } = await db
                .from('case_sessions')
                .select('case_id,session_date')
                .in('case_id', caseIds);

            if (sessErr) {
                recordError('db_sessions', sessErr.message);
            } else {
                sessionsMap = buildNearestSessionMap(sessionsData || []);
                recordSuccess('db_sessions');
            }
        }
        // ⚡ B.4: نفس فكرة sessionsMap فوق بالظبط بس لصفوف case_parties —
        // نداء واحد لكل القضايا المحملة في الصفحة دي، مش نداء لكل قضية.
        const partiesMap = await fetchPartiesMapByCaseIds(caseIds);

        // BUG-19: updated_at محتاجينه لـ knownUpdatedAt في handleUpdateCase.
        const mapped: MappedCase[] = (data || []).map((r: CaseRow) => mapCaseRow(r, sessionsMap, partiesMap));

        if (page === 0) setCases(mapped);
        else setCases((prev: MappedCase[]) => [...prev, ...mapped]);

        setCasesTotal(count || 0);
        setCasesPage(page);
        recordSuccess('db_cases');
        setCasesLoading(false);

        // ⚡ FIX (باگ "الموكل محذوف" غلط): نتأكد إن أي موكل مرتبط (أساسي
        // أو طرف) بالقضايا اللي لسه اتحمّلت متاح فعليًا، حتى لو مش من
        // ضمن أول صفحة من تاب الموكلين — بدون ما نستنى المستخدم.
        const referencedClientIds = [
            ...mapped.map((c) => c.client_id),
            ...mapped.flatMap((c) => (c.parties || []).map((p) => p.client_id)),
        ];
        ensureClientsLoaded(referencedClientIds);
    }, [profile, casesFilter, ensureClientsLoaded]);

    // ── searchCases (بحث داخل قسم القضايا كله — مش مقيد بتاب) ──
    const searchCases = useCallback(async (term: string, filter = casesFilter) => {
        if (!profile) return;
        if (!term.trim()) {
            // عند مسح البحث، ارجع للـ listing العادي
            fetchCases(0, filter);
            return;
        }
        setCasesLoading(true);
        setDbError(null);

        const q = term.trim();

        // البحث في: عنوان الدعوى، رقم الدعوى، المدعي، المدعى عليه، موضوع الدعوى — في كل الحالات
        // FIX: فاصلة أو قوس في نص البحث كان بيكسر صياغة فلتر .or()
        const { data, error, count } = await db
            .from('cases')
            .select('*', { count: 'exact' })
            .is('deleted_at', null)
            .or([
                ilikeOrClause('title', q),
                ilikeOrClause('case_number_official', q),
            ].join(','))
            .order('created_at', { ascending: false })
            .limit(50);

        if (error) {
            setDbError('فشل البحث في القضايا — تحقق من الاتصال وأعد المحاولة');
            setCasesLoading(false);
            recordError('db_cases_search', error.message);
            return;
        }

        // جلب جلسات للنتائج
        const caseIds = (data || []).map((r: CaseRow) => r.id);
        let sessionsMap: { [k: string]: string } = {};
        if (caseIds.length > 0) {
            const { data: sessionsData } = await db
                .from('case_sessions')
                .select('case_id,session_date')
                .in('case_id', caseIds);
            sessionsMap = buildNearestSessionMap(sessionsData || []);
        }
        // ⚡ B.4: نفس المنطق اللي في fetchCases فوق.
        const partiesMap = await fetchPartiesMapByCaseIds(caseIds);

        const mapped: MappedCase[] = (data || []).map((r: CaseRow) => mapCaseRow(r, sessionsMap, partiesMap));

        setCases(mapped);
        setCasesTotal(count || 0);
        setCasesPage(0);
        recordSuccess('db_cases_search');
        setCasesLoading(false);

        // نفس فيكس fetchCases فوق — نتائج البحث ممكن كمان تشاور على
        // موكلين مش محمّلين في الصفحة الحالية من تاب الموكلين.
        const referencedClientIds = [
            ...mapped.map((c) => c.client_id),
            ...mapped.flatMap((c) => (c.parties || []).map((p) => p.client_id)),
        ];
        ensureClientsLoaded(referencedClientIds);
    }, [profile, casesFilter, fetchCases, ensureClientsLoaded]);

    const fetchLawyers = useCallback(async () => {
        if (!isAdmin) return;
        const { data } = await db
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: true });
        setLawyers(data || []);
    }, [isAdmin]);

    // ── fetchClients ────────────────────────────────────────
    const fetchClients = useCallback(async (page = 0, search = '') => {
        if (!profile) return;
        setClientsLoading(true);

        const from = page * PAGE_SIZE;
        const to   = from + PAGE_SIZE - 1;

        let query = db
            .from('clients')
            .select('*', { count: 'exact' })
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (search.trim()) {
            const s = search.trim();
            // FIX: فاصلة أو قوس في نص البحث كان بيكسر صياغة فلتر .or()
            query = query.or([
                ilikeOrClause('client_name', s),
                ilikeOrClause('phone', s),
                ilikeOrClause('national_id', s),
            ].join(','));
        }

        const { data, error, count } = await query;

        if (error) {
            recordError('db_clients', error.message);
        } else {
            const mapped: MappedClient[] = (data || []).map((c: ClientRow) => ({
                ...c,
                full_name: c.client_name || '—',
                type: c.client_type || 'individual',
            }));
            if (page === 0) setClients(mapped);
            else setClients((prev: MappedClient[]) => [...prev, ...mapped]);
            setClientsTotal(count || 0);
            setClientsPage(page);
            recordSuccess('db_clients');
        }
        setClientsLoading(false);
    }, [profile]);

    return {
        cases,       setCases,
        casesFilter, setCasesFilter,
        casesPage,   setCasesPage,   casesTotal,   casesLoading,
        casesSearch, setCasesSearch,
        dbError,
        clients,     setClients,
        clientsPage, setClientsPage, clientsTotal, clientsLoading,
        // ⚡ FIX (باگ "الموكل محذوف" غلط): clientsWithExtras = clients +
        // أي موكل اتجاب بالـid مباشرة عبر ensureClientsLoaded — استخدمها
        // في أي مكان بيدوّر على موكل بعينه (تفاصيل قضية، بادچات orphan)
        // بدل `clients` الخام لو مش عارض قايمة مُرقّمة.
        clientsWithExtras, ensureClientsLoaded,
        // ⚡ NEW: casesWithExtras = cases + أي قضية اتجابت بالـid مباشرة عبر
        // ensureCasesLoaded — استخدمها في أي مكان بيدوّر على قضية بعينها
        // (knownUpdatedAt، client_id fallback، case_name/case_type snapshot)
        // بدل `cases` الخام المقيّدة بالصفحة والفلتر.
        casesWithExtras, ensureCasesLoaded,
        lawyers,     setLawyers,
        fetchCases,  fetchLawyers,   fetchClients,  searchCases,
    };
}
