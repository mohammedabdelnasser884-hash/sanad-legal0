import { useState, useCallback } from 'react';
import { db } from '../../supabaseClient';
import { getCurrentTenantId } from '../../constants';
import { createFetchGuard } from '../lib/offlineGuard';
import { toast } from '../lib/notifications';
import type { ProfileRow, ReminderRow } from '../../types';

// شكل بيانات القضية المدمجة (embed) جوه استعلام case_sessions — نفس الأعمدة
// المطلوبة فعليًا في select الأربعة تحت (`cases(id,title,plaintiff,defendant,court_name,case_type,case_number_official,client_id)`).
export interface SessionCaseEmbed {
    id: string;
    title: string | null;
    court_name: string | null;
    case_type: string | null;
    case_number_official: string | null;
    client_id: string | null;
}

// شكل صف الجلسة اللي بيترجع من select الأربعة — الأعمدة المطلوبة من case_sessions
// بالإضافة للعلاقة المدمجة `cases`. الشكل (كائن واحد أو مصفوفة) مش موحّد دايمًا
// من Supabase حسب نوع العلاقة، فالنوع بيسمح بالاتنين زي ما DashboardTab.tsx بيتعامل معاه فعليًا.
export interface SessionFeedItem {
    id: string;
    session_date: string | null;
    session_time: string | null;
    session_floor: string | null;
    session_hall: string | null;
    description: string | null;
    case_id: string | null;
    // ⚡ FIX: client_id بتاع الجلسة نفسها (ربط مباشر بموكل من غير قضية،
    // المسار التالت في useSessionLinking.ts) — كان ناقص من هنا، فكانت
    // شارة "👤 الموكل" أبدًا ما بتظهرش لهذا النوع من الجلسات.
    client_id: string | null;
    result: string | null;
    next_action: string | null;
    title: string | null;
    case_number: string | null;
    court: string | null;
    case_type: string | null;
    circuit_number: string | null;
    cases: SessionCaseEmbed | SessionCaseEmbed[] | null;
}

// شكل صف المهمة (reminder) اللي بيترجع من select('id,title,due_date,notes,done')
export type TaskFeedItem = Pick<ReminderRow, 'id' | 'title' | 'due_date' | 'notes' | 'done'>;

// ─────────────────────────────────────────────────────────
//  ⚡ NEW (فيكس "تأخير محسوس عند التنقل أوف لاين، جزء 4" — 9 أغسطس 2026):
//  الملف ده (بيغذّي تاب الداشبورد نفسه — أرجح تاب بيتفتح) مكنش عنده أي
//  حماية خالص، ولا حتى كاش fallback زي useAppData.ts/useRemindersTab.ts/
//  CalendarTab.tsx — أوف لاين كان معناه شاشة فاضية بصمت (مفيش حتى بانر
//  خطأ). بنضيف هنا نفس نمط الحماية (offlineGuard) + كاش بسيط لكل قائمة
//  من القوائم الأربعة.
// ─────────────────────────────────────────────────────────
const DASHBOARD_CACHE_KEY = 'sanad_cached_dashboard_feed_v1';

interface DashboardCache {
    tenantId: string | null;
    todaySessions?: SessionFeedItem[];
    upcomingSessions?: SessionFeedItem[];
    missedSessions?: SessionFeedItem[];
    upcomingTasks?: TaskFeedItem[];
    missedTasks?: TaskFeedItem[];
}

function loadDashboardCache(): DashboardCache | null {
    try {
        const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as DashboardCache;
        if (parsed.tenantId !== getCurrentTenantId()) return null;
        return parsed;
    } catch {
        return null;
    }
}

function saveDashboardCache(patch: Partial<DashboardCache>) {
    try {
        const current = loadDashboardCache() || { tenantId: getCurrentTenantId() };
        localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ ...current, tenantId: getCurrentTenantId(), ...patch }));
    } catch { /* localStorage غير متاح — تجاهل */ }
}

