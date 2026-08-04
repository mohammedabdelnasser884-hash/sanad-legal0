import React, { useState, useEffect, useRef } from 'react';
import { db } from '../../../supabaseClient';
import { toast } from '../../../shared/lib/notifications';
import { exportSessionToGoogleCalendar } from '@/shared/ui/calendarExport';
import { MONTHS_AR2, DAYS_FULL, toDateStr } from './constants';
import SessionCard from './SessionCard';
import UpcomingWidget from './UpcomingWidget';
import type { MappedCase, MappedClient } from '../../../hooks/useAppData';
import type { SessionCaseEmbed } from '@/shared/hooks/useDashboardFeed';

// شكل صف الجلسة اللي بيترجع من استعلامي `case_sessions` في الملف ده (نفس
// الأعمدة المطلوبة فعليًا في الـ .select() بالضبط، بالإضافة للعلاقة المدمجة
// `cases` بنفس شكل SessionCaseEmbed المستخدم في useDashboardFeed.ts).
export interface CalendarSessionRow {
    id: string;
    session_date: string | null;
    case_id: string | null;
    // ⚡ FIX: client_id بتاع الجلسة نفسها — كان ناقص، فشارة "👤 الموكل" ما
    // كانتش بتظهر للجلسات المربوطة مباشرة بموكل من غير قضية.
    client_id: string | null;
    description: string | null;
    result: string | null;
    next_action: string | null;
    session_time: string | null;
    session_floor: string | null;
    session_hall: string | null;
    title: string | null;
    case_number: string | null;
    court: string | null;
    case_type: string | null;
    plaintiff: string | null;
    defendant: string | null;
    circuit_number: string | null;
    plaintiff_role: string | null;
    defendant_role: string | null;
    // ⚡ NEW (24 يوليو، خطة سد فجوات عرض الأطراف — مرحلة 2): موجودان بالفعل
    // على case_sessions من تقرير المسمى القانوني (للجلسات المستقلة).
    plaintiff_legal_title: string | null;
    defendant_legal_title: string | null;
    cases: SessionCaseEmbed | SessionCaseEmbed[] | null;
}

interface CalendarTabProps {
    cases: MappedCase[];
    clients: MappedClient[];
    onOpenCase: (c: MappedCase) => void;
    onOpenStandalone: (s: CalendarSessionRow) => void;
    // ⚡ [جديد] بيتغيّر كل ما إجراء يحصل على جلسة (ربط/تعديل/حذف/تحديث) من
    // موديل StandaloneSessionDetailModal — إضافته في dependency array بتاع
    // useEffect تحت بتجبر إعادة جلب allSessions، عشان case_id المحدّث
    // (بعد إنشاء قضية من الزرار "🔗 ربط" مثلاً) يوصل فورًا من غير ما
    // المستخدم يغيّر الشهر أو يبدّل تاب يدوي.
    refreshKey?: number;
}

