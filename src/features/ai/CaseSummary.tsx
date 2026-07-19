import React, { useState, useEffect } from 'react';
import { db } from '../../supabaseClient';
import { recordError } from '../../systemHealth';
import {
  CasePicker, EmptyState, SectionCard, CopyButton, DisclaimerNote, ErrorState,
  UsageLimitState, isQuotaExceededMessage,
} from '../../shared/ui/TaskResultKit';
import type { MappedCase, MappedClient } from '../../hooks/useAppData';
import type { LegalArticle, AIMessage } from './hooks/aiAssistantTypes';

// ─────────────────────────────────────────────────────────
//  CaseSummary — أول بند في المرحلة 3 من خطة المساعد الذكي
//  ("تلخيص احترافي للقضية"، sanad-ai-assistant-plan-16.md، قسم 4.2).
//  بيستخدم نفس محرك الـ AI الموجود (callAI + buildLegalContextBlock من
//  useAILegalEngine) — صفر منطق AI جديد، بس prompt وواجهة مخصصين
//  لمهمة التلخيص. مفيش إدخال حر: زرار واحد ثابت "لخّص القضية".
// ─────────────────────────────────────────────────────────

interface CaseSummaryProps {
  cases: MappedCase[];
  clients: MappedClient[];
  retrieveLegalArticles: (query: string) => Promise<LegalArticle[]>;
  buildLegalContextBlock: (articles: LegalArticle[] | null | undefined, forDocument?: boolean) => string;
  callAI: (prompt: string | null, history: AIMessage[] | null, legalContextBlock?: string) => Promise<string>;
}

interface CaseCounts {
  sessions: number;
  documents: number;
}

interface FeeRow {
  total_fees: number | null;
  paid_fees: number | null;
}

const isFilled = (v: string | null | undefined) => !!v && v.trim() !== '' && v !== '—';