export function useDashboardFeed(profile: ProfileRow | null) {
    const [todaySessions,    setTodaySessions]    = useState<SessionFeedItem[]>([]);  // جلسات اليوم فقط
    const [upcomingSessions, setUpcomingSessions] = useState<SessionFeedItem[]>([]);  // بكره + 6 أيام
    const [missedSessions,   setMissedSessions]   = useState<SessionFeedItem[]>([]);  // فائتة بدون تحديث
    const [loadingUrgent,    setLoadingUrgent]    = useState(false);

    // ── المهام (reminders) ──
    const [upcomingTasks,     setUpcomingTasks]     = useState<TaskFeedItem[]>([]); // due_date >= اليوم، غير منجزة
    const [missedTasks,       setMissedTasks]       = useState<TaskFeedItem[]>([]); // due_date < اليوم، غير منجزة
    const [upcomingTasksOpen, setUpcomingTasksOpen] = useState(false); // مقفولة افتراضيًا — تقليل الزحمة
    // 🔒 FIX (تشخيص لوجز E2E — 29 يوليو 2026): كانت false زي upcomingOpen
    // ("تقليل الزحمة")، بس ده كان بيخفي جلسات اليوم بالكامل (dashboard-session-card
    // مش بيتعرض إلا لو todayOpen=true — راجع DashboardTab.tsx) لحد ما
    // المستخدم يضغط زرار التبديل يدويًا. بطاقة "اليوم" هي الوحيدة اللي
    // فيها مؤشر عاجل (نقطة حمرا نابضة + عداد) وده معناها المفروض تكون
    // ظاهرة فورًا، بعكس "القادم" (أقل إلحاحًا، تقليل الزحمة منطقي ليها).
    const [todayOpen,         setTodayOpen]         = useState(true);
    const [upcomingOpen,      setUpcomingOpen]      = useState(false); // مقفولة افتراضيًا — تقليل الزحمة

    // ── ملاحظة: فحص dbOnline + الـ event listeners موجودين في App.tsx فقط ──
    // تم حذف النسخة المكررة من هنا لتجنب إرسال طلبين لـ Supabase كل 30 ثانية
    // وتجنب تراكم event listeners على window

    // ── helper: date formatter ──
    const fmtDate = (d: Date) =>
        d.getFullYear() + '-' +
        String(d.getMonth() + 1).padStart(2, '0') + '-' +
        String(d.getDate()).padStart(2, '0');

    // ── جلب جلسات اليوم ──
    const fetchTodaySessions = useCallback(async () => {
        if (!profile) return;
        setLoadingUrgent(true);
        const todayStr = fmtDate(new Date());
        const guard = createFetchGuard();
        let data: SessionFeedItem[] | null = null;
        let error: { message: string } | null = null;
        if (guard.offline) {
            error = { message: 'offline' };
        } else {
            try {
                const res = await db.from('case_sessions')
                    .select('id, session_date, session_time, session_floor, session_hall, description, case_id, client_id, result, next_action, title, case_number, court, case_type, circuit_number, cases(id,title,court_name,case_type,case_number_official,client_id)')
                    .eq('session_date', todayStr)
                    .order('session_date', { ascending: true })
                    .abortSignal(guard.controller.signal);
                data = res.data;
                error = res.error;
            } catch (err) {
                error = { message: guard.didTimeOut() ? 'timeout' : (err as { message?: string })?.message || 'fetch failed' };
            } finally {
                guard.cleanup();
            }
        }
        if (error) {
            // 🔒 FIX (تشخيص لوجز E2E — 30 يوليو 2026): كان بيتجاهل error تمامًا —
            // أي فشل حقيقي في الاستعلام كان بيرجّع قائمة فاضية بصمت من غير أي أثر
            // في الكونسول. دلوقتي كمان بنجرّب الكاش قبل ما نسيب القائمة فاضية.
            const cached = loadDashboardCache();
            if (cached?.todaySessions) {
                setTodaySessions(cached.todaySessions);
                if (guard.offline) toast('أنت أوف لاين — بتشوف آخر نسخة محفوظة من جلسات اليوم');
            } else {
                console.error('[Dashboard] فشل تحميل جلسات اليوم:', error.message);
                setTodaySessions([]);
            }
            setLoadingUrgent(false);
            return;
        }
        setTodaySessions(data || []);
        saveDashboardCache({ todaySessions: data || [] });
        setLoadingUrgent(false);
    }, [profile]);

    // ── جلب جلسات الأسبوع القادم (بكره + 6 أيام) ──
    const fetchUpcomingSessions = useCallback(async () => {
        if (!profile) return;
        const today    = new Date();
        const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
        const endDay   = new Date(today); endDay.setDate(today.getDate() + 7);
        const guard = createFetchGuard();
        let data: SessionFeedItem[] | null = null;
        let error: { message: string } | null = null;
        if (guard.offline) {
            error = { message: 'offline' };
        } else {
            try {
                const res = await db.from('case_sessions')
                    .select('id, session_date, session_time, session_floor, session_hall, description, case_id, client_id, result, next_action, title, case_number, court, case_type, circuit_number, cases(id,title,court_name,case_type,case_number_official,client_id)')
                    .gte('session_date', fmtDate(tomorrow))
                    .lte('session_date', fmtDate(endDay))
                    .order('session_date', { ascending: true })
                    .abortSignal(guard.controller.signal);
                data = res.data;
                error = res.error;
            } catch (err) {
                error = { message: guard.didTimeOut() ? 'timeout' : (err as { message?: string })?.message || 'fetch failed' };
            } finally {
                guard.cleanup();
            }
        }
        if (error) {
            const cached = loadDashboardCache();
            if (cached?.upcomingSessions) {
                setUpcomingSessions(cached.upcomingSessions);
                if (guard.offline) toast('أنت أوف لاين — بتشوف آخر نسخة محفوظة من جلسات الأسبوع القادم');
            } else {
                console.error('[Dashboard] فشل تحميل جلسات الأسبوع القادم:', error.message);
                setUpcomingSessions([]);
            }
            return;
        }
        setUpcomingSessions(data || []);
        saveDashboardCache({ upcomingSessions: data || [] });
    }, [profile]);

    // ── جلب الجلسات الفائتة ──
    // جلسة فائتة = آخر جلسة في قضيتها وتاريخها قبل اليوم ومافيش جلسة جديدة مجدولة بعدها
    // ⚠️ الإصلاح: أزلنا limit(200) اللي كانت تفوّت قضايا قديمة — دلوقتي بنجيب
    //    أحدث جلسة لكل قضية عبر فلترة server-side أدق
    const fetchMissedSessions = useCallback(async () => {
        if (!profile) return;
        const todayStr = fmtDate(new Date());
        const guard = createFetchGuard();
        let futureData: Array<{ case_id: string | null }> | null = null;
        let pastData: SessionFeedItem[] | null = null;
        let error: { message: string } | null = null;
        if (guard.offline) {
            error = { message: 'offline' };
        } else {
            try {
                // 1. كل الـ case_ids اللي عندها جلسة مستقبلية (اليوم أو بعده)
                // 2. جيب أحدث جلسة فائتة لكل قضية (بدون limit — RLS بتحمي الحجم)
                const [futureRes, pastRes] = await Promise.all([
                    db.from('case_sessions')
                      .select('case_id')
                      .gte('session_date', todayStr)
                      .abortSignal(guard.controller.signal),
                    db.from('case_sessions')
                      .select('id, session_date, session_time, session_floor, session_hall, description, case_id, client_id, result, next_action, title, case_number, court, case_type, circuit_number, cases(id,title,court_name,case_type,case_number_official,client_id)')
                      .lt('session_date', todayStr)
                      .order('session_date', { ascending: false })
                      .abortSignal(guard.controller.signal),
                ]);
                futureData = futureRes.data;
                pastData = pastRes.data;
                error = pastRes.error || futureRes.error || null;
            } catch (err) {
                error = { message: guard.didTimeOut() ? 'timeout' : (err as { message?: string })?.message || 'fetch failed' };
            } finally {
                guard.cleanup();
            }
        }
        if (error) {
            const cached = loadDashboardCache();
            if (cached?.missedSessions) {
                setMissedSessions(cached.missedSessions);
                if (guard.offline) toast('أنت أوف لاين — بتشوف آخر نسخة محفوظة من الجلسات الفائتة');
            } else {
                console.error('[Dashboard] فشل تحميل الجلسات الفائتة:', error.message);
                setMissedSessions([]);
            }
            return;
        }

        // 3. فلتر: قضايا مفيهاش جلسة مستقبلية + خد جلسة واحدة (الأحدث) لكل قضية
        const caseIdsWithFuture = new Set((futureData || []).map((s: { case_id: string | null }) => s.case_id));
        const seenCases = new Set();
        const uniqueMissed = (pastData || []).filter((s: SessionFeedItem) => {
            if (caseIdsWithFuture.has(s.case_id)) return false;
            if (seenCases.has(s.case_id)) return false;
            seenCases.add(s.case_id);
            return true;
        });
        setMissedSessions(uniqueMissed);
        saveDashboardCache({ missedSessions: uniqueMissed });
    }, [profile]);

    // ── جلب المهام ──
    const fetchTasks = useCallback(async () => {
        if (!profile) return;
        const todayStr = fmtDate(new Date());
        const guard = createFetchGuard();
        let data: TaskFeedItem[] | null = null;
        let error: { message: string } | null = null;
        if (guard.offline) {
            error = { message: 'offline' };
        } else {
            try {
                const res = await db.from('reminders')
                    .select('id,title,due_date,notes,done')
                    .eq('done', false)
                    .order('due_date', { ascending: true })
                    .abortSignal(guard.controller.signal);
                data = res.data;
                error = res.error;
            } catch (err) {
                error = { message: guard.didTimeOut() ? 'timeout' : (err as { message?: string })?.message || 'fetch failed' };
            } finally {
                guard.cleanup();
            }
        }
        if (error) {
            const cached = loadDashboardCache();
            if (cached?.upcomingTasks || cached?.missedTasks) {
                setUpcomingTasks(cached.upcomingTasks || []);
                setMissedTasks(cached.missedTasks || []);
            }
            return;
        }
        const all = data || [];
        const upcoming = all.filter((r: TaskFeedItem) => (r.due_date as string) >= todayStr);
        const missed   = all.filter((r: TaskFeedItem) => (r.due_date as string) < todayStr);
        setUpcomingTasks(upcoming);
        setMissedTasks(missed);
        saveDashboardCache({ upcomingTasks: upcoming, missedTasks: missed });
    }, [profile]);

    return {
        todaySessions,    setTodaySessions,
        upcomingSessions, setUpcomingSessions,
        missedSessions,   setMissedSessions,
        upcomingTasks,    setUpcomingTasks,
        missedTasks,      setMissedTasks,
        loadingUrgent,
        upcomingTasksOpen, setUpcomingTasksOpen,
        todayOpen,         setTodayOpen,
        upcomingOpen,      setUpcomingOpen,
        fetchTodaySessions, fetchUpcomingSessions, fetchMissedSessions, fetchTasks,
    };
}
