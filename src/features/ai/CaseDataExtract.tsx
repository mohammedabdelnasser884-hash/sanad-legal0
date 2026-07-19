import React, { useState, useEffect } from 'react';
import { db } from '../../supabaseClient';
import { formatArDate } from '../../shared/ui/arabicLocale';
import { CasePicker, EmptyState, SectionCard, InfoRow, CopyButton, ErrorState } from '../../shared/ui/TaskResultKit';
import type { MappedCase, MappedClient } from '../../hooks/useAppData';

// ─────────────────────────────────────────────────────────
//  CaseDataExtract — المرحلة 1 من خطة المساعد الذكي
//  ("استخراج بيانات القضية الأساسية"، sanad-ai-assistant-plan-8.md، قسم 4.1).
//  Rule-based بالكامل — صفر استدعاء AI. عرض مباشر من بيانات
//  القضية والموكل الموجودة أصلاً (props)، + عدد الجلسات/المستندات
//  بستعلام مباشر من الداتابيز زي نفس نمط SessionsRemindersOverview.tsx.
// ─────────────────────────────────────────────────────────

interface CaseDataExtractProps {
  cases: MappedCase[];
  clients: MappedClient[];
}

interface CaseCounts {
  sessions: number;
  documents: number;
}

const val = (v: string | number | null | undefined) => (v !== null && v !== undefined && String(v).trim() !== '' ? String(v) : '—');