function buildCaseContextText(c: MappedCase, client: MappedClient | null, counts: CaseCounts | null, fee: FeeRow | null): string {
  const remaining = fee && fee.total_fees != null && fee.paid_fees != null ? fee.total_fees - fee.paid_fees : null;
  const lines = [
    `عنوان القضية: ${c.title || '—'}`,
    `رقم القيد: ${c.number || '—'} / ${c.year || '—'}`,
    `نوع القضية: ${c.type || '—'}`,
    `المحكمة: ${c.court || '—'}${c.court_level ? ' — ' + c.court_level : ''}`,
    `حالة القضية: ${c.status || '—'}`,
    `المدعي/الطاعن: ${c.plaintiff || '—'}${c.plaintiff_role ? ' (' + c.plaintiff_role + ')' : ''}`,
    `المدعى عليه: ${c.defendant || '—'}${c.defendant_role ? ' (' + c.defendant_role + ')' : ''}`,
    client ? `الموكل: ${client.full_name}` : 'الموكل: غير مرتبط',
    counts ? `عدد الجلسات المسجّلة: ${counts.sessions} — عدد المستندات المرفوعة: ${counts.documents}` : '',
    remaining !== null ? `المتبقي من الأتعاب: ${remaining.toLocaleString('ar-EG')}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildSummaryPrompt(contextText: string): string {
  return `أنت مساعد قانوني تكتب تلخيصًا احترافيًا موجزًا لملف قضية لصالح المحامي المسؤول عنها، بناءً على البيانات التالية فقط:

${contextText}

اكتب تلخيصًا احترافيًا مختصرًا (فقرتان كحد أقصى) بالعربية الفصحى يغطي: طبيعة النزاع وأطرافه، المرحلة الحالية للقضية، وأي نقطة تحتاج انتباه عاجل (لو وجدت) بناءً على البيانات أعلاه فقط. لا تخترع أي معلومة غير موجودة في البيانات. لا تضع عنوانًا للتلخيص ولا تعليقًا قبله أو بعده — ابدأ بالتلخيص مباشرةً.`;
}

function CaseSummary({ cases, clients, retrieveLegalArticles, buildLegalContextBlock, callAI }: CaseSummaryProps) {
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id || null);
  const [counts, setCounts] = useState<CaseCounts | null>(null);
  const [fee, setFee] = useState<FeeRow | null>(null);
  const [summary, setSummary] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCase = cases.find((c) => c.id === selectedId) || null;
  const client = selectedCase ? clients.find((cl) => cl.id === selectedCase.client_id) || null : null;

  /* eslint-disable react-hooks/exhaustive-deps -- selectedCase بيتحسب من .find() في
     كل render فبيبقى object جديد كل مرة. معتمدين على .id (قيمة ثابتة) عشان الـ effect
     ميعدش يشتغل غير لما تتغير القضية فعليًا. */
  useEffect(() => {
    setSummary('');
    setError(null);
    if (!selectedCase) { setCounts(null); setFee(null); return; }
    let cancelled = false;
    Promise.all([
      db.from('case_sessions').select('id', { count: 'exact', head: true }).eq('case_id', selectedCase.id),
      db.from('case_documents').select('id', { count: 'exact', head: true }).eq('case_id', selectedCase.id),
      db.from('case_fees').select('total_fees,paid_fees').eq('case_id', selectedCase.id).is('deleted_at', null).maybeSingle(),
    ]).then(([sessRes, docRes, feeRes]) => {
      if (cancelled) return;
      setCounts({ sessions: sessRes.count || 0, documents: docRes.count || 0 });
      setFee((feeRes.data || null) as unknown as FeeRow | null);
    }).catch(() => { /* مش حرج — التلخيص هيشتغل حتى من غير الإحصائيات دي */ });
    return () => { cancelled = true; };
  }, [selectedCase?.id]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // ── Validation قبل التوليد: منع التلخيص لو بيانات القضية ناقصة بشكل حرج ──
  const missingCritical: string[] = [];
  if (selectedCase) {
    if (!isFilled(selectedCase.type)) missingCritical.push('نوع القضية');
    if (!isFilled(selectedCase.court)) missingCritical.push('المحكمة');
    if (!isFilled(selectedCase.number)) missingCritical.push('رقم القيد');
  }
  const canGenerate = !!selectedCase && missingCritical.length === 0 && !generating;

  const generateSummary = async () => {
    if (!selectedCase || missingCritical.length > 0) return;
    setGenerating(true);
    setError(null);
    setSummary('');
    try {
      const contextText = buildCaseContextText(selectedCase, client, counts, fee);
      const retrievalQuery = [selectedCase.type, selectedCase.court].filter(Boolean).join(' — ');
      const retrieved = retrievalQuery ? await retrieveLegalArticles(retrievalQuery) : [];
      const legalContextBlock = buildLegalContextBlock(retrieved, true);
      const prompt = buildSummaryPrompt(contextText);
      const reply = await callAI(prompt, null, legalContextBlock);
      setSummary(reply);
    } catch (e) {
      const _msg = e instanceof Error ? e.message : String(e);
      // نفس منطق useAIChat/useAIDocumentGenerator: رسالة السيرفر العربية
      // الواضحة (زي حد الاستخدام اليومي) تتعرض زي ما هي، غير كده رسالة عامة.
      const isUserFacingMessage = /[\u0600-\u06FF]/.test(_msg);
      const displayMsg = isUserFacingMessage
        ? _msg
        : 'تعذّر توليد التلخيص. حاول تاني بعد قليل. لو المشكلة استمرت، تواصل مع الدعم.';
      if (!isUserFacingMessage) {
        recordError('ai_case_summary', _msg, { label: 'تلخيص القضية', message: displayMsg });
      }
      setError(displayMsg);
    }
    setGenerating(false);
  };

  if (cases.length === 0) {
    return React.createElement(EmptyState, { icon: '🧾', title: 'لا توجد قضايا مسجّلة' });
  }

  return React.createElement('div', { className: 'flex-1 flex flex-col min-h-0' },
    React.createElement(CasePicker, { cases, selectedId, onSelect: setSelectedId }),

    React.createElement('div', { className: 'flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-4' },
      !selectedCase
        ? React.createElement('p', { className: 'text-xs text-slate-500 py-8 text-center' }, 'اختر قضية لتلخيصها')
        : React.createElement(React.Fragment, null,

            missingCritical.length > 0 && React.createElement(SectionCard, { title: 'بيانات ناقصة', tone: 'warning' },
              React.createElement('p', { className: 'text-[11px] text-amber-200 font-bold leading-relaxed' },
                `مينفعش نلخّص القضية دي قبل ما تستكمل: ${missingCritical.join('، ')}.`
              )
            ),

            React.createElement('button', {
              type: 'button',
              onClick: generateSummary,
              disabled: !canGenerate,
              className: `w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 ${
                generating ? 'bg-white/5 text-slate-400 border border-white/10' : 'text-premium-bg'
              }`,
              style: generating ? undefined : { background: 'linear-gradient(135deg,#D4AF37,#E8C84A)' },
            }, generating ? 'جاري التلخيص...' : (summary ? '🔄 إعادة تلخيص القضية' : '🧾 لخّص القضية بالذكاء الاصطناعي')),

            error && (isQuotaExceededMessage(error)
              ? React.createElement(UsageLimitState, { message: error })
              : React.createElement(ErrorState, { message: error, onRetry: generateSummary })),

            summary && React.createElement(SectionCard, { title: 'تلخيص القضية' },
              React.createElement('p', { className: 'text-xs font-bold text-white leading-loose whitespace-pre-line' }, summary)
            ),

            summary && React.createElement(CopyButton, {
              getText: () => summary,
              idleLabel: '📋 نسخ التلخيص',
              copiedLabel: 'اتنسخ التلخيص',
            }),

            summary && React.createElement(DisclaimerNote, { text: 'مسودة أولية مولّدة بالذكاء الاصطناعي — محتاجة مراجعة قانونية قبل الاعتماد عليها رسميًا.' }),
          )
    )
  );
}

export default CaseSummary;
