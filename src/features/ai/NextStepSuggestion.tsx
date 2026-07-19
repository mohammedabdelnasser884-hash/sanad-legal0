import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../supabaseClient';
import { CasePicker, EmptyState, LoadingState, ErrorState, SectionCard, ToneDot, DisclaimerNote, CopyButton } from '../../shared/ui/TaskResultKit';
import type { ResultTone } from '../../shared/ui/TaskResultKit';
import { recordError } from '../../systemHealth';
import type { MappedCase } from '../../hooks/useAppData';

// ─────────────────────────────────────────────────────────
//  NextStepSuggestion — المرحلة 1 من خطة المساعد الذكي
//  ("اقتراح الخطوة التالية"، sanad-ai-assistant-plan-10.md، قسم 4.1).
//  Rule-based بالكامل — صفر استدعاء AI. بيحسب أولويات المتابعة
//  من بيانات القضية + الجلسات + المستندات + الأتعاب (استعلام مباشر)
//  ويرجّع "الخطوة التالية" الأهم + باقي البنود مرتّبة حسب الأولوية.
//  آخر بند في المرحلة 1 — بيها تكتمل المرحلة بالكامل (5/5).
// ─────────────────────────────────────────────────────────

interface NextStepSuggestionProps {
  cases: MappedCase[];
}

interface SessionRow {
  session_date: string | null;
  result: string | null;
}

interface FeeRow {
  total_fees: number | null;
  paid_fees: number | null;
}

type Severity = 'critical' | 'warning' | 'info' | 'success';

interface Suggestion {
  id: string;
  text: string;
  severity: Severity;
}

const isFilled = (v: string | null | undefined) => !!v && v.trim() !== '' && v !== '—';

function relativeDayLabel(dateStr: string, todayStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(todayStr + 'T00:00:00');
  const diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'اليوم';
  if (diffDays === 1) return 'بكرة';
  if (diffDays > 1) return `بعد ${diffDays} يوم`;
  return `من ${Math.abs(diffDays)} يوم`;
}