function CalendarTab({ cases, clients, onOpenCase, onOpenStandalone, refreshKey }: CalendarTabProps) {
    const today = new Date();
    const [viewYear,  setViewYear]  = useState(today.getFullYear());
    const [viewMonth, setViewMonth] = useState(today.getMonth());
    const [allSessions, setAllSessions] = useState<CalendarSessionRow[]>([]);
    const [loading, setLoading]         = useState(true);
    const [selectedDay, setSelectedDay] = useState<number|null>(null);

    const todayStr = toDateStr(today);

    const YEARS = Array.from({ length: 21 }, (_: unknown, i: number) => 2020 + i); // 2020 → 2040

    // 🔒 FIX (تحليل لوجز E2E — 30 يوليو 2026): كان useEffect بيقفل الأكورديون
    // (setSelectedDay(null)) في كل مرة يعيد فيها الجلب، حتى لو السبب كان
    // refreshKey بس (تعديل/ربط/حذف جلسة في نفس اليوم المفتوح بالفعل) —
    // مش تنقل حقيقي بين الشهور. ده كان بيخلي أي عملية على جلسة (زي حفظ
    // تعديل) تقفل اليوم المفتوح فورًا، فاليوزر (والتستات) محتاجين يدوسوا
    // على اليوم تاني عشان يشوفوا النتيجة — وده كمان سباق تايمنج حقيقي:
    // لو دوسة "افتح اليوم" التانية حصلت قبل ما الـfetch يخلص، بتتلغي
    // (toggle) بدل ما تفتح. دلوقتي بنسيب selectedDay زي ما هو لو التغيير
    // كان بسبب refreshKey بس، ونصفّره بس لما فعليًا الشهر/السنة يتغيّروا.
    const prevMonthYear = useRef({ viewYear, viewMonth });

    useEffect(() => {
        setLoading(true);
        const isMonthNavigation =
            prevMonthYear.current.viewYear !== viewYear || prevMonthYear.current.viewMonth !== viewMonth;
        prevMonthYear.current = { viewYear, viewMonth };
        const mm   = String(viewMonth+1).padStart(2,'0');
        const last = new Date(viewYear, viewMonth+1, 0).getDate();
        db.from('case_sessions')
          .select('id,session_date,case_id,client_id,description,result,next_action,session_time,session_floor,session_hall,title,case_number,court,case_type,plaintiff,defendant,circuit_number,plaintiff_role,defendant_role,plaintiff_legal_title,defendant_legal_title,cases(id,title,plaintiff,defendant,plaintiff_legal_title,defendant_legal_title,court_name,case_type,case_number_official,client_id)')
          .gte('session_date', `${viewYear}-${mm}-01`)
          .lte('session_date', `${viewYear}-${mm}-${String(last).padStart(2,'0')}`)
          .then(({ data }) => {
              setAllSessions((data || []) as unknown as CalendarSessionRow[]);
              setLoading(false);
              if (isMonthNavigation) setSelectedDay(null);
          });
    }, [viewYear, viewMonth, refreshKey]);

    const firstDay  = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMon = new Date(viewYear, viewMonth+1, 0).getDate();

    const sessionsMap: Record<string, CalendarSessionRow[]> = {};
    allSessions.forEach((s: CalendarSessionRow) => {
        const key = s.session_date as string;
        if (!sessionsMap[key]) sessionsMap[key] = [];
        sessionsMap[key].push(s);
    });
    // ⚡ CHANGED (ملاحظة شكلية — 4 أغسطس 2026): شلنا مفهوم "⚠️ تعارض" (يوم فيه
    // أكتر من جلسة) بالكامل من الواجهة — كان بيتحول لحدّ أحمر حول اليوم +
    // نقطة حمراء + badge تحذيري، وده كان بيدّي إحساس إن في مشكلة حقيقية
    // بالرغم من إن أكتر من جلسة في نفس اليوم أمر طبيعي تمامًا وملوش أي دلالة
    // سلبية. عدد الجلسات (badge العادي جنب اسم اليوم، والنقط الذهبية تحت
    // الرقم في الشبكة) لسه ظاهر عادي زي أي يوم تاني — بس من غير أي تلوين
    // تحذيري.

    const selectedDateStr = selectedDay
        ? `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(selectedDay).padStart(2,'0')}`
        : null;
    const daysSessions = selectedDateStr ? (sessionsMap[selectedDateStr]||[]) : [];

    const handleExportToGoogle = (s: CalendarSessionRow, e: React.MouseEvent) => {
        e.stopPropagation();
        const lc = cases.find((c: MappedCase) => c.id === s.case_id);
        const lcl = lc
            ? clients.find((cl: MappedClient) => cl.id === lc.client_id)
            : (s.client_id ? clients.find((cl: MappedClient) => cl.id === s.client_id) : null);
        exportSessionToGoogleCalendar(s, lc?.title||'جلسة قانونية', lc?.court||'', lcl?.full_name||'');
        toast('🗓 جاري الفتح في Google Calendar...');
    };

    return React.createElement('div', { className: "space-y-2 fade-in" },

        // ── هيدر: فلتر السنة والشهر + أيقونة تقويم ──
        React.createElement('div', { className: "flex items-center gap-2" },
            // dropdown الشهر
            React.createElement('select', {
                value: viewMonth,
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { setViewMonth(Number(e.target.value)); setSelectedDay(null); },
                className: "flex-1 text-[10px] font-black rounded-xl px-2 py-2 border",
                style: { background: '#0a1220', borderColor: 'rgba(255,255,255,0.1)', color: '#D4AF37' }
            }, MONTHS_AR2.map((m: string, i: number) => React.createElement('option', { key: i, value: i }, m))),
            // dropdown السنة
            React.createElement('select', {
                value: viewYear,
                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { setViewYear(Number(e.target.value)); setSelectedDay(null); },
                className: "text-[10px] font-black rounded-xl px-2 py-2 border",
                style: { background: '#0a1220', borderColor: 'rgba(255,255,255,0.1)', color: '#D4AF37', minWidth: '68px' }
            }, YEARS.map((y: number) => React.createElement('option', { key: y, value: y }, y))),
            // أيقونة الربط بتقويم الهاتف
            React.createElement('button', {
                onClick: () => {
                    db.from('case_sessions').select('id,session_date,case_id,client_id,description,result,next_action,title,case_number,court,case_type,plaintiff,defendant,cases(id,title,plaintiff,defendant,plaintiff_legal_title,defendant_legal_title,court_name,case_type,case_number_official,client_id)')
                      .then(({ data }) => {
                          const sessions = (data || []) as unknown as CalendarSessionRow[];
                          if (!sessions.length) { toast('لا توجد جلسات', true); return; }
                          const up = sessions.filter((s: CalendarSessionRow) => (s.session_date as string) >= todayStr).sort((a: CalendarSessionRow,b: CalendarSessionRow) => (a.session_date as string).localeCompare(b.session_date as string));
                          if (!up.length) { toast('لا توجد جلسات قادمة', true); return; }
                          const lc = cases.find((c: MappedCase) => c.id === up[0].case_id);
                          const lcl = lc
                              ? clients.find((cl: MappedClient) => cl.id === lc.client_id)
                              : (up[0].client_id ? clients.find((cl: MappedClient) => cl.id === up[0].client_id) : null);
                          exportSessionToGoogleCalendar(up[0], lc?.title||'جلسة', lc?.court||'', lcl?.full_name||'');
                          toast('🗓 تم فتح أقرب جلسة في Google Calendar');
                      });
                },
                title: "أضف أقرب جلسة لتقويم الهاتف",
                className: "w-9 h-9 shrink-0 flex items-center justify-center rounded-xl text-base active:scale-90 transition-all",
                style: { background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', color: '#4ade80' }
            }, "🗓")
        ),

        // عدد الجلسات
        React.createElement('p', { className: "text-[9px] text-slate-500 px-1" },
            loading ? "جاري التحميل..." : `${allSessions.length} جلسة — ${MONTHS_AR2[viewMonth]} ${viewYear}`
        ),

        // شبكة التقويم
        React.createElement('div', { className: "bg-premium-card border border-white/5 rounded-2xl overflow-hidden shadow-premium-shadow" },
            React.createElement('div', { className: "grid grid-cols-7 border-b border-white/5" },
                DAYS_FULL.map((d: string) => React.createElement('div', { key: d, className: "py-2 text-center text-[8px] font-black text-slate-500" }, d))
            ),
            React.createElement('div', { className: "grid grid-cols-7" },
                Array.from({ length: firstDay }).map((_: unknown,i: number) => React.createElement('div', { key:'e'+i, className:"aspect-square" })),
                Array.from({ length: daysInMon }, (_: unknown,i: number) => i+1).map((d: number) => {
                    const dStr = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
                    const hasSess    = sessionsMap[dStr]?.length > 0;
                    const isToday    = dStr === todayStr;
                    const isSel      = selectedDay === d;
                    return React.createElement('button', {
                        key: d, onClick: () => setSelectedDay(isSel ? null : d),
                        'data-testid': 'calendar-day',
                        className: `relative aspect-square flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90 ${isSel?'bg-premium-gold/15':'hover:bg-white/5'}`
                    },
                        React.createElement('span', { className: `text-[11px] font-black ${isToday?'text-premium-gold':isSel?'text-premium-gold':'text-slate-300'}` }, d),
                        hasSess && React.createElement('div', { className: "flex gap-0.5 justify-center" },
                            sessionsMap[dStr].slice(0,3).map((_: CalendarSessionRow,i: number) =>
                                React.createElement('div', { key:i, className:"w-1 h-1 rounded-full bg-premium-gold" })
                            )
                        ),
                        isToday && !hasSess && React.createElement('div', { className: "w-1 h-1 rounded-full bg-premium-gold/50" })
                    );
                })
            )
        ),

        // تفاصيل اليوم المختار
        selectedDay && React.createElement('div', { className: "space-y-2 fade-in" },
            React.createElement('div', { className: "flex items-center gap-2 px-1" },
                React.createElement('span', { className: "w-1 h-3 bg-premium-gold rounded-full" }),
                React.createElement('p', { className: "text-xs font-black text-white" }, `جلسات ${selectedDay} ${MONTHS_AR2[viewMonth]} ${viewYear}`),
                React.createElement('span', { className: "text-[9px] text-slate-500" }, `${daysSessions.length} جلسة`)
            ),
            daysSessions.length === 0
                ? React.createElement('div', { className: "bg-premium-card border border-white/5 rounded-xl p-4 text-center text-slate-500 text-xs" }, "لا توجد جلسات في هذا اليوم")
                : daysSessions.map((s: CalendarSessionRow) =>
                    React.createElement(SessionCard, { key: s.id, s, cases, clients, onOpenCase, onOpenStandalone, onGoogleExport: handleExportToGoogle })
                )
        )
    );
}

export default CalendarTab;
