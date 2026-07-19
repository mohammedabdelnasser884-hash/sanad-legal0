import React, { useState, useEffect } from 'react';
import { loadOfficeSetting } from '../../constants';
import { toast } from '../../shared/lib/notifications';
import { formatPhoneForWhatsApp } from '../../shared/lib/validation';
import { recordError } from '../../systemHealth';
import {
  CasePicker, EmptyState, SectionCard, CopyButton, DisclaimerNote, ErrorState,
  UsageLimitState, isQuotaExceededMessage,
} from '../../shared/ui/TaskResultKit';
import type { MappedCase } from '../../hooks/useAppData';
import type { ClientRow } from '../../types';
import type { AIMessage } from './hooks/aiAssistantTypes';

// ─────────────────────────────────────────────────────────
//  ClientMessage — "رسالة عميل مختصرة" (المرحلة 3، البند الثالث
//  من خطة المساعد الذكي، sanad-ai-assistant-plan-18.md، قسم 4.2).
//  بيستخدم نفس callAI الموجود (من useAILegalEngine عبر useAIAssistant)
//  — صفر منطق AI جديد، بس prompt وواجهة مخصصين لمهمة صياغة رسالة
//  عميل بلغة بسيطة. مفيش إدخال حر: زرار واحد ثابت "اكتب رسالة".
//  التكامل مع واتساب بيستخدم نفس آلية wa.me الموجودة فعليًا في
//  CaseDetailView.tsx (formatPhoneForWhatsApp + رابط wa.me?text=)
//  بدل اختراع طريقة جديدة.
// ─────────────────────────────────────────────────────────

interface ClientMessageProps {
  cases: MappedCase[];
  clients: ClientRow[];
  callAI: (prompt: string | null, history: AIMessage[] | null, legalContextBlock?: string) => Promise<string>;
}

const isFilled = (v: string | null | undefined) => !!v && v.trim() !== '' && v !== '—';