function buildSuggestions(
  caseData: MappedCase,
  sessions: SessionRow[],
  docsCount: number,
  fee: FeeRow | null,
  todayStr: string
): Suggestion[] {
  const out: Suggestion[] = [];

  if (!isFilled(caseData.type) || !isFilled(caseData.court) || !isFilled(caseData.number)) {
    out.push({ id: 'core_info', severity: 'critical', text: 'استكمل البيانات الأساسية للقضية (النوع / المحكمة / رقم القيد)' });
  }

  if (!caseData.client_id) {
    out.push({ id: 'client', severity: 'critical', text: 'اربط موكل بالقضية دي' });
  }

  const pastNoResult = sessions
    .filter((s) => s.session_date && s.session_date < todayStr && !isFilled(s.result))
    .sort((a, b) => (b.session_date || '').localeCompare(a.session_date || ''));
  if (pastNoResult.length > 0) {
    out.push({ id: 'past_session', severity: 'critical', text: `سجّل نتيجة الجلسة اللي فاتت بتاريخ ${pastNoResult[0].session_date} قبل ما تتراكم` });
  }

  const remaining = fee && fee.total_fees != null && fee.paid_fees != null ? fee.total_fees - fee.paid_fees : null;

  if (caseData.status !== 'منتهية') {
    const upcoming = sessions
      .filter((s) => s.session_date && s.session_date >= todayStr)
      .sort((a, b) => (a.session_date || '').localeCompare(b.session_date || ''));

    if (upcoming.length > 0) {
      const d = upcoming[0].session_date as string;
      const label = relativeDayLabel(d, todayStr);
      const diffDays = Math.round((new Date(d + 'T00:00:00').getTime() - new Date(todayStr + 'T00:00:00').getTime()) / 86400000);
      out.push({
        id: 'upcoming_session',
        severity: diffDays <= 1 ? 'critical' : diffDays <= 3 ? 'warning' : 'info',
        text: `جهّز نفسك: جلسة قادمة ${label} (${d})`,
      });
    } else {
      out.push({ id: 'no_upcoming_session', severity: 'warning', text: 'حدد وسجّل موعد الجلسة القادمة' });
    }

    if (docsCount === 0) {
      out.push({ id: 'no_docs', severity: 'warning', text: 'ارفع المستندات الأساسية للقضية' });
    }

    if (remaining !== null && remaining > 0) {
      out.push({ id: 'fees_open', severity: 'warning', text: `تابع تحصيل باقي الأتعاب (المتبقي: ${remaining.toLocaleString('ar-EG')})` });
    }
  } else {
    if (remaining !== null && remaining > 0) {
      out.push({ id: 'fees_before_close', severity: 'warning', text: `حصّل باقي الأتعاب (${remaining.toLocaleString('ar-EG')}) قبل غلق الملف نهائيًا` });
    } else {
      out.push({ id: 'archive', severity: 'info', text: 'تأكد من أرشفة كل مستندات القضية بعد الانتهاء' });
    }
  }

  if (out.length === 0) {
    out.push({ id: 'ok', severity: 'success', text: 'الملف متابَع بشكل جيد — استمر بالمتابعة الدورية' });
  }

  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, success: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

const severityIcon: Record<Severity, string> = { critical: '⚠️', warning: '🟡', info: 'ℹ️', success: '✅' };
const severityTone: Record<Severity, ResultTone> = { critical: 'danger', warning: 'warning', info: 'info', success: 'success' };

function buildNextStepSummaryText(caseData: MappedCase, suggestions: Suggestion[]): string {
  const lines = [`الخطوة التالية — ${caseData.title || '—'}:`, ''];
  suggestions.forEach((s, i) => {
    lines.push(`${i === 0 ? '→' : '-'} ${severityIcon[s.severity]} ${s.text}`);
  });
  return lines.join('\n');
}

function NextStepSuggestion({ cases }: NextStepSuggestionProps) {
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id || null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [docsCount, setDocsCount] = useState(0);
  const [fee, setFee] = useState<FeeRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const selectedCase = cases.find((c) => c.id === selectedId) || null;
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!selectedCase) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      db.from('case_sessions').select('session_date,result').eq('case_id', selectedCase.id),
      db.from('case_documents').select('id', { count: 'exact', head: true }).eq('case_id', selectedCase.id),
      db.from('case_fees').select('total_fees,paid_fees').eq('case_id', selectedCase.id).is('deleted_at', null).maybeSingle(),
    ]).then(([sessRes, docRes, feeRes]) => {
      if (cancelled) return;
      setSessions((sessRes.data || []) as unknown as SessionRow[]);
      setDocsCount(docRes.count || 0);
      setFee((feeRes.data || null) as unknown as FeeRow | null);
      setLoading(false);
    }).catch((e) => {
      if (cancelled) return;
      const _msg = e instanceof Error ? e.message : String(e);
      const displayMsg = 'تعذّر تحليل بيانات القضية. جرّب تاني.';
      recordError('ai_next_step', _msg, { label: 'الخطوة التالية', message: displayMsg });
      setError(displayMsg);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on id intentionally; re-running on the whole selectedCase object would refetch on every render since it's re-derived each time.
  }, [selectedCase?.id, retryTick]);

  const suggestions = useMemo(
    () => (selectedCase ? buildSuggestions(selectedCase, sessions, docsCount, fee, todayStr) : []),
    [selectedCase, sessions, docsCount, fee, todayStr]
  );

  if (cases.length === 0) {
    return React.createElement(EmptyState, { icon: '🧭', title: 'لا توجد قضايا مسجّلة' });
  }

  const top = suggestions[0] || null;
  const rest = suggestions.slice(1);

  return React.createElement('div', { className: 'flex-1 flex flex-col min-h-0' },
    // ── منتقي القضية ──
    React.createElement(CasePicker, { cases, selectedId, onSelect: setSelectedId }),

    React.createElement('div', { className: 'flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-4' },
      !selectedCase
        ? React.createElement('p', { className: 'text-xs text-slate-500 py-8 text-center' }, 'اختر قضية لعرض الخطوة المقترحة')
        : loading
        ? React.createElement(LoadingState, { message: 'جاري تحليل بيانات القضية...' })
        : error
        ? React.createElement(ErrorState, { message: error, onRetry: () => setRetryTick((t) => t + 1) })
        : React.createElement(React.Fragment, null,

            // ── الخطوة التالية المقترحة (أهم بند) ──
            top && React.createElement(SectionCard, { title: 'الخطوة التالية المقترحة', tone: severityTone[top.severity] },
              React.createElement('div', { className: 'flex items-start gap-2.5' },
                React.createElement('span', { className: 'text-xl' }, severityIcon[top.severity]),
                React.createElement('p', { className: 'text-sm font-black text-white leading-relaxed' }, top.text)
              )
            ),

            // ── باقي البنود ──
            rest.length > 0 && React.createElement(SectionCard, { title: 'بنود تانية للمتابعة' },
              rest.map((s, i) => React.createElement('div', {
                key: s.id,
                className: `flex items-center gap-2.5 py-2.5 ${i < rest.length - 1 ? 'border-b border-white/5' : ''}`,
              },
                React.createElement(ToneDot, { tone: severityTone[s.severity] }),
                React.createElement('span', { className: 'text-xs font-bold text-white' }, s.text)
              ))
            ),

            React.createElement(DisclaimerNote, { text: 'اقتراحات مبنية على قواعد ثابتة من بيانات القضية المسجّلة — مش بديل عن تقديرك المهني للأولويات.' }),

            React.createElement(CopyButton, {
              getText: () => (selectedCase ? buildNextStepSummaryText(selectedCase, suggestions) : ''),
              idleLabel: '📋 نسخ الخطوة التالية',
              copiedLabel: 'اتنسخت الخطوة',
            }),
          )
    )
  );
}

export default NextStepSuggestion;
