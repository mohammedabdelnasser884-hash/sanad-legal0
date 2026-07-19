import React, { useState, useEffect } from 'react';
import { db } from '../../supabaseClient';
import { toDateStr } from '../calendar/sessions-calendar/constants';
import { LoadingState, ErrorState, SummaryBanner, SectionCard, CopyButton } from '../../shared/ui/TaskResultKit';
import type { MappedCase } from '../../hooks/useAppData';

// ─────────────────────────────────────────────────────────
//  SessionsRemindersOverview — المرحلة 1 من خطة المساعد الذكي
//  ("عرض الجلسات والتذكيرات القادمة/المتأخرة"، sanad-ai-assistant-plan-7.md، قسم 4.1).
//  Rule-based بالكامل — صفر استدعاء AI. استعلام مباشر من الداتابيز
//  زي نفس نمط UpcomingWidget.tsx الموجود، بدون الاعتماد على props
//  جاهزة من الأب عشان يفضل مكوّن مستقل قابل لإعادة الاستخدام.
// ─────────────────────────────────────────────────────────

interface OverviewSessionRow {
  id: string;
  session_date: string | null;
  result: string | null;
  case_id: string | null;
  case_number: string | null;
  court: string | null;
}

interface OverviewReminderRow {
  id: string;
  title: string | null;
  due_date: string | null;
  done: boolean | null;
}

interface SessionsRemindersOverviewProps {
  cases: MappedCase[];
  onOpenCase?: (c: MappedCase) => void;
}

function relativeDayLabel(dateStr: string, todayStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');
  const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'اليوم';
  if (diffDays === 1) return 'بكرة';
  if (diffDays === -1) return 'إمبارح';
  if (diffDays > 1) return `بعد ${diffDays} يوم`;
  return `من ${Math.abs(diffDays)} يوم`;
}

function buildOverviewSummaryText(
  cases: MappedCase[],
  pastSessionsNoResult: OverviewSessionRow[],
  overdueReminders: OverviewReminderRow[],
  upcomingSessions: OverviewSessionRow[],
  upcomingReminders: OverviewReminderRow[],
  todayStr: string
): string {
  const findCase = (caseId: string | null) => cases.find((c) => c.id === caseId) || null;
  const lines: string[] = ['ملخص الجلسات والتذكيرات:', ''];

  if (pastSessionsNoResult.length > 0) {
    lines.push('جلسات فاتت من غير نتيجة مسجّلة:');
    pastSessionsNoResult.forEach((s) => {
      const c = findCase(s.case_id);
      lines.push(`- ${c?.title || s.case_number || 'قضية غير مرتبطة'} (${s.session_date ? relativeDayLabel(s.session_date, todayStr) : '—'})`);
    });
    lines.push('');
  }

  if (overdueReminders.length > 0) {
    lines.push('تذكيرات متأخرة:');
    overdueReminders.forEach((r) => {
      lines.push(`- ${r.title || '—'} (${r.due_date ? relativeDayLabel(r.due_date, todayStr) : '—'})`);
    });
    lines.push('');
  }

  lines.push('الجلسات القادمة:');
  if (upcomingSessions.length === 0) {
    lines.push('- مفيش جلسات قادمة مسجّلة');
  } else {
    upcomingSessions.forEach((s) => {
      const c = findCase(s.case_id);
      lines.push(`- ${c?.title || s.case_number || 'قضية غير مرتبطة'} (${s.session_date ? relativeDayLabel(s.session_date, todayStr) : '—'})`);
    });
  }
  lines.push('');

  lines.push('التذكيرات القادمة:');
  if (upcomingReminders.length === 0) {
    lines.push('- مفيش تذكيرات قادمة');
  } else {
    upcomingReminders.forEach((r) => {
      lines.push(`- ${r.title || '—'} (${r.due_date ? relativeDayLabel(r.due_date, todayStr) : '—'})`);
    });
  }

  return lines.join('\n');
}