function buildSummaryText(c: MappedCase, client: MappedClient | null, counts: CaseCounts | null): string {
  const lines = [
    `القضية: ${val(c.title)}`,
    `رقم القيد: ${val(c.number)} — سنة ${val(c.year)}`,
    `النوع: ${val(c.type)}`,
    `المحكمة: ${val(c.court)}${c.court_level ? ' — ' + c.court_level : ''}`,
    c.circuit_number ? `الدائرة: ${c.circuit_number}` : '',
    `الحالة: ${val(c.status)}`,
    `المدعي/الطاعن: ${val(c.plaintiff)}${c.plaintiff_role ? ' (' + c.plaintiff_role + ')' : ''}`,
    `المدعى عليه: ${val(c.defendant)}${c.defendant_role ? ' (' + c.defendant_role + ')' : ''}`,
    client ? `الموكل: ${client.full_name}${client.phone ? ' — ' + client.phone : ''}` : '',
    counts ? `عدد الجلسات المسجّلة: ${counts.sessions} — عدد المستندات: ${counts.documents}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function CaseDataExtract({ cases, clients }: CaseDataExtractProps) {
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id || null);
  const [counts, setCounts] = useState<CaseCounts | null>(null);
  const [loadingCounts, setLoadingCounts] = useState(false);
  const [countsError, setCountsError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const selectedCase = cases.find((c) => c.id === selectedId) || null;
  const client = selectedCase ? clients.find((cl) => cl.id === selectedCase.client_id) || null : null;

  useEffect(() => {
    if (!selectedCase) { setCounts(null); setCountsError(null); return; }
    let cancelled = false;
    setLoadingCounts(true);
    setCountsError(null);
    Promise.all([
      db.from('case_sessions').select('id', { count: 'exact', head: true }).eq('case_id', selectedCase.id),
      db.from('case_documents').select('id', { count: 'exact', head: true }).eq('case_id', selectedCase.id),
    ]).then(([sessRes, docRes]) => {
      if (cancelled) return;
      setCounts({ sessions: sessRes.count || 0, documents: docRes.count || 0 });
      setLoadingCounts(false);
    }).catch(() => {
      if (cancelled) return;
      setCountsError('تعذّر تحميل إحصائيات القضية. جرّب تاني.');
      setLoadingCounts(false);
    });
    return () => { cancelled = true; };
  }, [selectedCase?.id, retryTick]);

  if (cases.length === 0) {
    return React.createElement(EmptyState, { icon: '📋', title: 'لا توجد قضايا مسجّلة' });
  }

  return React.createElement('div', { className: 'flex-1 flex flex-col min-h-0' },
    // ── منتقي القضية ──
    React.createElement(CasePicker, { cases, selectedId, onSelect: setSelectedId }),

    React.createElement('div', { className: 'flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-4' },
      !selectedCase
        ? React.createElement('p', { className: 'text-xs text-slate-500 py-8 text-center' }, 'اختر قضية لعرض بياناتها')
        : React.createElement(React.Fragment, null,

            // ── بيانات القيد ──
            React.createElement(SectionCard, { title: 'بيانات القيد' },
              React.createElement(InfoRow, { label: 'رقم القيد', value: `${val(selectedCase.number)} / ${val(selectedCase.year)}` }),
              React.createElement(InfoRow, { label: 'نوع القضية', value: val(selectedCase.type) }),
              React.createElement(InfoRow, { label: 'الحالة', value: val(selectedCase.status) }),
              React.createElement(InfoRow, { label: 'تاريخ القضية', value: selectedCase.date ? formatArDate(selectedCase.date) : '—' }),
            ),

            // ── المحكمة ──
            React.createElement(SectionCard, { title: 'المحكمة' },
              React.createElement(InfoRow, { label: 'المحكمة', value: val(selectedCase.court) }),
              React.createElement(InfoRow, { label: 'درجة التقاضي', value: val(selectedCase.court_level) }),
              React.createElement(InfoRow, { label: 'رقم الدائرة', value: val(selectedCase.circuit_number) }),
              React.createElement(InfoRow, { label: 'الدور / القاعة', value: `${val(selectedCase.court_floor)} / ${val(selectedCase.court_hall)}` }),
              React.createElement(InfoRow, { label: 'قاعة الجلسة', value: val(selectedCase.session_hall) }),
              React.createElement(InfoRow, { label: 'أمين السر', value: `${val(selectedCase.secretary_name)} (${val(selectedCase.secretary_hall)})` }),
            ),

            // ── الأطراف ──
            React.createElement(SectionCard, { title: 'الأطراف' },
              React.createElement(InfoRow, { label: 'المدعي / الطاعن', value: val(selectedCase.plaintiff) }),
              React.createElement(InfoRow, { label: 'صفته', value: val(selectedCase.plaintiff_role) }),
              React.createElement(InfoRow, { label: 'المدعى عليه', value: val(selectedCase.defendant) }),
              React.createElement(InfoRow, { label: 'صفته', value: val(selectedCase.defendant_role) }),
            ),

            // ── الموكل ──
            React.createElement(SectionCard, { title: 'الموكل' },
              client
                ? React.createElement(React.Fragment, null,
                    React.createElement(InfoRow, { label: 'الاسم', value: client.full_name || '—' }),
                    React.createElement(InfoRow, { label: 'الهاتف', value: client.phone || '—' }),
                  )
                : React.createElement('p', { className: 'text-[11px] text-rose-400 font-bold py-1' }, '⚠️ مفيش موكل مربوط بالقضية دي')
            ),

            // ── إحصائيات سريعة ──
            React.createElement(SectionCard, { title: 'إحصائيات' },
              countsError
                ? React.createElement(ErrorState, { message: countsError, onRetry: () => setRetryTick((t) => t + 1) })
                : loadingCounts
                ? React.createElement('p', { className: 'text-[11px] text-slate-500 py-1' }, 'جاري الحساب...')
                : React.createElement(React.Fragment, null,
                    React.createElement(InfoRow, { label: 'عدد الجلسات المسجّلة', value: String(counts?.sessions ?? 0) }),
                    React.createElement(InfoRow, { label: 'عدد المستندات المرفوعة', value: String(counts?.documents ?? 0) }),
                  )
            ),

            // ── نسخ البيانات ──
            React.createElement(CopyButton, {
              getText: () => (selectedCase ? buildSummaryText(selectedCase, client, counts) : ''),
              idleLabel: '📋 نسخ بيانات القضية',
              copiedLabel: 'اتنسخت البيانات',
            }),
          )
    )
  );
}

export default CaseDataExtract;