function buildClientContextText(c: MappedCase, clientName: string): string {
  const lines = [
    `اسم العميل: ${clientName}`,
    `عنوان القضية: ${c.title || '—'}`,
    `نوع القضية: ${c.type || '—'}`,
    `حالة القضية الحالية: ${c.status || '—'}`,
    isFilled(c.date) ? `أقرب موعد جلسة مسجّل: ${c.date}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function buildMessagePrompt(contextText: string, officeName: string): string {
  return `أنت مساعد مكتب محاماة تكتب رسالة واتساب قصيرة وودّية للعميل لتحديثه عن قضيته، بناءً على البيانات التالية فقط:

${contextText}

اكتب رسالة قصيرة جدًا (3 إلى 5 أسطر بحد أقصى) باللغة العربية البسيطة اليومية، من غير مصطلحات قانونية معقدة ومن غير أي معلومة مش موجودة في البيانات أعلاه. ابدأ بتحية مناسبة باسم العميل، اذكر مستجد حالة القضية بإيجاز، وانتهِ بجملة تطمين قصيرة. لا تضع عنوانًا للرسالة ولا تعليقًا قبلها أو بعدها — ابدأ بالرسالة مباشرةً. اختم الرسالة بتوقيع باسم "${officeName}" في سطر منفصل.`;
}

function ClientMessage({ cases, clients, callAI }: ClientMessageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id || null);
  const [officeName, setOfficeName] = useState('مكتب المحاماة');
  const [message, setMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedCase = cases.find((c) => c.id === selectedId) || null;
  const client = selectedCase ? clients.find((cl) => cl.id === selectedCase.client_id) || null : null;
  const clientName = client?.full_name || 'العميل الكريم';

  useEffect(() => {
    loadOfficeSetting('office_name').then((name) => { if (name) setOfficeName(name); }).catch(() => {});
  }, []);

  useEffect(() => {
    setMessage('');
    setError(null);
  }, [selectedCase?.id]);

  // ── Validation قبل التوليد: منع الرسالة لو بيانات القضية ناقصة بشكل حرج ──
  const missingCritical: string[] = [];
  if (selectedCase) {
    if (!isFilled(selectedCase.type)) missingCritical.push('نوع القضية');
    if (!isFilled(selectedCase.status)) missingCritical.push('حالة القضية');
  }
  const canGenerate = !!selectedCase && missingCritical.length === 0 && !generating;

  const generateMessage = async () => {
    if (!selectedCase || missingCritical.length > 0) return;
    setGenerating(true);
    setError(null);
    setMessage('');
    try {
      const contextText = buildClientContextText(selectedCase, clientName);
      const prompt = buildMessagePrompt(contextText, officeName);
      const reply = await callAI(prompt, null);
      setMessage(reply);
    } catch (e) {
      const _msg = e instanceof Error ? e.message : String(e);
      // نفس منطق useAIChat/useAIDocumentGenerator/CaseSummary: رسالة السيرفر
      // العربية الواضحة (زي حد الاستخدام اليومي) تتعرض زي ما هي، غير كده رسالة عامة.
      const isUserFacingMessage = /[\u0600-\u06FF]/.test(_msg);
      const displayMsg = isUserFacingMessage
        ? _msg
        : 'تعذّر كتابة الرسالة. حاول تاني بعد قليل. لو المشكلة استمرت، تواصل مع الدعم.';
      if (!isUserFacingMessage) {
        recordError('ai_client_message', _msg, { label: 'رسالة عميل مختصرة', message: displayMsg });
      }
      setError(displayMsg);
    }
    setGenerating(false);
  };

  const sendViaWhatsApp = () => {
    if (!message) return;
    const clientPhone = formatPhoneForWhatsApp(client?.phone);
    if (!clientPhone) { toast('⚠️ لا يوجد رقم واتساب مسجل للعميل', true); return; }
    const url = `https://wa.me/${clientPhone}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  if (cases.length === 0) {
    return React.createElement(EmptyState, { icon: '💬', title: 'لا توجد قضايا مسجّلة' });
  }

  return React.createElement('div', { className: 'flex-1 flex flex-col min-h-0' },
    React.createElement(CasePicker, { cases, selectedId, onSelect: setSelectedId }),

    React.createElement('div', { className: 'flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-4' },
      !selectedCase
        ? React.createElement('p', { className: 'text-xs text-slate-500 py-8 text-center' }, 'اختر قضية لكتابة رسالة عميلها')
        : React.createElement(React.Fragment, null,

            missingCritical.length > 0 && React.createElement(SectionCard, { title: 'بيانات ناقصة', tone: 'warning' },
              React.createElement('p', { className: 'text-[11px] text-amber-200 font-bold leading-relaxed' },
                `مينفعش نكتب رسالة قبل ما تستكمل: ${missingCritical.join('، ')}.`
              )
            ),

            !client && React.createElement(SectionCard, { title: 'تنبيه', tone: 'info' },
              React.createElement('p', { className: 'text-[11px] text-blue-200 font-bold leading-relaxed' },
                'مفيش موكل مرتبط بالقضية دي — الرسالة هتتكتب باسم عام ومش هتقدر ترسلها بواتساب من هنا مباشرة.'
              )
            ),

            React.createElement('button', {
              type: 'button',
              onClick: generateMessage,
              disabled: !canGenerate,
              className: `w-full py-3.5 rounded-2xl font-black text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-40 ${
                generating ? 'bg-white/5 text-slate-400 border border-white/10' : 'text-premium-bg'
              }`,
              style: generating ? undefined : { background: 'linear-gradient(135deg,#D4AF37,#E8C84A)' },
            }, generating ? 'جاري الكتابة...' : (message ? '🔄 إعادة كتابة الرسالة' : '💬 اكتب رسالة للعميل بالذكاء الاصطناعي')),

            error && (isQuotaExceededMessage(error)
              ? React.createElement(UsageLimitState, { message: error })
              : React.createElement(ErrorState, { message: error, onRetry: generateMessage })),

            message && React.createElement(SectionCard, { title: 'رسالة العميل المقترحة' },
              React.createElement('p', { className: 'text-xs font-bold text-white leading-loose whitespace-pre-line' }, message)
            ),

            message && React.createElement('div', { className: 'grid grid-cols-2 gap-2' },
              React.createElement(CopyButton, {
                getText: () => message,
                idleLabel: '📋 نسخ الرسالة',
                copiedLabel: 'اتنسخت الرسالة',
              }),
              React.createElement('button', {
                type: 'button',
                onClick: sendViaWhatsApp,
                className: 'w-full py-3 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] border bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
              }, `💬 ${client?.phone ? 'إرسال عبر واتساب' : 'لا يوجد رقم عميل'}`)
            ),

            message && React.createElement(DisclaimerNote, { text: 'رسالة مقترحة بالذكاء الاصطناعي — راجعها قبل إرسالها للعميل.' }),
          )
    )
  );
}

export default ClientMessage;