function SessionsRemindersOverview({ cases, onOpenCase }: SessionsRemindersOverviewProps) {
  const [loading, setLoading] = useState(true);
  const [upcomingSessions, setUpcomingSessions] = useState<OverviewSessionRow[]>([]);
  const [pastSessionsNoResult, setPastSessionsNoResult] = useState<OverviewSessionRow[]>([]);
  const [overdueReminders, setOverdueReminders] = useState<OverviewReminderRow[]>([]);
  const [upcomingReminders, setUpcomingReminders] = useState<OverviewReminderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const todayStr = toDateStr(new Date());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      db.from('case_sessions')
        .select('id,session_date,result,case_id,case_number,court')
        .gte('session_date', todayStr)
        .order('session_date', { ascending: true })
        .limit(20),
      // جلسات فاتت من غير تسجيل نتيجة — إشارة عملية حقيقية إن فيه متابعة ناقصة
      db.from('case_sessions')
        .select('id,session_date,result,case_id,case_number,court')
        .lt('session_date', todayStr)
        .or('result.is.null,result.eq.')
        .order('session_date', { ascending: false })
        .limit(20),
      db.from('reminders')
        .select('id,title,due_date,done')
        .lt('due_date', todayStr)
        .eq('done', false)
        .order('due_date', { ascending: false })
        .limit(20),
      db.from('reminders')
        .select('id,title,due_date,done')
        .gte('due_date', todayStr)
        .eq('done', false)
        .order('due_date', { ascending: true })
        .limit(20),
    ]).then(([sessRes, pastRes, overdueRes, upRes]) => {
      if (cancelled) return;
      setUpcomingSessions((sessRes.data || []) as unknown as OverviewSessionRow[]);
      setPastSessionsNoResult((pastRes.data || []) as unknown as OverviewSessionRow[]);
      setOverdueReminders((overdueRes.data || []) as unknown as OverviewReminderRow[]);
      setUpcomingReminders((upRes.data || []) as unknown as OverviewReminderRow[]);
      setLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setError('تعذّر تحميل الجلسات والتذكيرات. جرّب تاني.');
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [todayStr, retryTick]);

  const findCase = (caseId: string | null) => cases.find((c) => c.id === caseId) || null;

  if (loading) {
    return React.createElement(LoadingState, { message: 'جاري تحميل الجلسات والتذكيرات...' });
  }

  if (error) {
    return React.createElement(ErrorState, { message: error, onRetry: () => setRetryTick((t) => t + 1) });
  }

  const totalUrgent = pastSessionsNoResult.length + overdueReminders.length;

  return React.createElement('div', { className: 'flex-1 overflow-y-auto no-scrollbar px-4 py-4 space-y-4' },

    // ── ملخص أعلى الصفحة ──
    React.createElement(SummaryBanner, {
      icon: totalUrgent > 0 ? '⚠️' : '✅',
      title: totalUrgent > 0 ? `${totalUrgent} بند محتاج متابعة` : 'مفيش حاجة متأخرة',
      subtitle: `${upcomingSessions.length} جلسة قادمة، ${upcomingReminders.length} تذكير قادم`,
      tone: totalUrgent > 0 ? 'danger' : 'success',
    }),

    // ── جلسات فاتت من غير نتيجة مسجلة ──
    pastSessionsNoResult.length > 0 && React.createElement(SectionCard, { title: 'جلسات فاتت من غير نتيجة مسجّلة', tone: 'danger' },
      pastSessionsNoResult.map((s) => {
        const c = findCase(s.case_id);
        return React.createElement('button', {
          key: s.id,
          type: 'button',
          disabled: !c,
          onClick: () => { if (c) onOpenCase?.(c); },
          className: `w-full flex items-center justify-between gap-3 py-2 text-right ${c ? 'active:opacity-60' : ''}`,
        },
          React.createElement('div', { className: 'flex items-center gap-2 min-w-0' },
            React.createElement('span', { className: 'w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0' }),
            React.createElement('span', { className: 'text-xs font-bold text-white truncate' }, c?.title || s.case_number || 'قضية غير مرتبطة')
          ),
          React.createElement('span', { className: 'text-[9px] text-rose-300 font-black shrink-0' }, s.session_date ? relativeDayLabel(s.session_date, todayStr) : '—')
        );
      })
    ),

    // ── تذكيرات متأخرة ──
    overdueReminders.length > 0 && React.createElement(SectionCard, { title: 'تذكيرات متأخرة', tone: 'warning' },
      overdueReminders.map((r) =>
        React.createElement('div', { key: r.id, className: 'flex items-center justify-between gap-3 py-2' },
          React.createElement('div', { className: 'flex items-center gap-2 min-w-0' },
            React.createElement('span', { className: 'w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0' }),
            React.createElement('span', { className: 'text-xs font-bold text-white truncate' }, r.title || '—')
          ),
          React.createElement('span', { className: 'text-[9px] text-amber-300 font-black shrink-0' }, r.due_date ? relativeDayLabel(r.due_date, todayStr) : '—')
        )
      )
    ),

    // ── جلسات قادمة ──
    React.createElement(SectionCard, { title: 'الجلسات القادمة' },
      upcomingSessions.length === 0
        ? React.createElement('p', { className: 'text-[11px] text-slate-500 py-2' }, 'مفيش جلسات قادمة مسجّلة')
        : upcomingSessions.map((s) => {
            const c = findCase(s.case_id);
            return React.createElement('button', {
              key: s.id,
              type: 'button',
              disabled: !c,
              onClick: () => { if (c) onOpenCase?.(c); },
              className: `w-full flex items-center justify-between gap-3 py-2 text-right ${c ? 'active:opacity-60' : ''}`,
            },
              React.createElement('div', { className: 'flex items-center gap-2 min-w-0' },
                React.createElement('span', { className: 'w-1.5 h-1.5 rounded-full bg-premium-gold shrink-0' }),
                React.createElement('span', { className: 'text-xs font-bold text-white truncate' }, c?.title || s.case_number || 'قضية غير مرتبطة')
              ),
              React.createElement('span', { className: 'text-[9px] text-premium-gold font-black shrink-0' }, s.session_date ? relativeDayLabel(s.session_date, todayStr) : '—')
            );
          })
    ),

    // ── تذكيرات قادمة ──
    React.createElement(SectionCard, { title: 'التذكيرات القادمة' },
      upcomingReminders.length === 0
        ? React.createElement('p', { className: 'text-[11px] text-slate-500 py-2' }, 'مفيش تذكيرات قادمة')
        : upcomingReminders.map((r) =>
            React.createElement('div', { key: r.id, className: 'flex items-center justify-between gap-3 py-2' },
              React.createElement('div', { className: 'flex items-center gap-2 min-w-0' },
                React.createElement('span', { className: 'w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0' }),
                React.createElement('span', { className: 'text-xs font-bold text-white truncate' }, r.title || '—')
              ),
              React.createElement('span', { className: 'text-[9px] text-blue-300 font-black shrink-0' }, r.due_date ? relativeDayLabel(r.due_date, todayStr) : '—')
            )
          )
    ),

    // ── نسخ الملخص ──
    React.createElement(CopyButton, {
      getText: () => buildOverviewSummaryText(cases, pastSessionsNoResult, overdueReminders, upcomingSessions, upcomingReminders, todayStr),
      idleLabel: '📋 نسخ ملخص الجلسات والتذكيرات',
      copiedLabel: 'اتنسخ الملخص',
    })
  );
}

export default SessionsRemindersOverview;
