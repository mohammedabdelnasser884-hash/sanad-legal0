import React, { useState } from 'react';
import type { MappedCase } from '../../hooks/useAppData';

// ─────────────────────────────────────────────────────────
//  TaskResultKit — "شاشة نتيجة موحّدة" (المرحلة 2، البند الثاني
//  من خطة المساعد الذكي، sanad-ai-assistant-plan-12.md، قسم 6).
//
//  مكوّنات مشتركة كانت متكررة حرفيًا (نفس الـ className، نفس
//  المنطق) عبر SessionsRemindersOverview / CaseDataExtract /
//  RequiredDocumentsList / NextStepSuggestion:
//    - منتقي القضية (case picker)
//    - حالة "لا توجد قضايا" (empty state)
//    - حالة التحميل (spinner)
//    - حالة خطأ عامة (لمهام AI القادمة في المرحلة 3)
//    - بطاقة قسم بعنوان (section card)
//    - صف بيانات (label/value)
//    - بانر ملخص علوي ملوّن حسب الحالة (success/warning/danger/info)
//    - نقطة ملوّنة لقوائم البنود المرتبة بالأولوية
//    - زرار نسخ ذاتي الإدارة بحالة "اتنسخ" مؤقتة
//    - تنبيه سفلي ثابت (القائمة استرشادية / اقتراحات...)
//
//  الهدف: توحيد الشكل والسلوك عبر كل مهام المساعد الحالية
//  والمستقبلية (Rule-based أو AI) بدل تكرار نفس الكود حرفيًا
//  في كل ملف. الاستخدام تدريجي — أي مكوّن قديم مش لازم يتلمس.
//  ملتزم بنفس أسلوب الكود المتبع في src/features/ai (React.createElement
//  بدل JSX) عشان يفضل الملف متسق مع باقي القسم.
// ─────────────────────────────────────────────────────────

export type ResultTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_BANNER: Record<ResultTone, string> = {
  success: 'bg-emerald-500/10 border-emerald-500/20',
  warning: 'bg-amber-500/10 border-amber-500/20',
  danger: 'bg-rose-500/10 border-rose-500/20',
  info: 'bg-blue-500/10 border-blue-500/20',
  neutral: 'bg-premium-card border-white/5',
};

const TONE_DOT: Record<ResultTone, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
  info: 'bg-blue-400',
  neutral: 'bg-slate-500',
};

const TONE_TEXT: Record<ResultTone, string> = {
  success: 'text-emerald-400',
  warning: 'text-amber-400',
  danger: 'text-rose-400',
  info: 'text-blue-300',
  neutral: 'text-slate-500',
};

// ── منتقي القضية — بار أفقي قابل للتمرير ──
interface CasePickerProps {
  cases: MappedCase[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  max?: number;
}
export function CasePicker({ cases, selectedId, onSelect, max = 20 }: CasePickerProps) {
  return React.createElement('div', { className: 'shrink-0 px-4 pt-3 pb-2' },
    React.createElement('div', { className: 'flex gap-2 overflow-x-auto no-scrollbar pb-1' },
      cases.slice(0, max).map((c) => React.createElement('button', {
        key: c.id,
        type: 'button',
        onClick: () => onSelect(c.id),
        className: `shrink-0 px-3 py-1.5 rounded-xl text-[10px] font-black transition-all whitespace-nowrap max-w-[160px] truncate ${
          selectedId === c.id
            ? 'bg-premium-gold/20 text-premium-gold border border-premium-gold/30'
            : 'bg-white/5 text-slate-500 border border-white/5'
        }`,
      }, c.title))
    )
  );
}

// ── حالة "لا توجد قضايا" (أو أي فراغ عام) ──
interface EmptyStateProps {
  icon: string;
  title: string;
  subtitle?: string;
}
export function EmptyState({ icon, title, subtitle }: EmptyStateProps) {
  return React.createElement('div', { className: 'flex-1 flex flex-col items-center justify-center gap-3 text-center p-8' },
    React.createElement('div', { className: 'w-14 h-14 rounded-2xl bg-white/5 flex items-center justify-center text-2xl' }, icon),
    React.createElement('p', { className: 'text-sm font-bold text-slate-400' }, title),
    subtitle ? React.createElement('p', { className: 'text-xs text-slate-600' }, subtitle) : null
  );
}

// ── حالة التحميل — سبينر + رسالة ──
interface LoadingStateProps { message: string }
export function LoadingState({ message }: LoadingStateProps) {
  return React.createElement('div', { className: 'flex items-center justify-center py-16 text-slate-500 text-xs gap-2' },
    React.createElement('span', { className: 'animate-spin inline-block w-4 h-4 border-2 border-slate-600 border-t-premium-gold rounded-full' }),
    message
  );
}

// ── حالة خطأ عامة — لمهام AI القادمة (المرحلة 3) وأي استعلام فشل ──
interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}
export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return React.createElement('div', { className: 'flex flex-col items-center justify-center gap-3 py-12 px-6 text-center' },
    React.createElement('span', { className: 'text-2xl' }, '⚠️'),
    React.createElement('p', { className: 'text-xs font-bold text-rose-400 leading-relaxed' }, message),
    onRetry ? React.createElement('button', {
      type: 'button',
      onClick: onRetry,
      className: 'px-4 py-2 rounded-xl text-[11px] font-black bg-white/5 border border-white/10 text-slate-300 active:scale-95 transition-all',
    }, 'إعادة المحاولة') : null
  );
}

// ── كشف رسالة "وصلت للحد المجاني اليومي" الآتية من ai-chat/index.ts ──
// (المرحلة 3، بند "fallback واضح عند غياب رصيد AI"، sanad-ai-assistant-plan-19.md)
// نفس النص الحرفي في الإيدج فانكشن — لو تغيّر هناك، يتغيّر هنا معه.
export function isQuotaExceededMessage(message: string): boolean {
  return message.includes('الحد المجاني اليومي');
}

// ── حالة خاصة لنفاد السقف اليومي — مختلفة بصريًا عن ErrorState العادية:
//    بدون زرار "إعادة المحاولة" (مضمون يفشل بنفس الرسالة)، مع تلميح BYOK ──
interface UsageLimitStateProps { message: string }
export function UsageLimitState({ message }: UsageLimitStateProps) {
  return React.createElement('div', { className: 'flex flex-col items-center justify-center gap-3 py-12 px-6 text-center' },
    React.createElement('span', { className: 'text-2xl' }, '⏳'),
    React.createElement('p', { className: 'text-xs font-bold text-amber-300 leading-relaxed' }, message),
    React.createElement('p', { className: 'text-[10px] text-slate-500 leading-relaxed' }, 'السقف بيترجع تلقائيًا بكرة. لو عايز تستخدم أكتر دلوقتي، تقدر تضيف مفتاح Groq شخصي مجاني من الإعدادات.')
  );
}

// ── بطاقة قسم بعنوان علوي رفيع (— العنوان —) ──
interface SectionCardProps {
  title: string;
  tone?: ResultTone;
  children?: React.ReactNode;
}
export function SectionCard({ title, tone = 'neutral', children }: SectionCardProps) {
  return React.createElement('div', { className: `rounded-2xl p-4 border ${tone === 'neutral' ? 'bg-premium-card border-white/5' : TONE_BANNER[tone]}` },
    React.createElement('p', { className: `text-[9px] font-black mb-1 tracking-widest ${tone === 'neutral' ? 'text-slate-500' : TONE_TEXT[tone]}` }, `— ${title} —`),
    children
  );
}

// ── صف بيانات: تسمية + قيمة ──
interface InfoRowProps { label: string; value: string }
export function InfoRow({ label, value }: InfoRowProps) {
  return React.createElement('div', { className: 'flex items-center justify-between gap-3 py-2 border-b border-white/5 last:border-b-0' },
    React.createElement('span', { className: 'text-[10px] font-bold text-slate-500' }, label),
    React.createElement('span', { className: 'text-xs font-black text-white text-left' }, value)
  );
}

// ── بانر ملخص علوي (أيقونة + عنوان + وصف فرعي) ──
interface SummaryBannerProps {
  icon: string;
  title: string;
  subtitle?: string;
  tone: ResultTone;
}
export function SummaryBanner({ icon, title, subtitle, tone }: SummaryBannerProps) {
  return React.createElement('div', { className: `rounded-2xl p-4 border ${TONE_BANNER[tone]}` },
    React.createElement('div', { className: 'flex items-center gap-2.5' },
      React.createElement('span', { className: 'text-2xl' }, icon),
      React.createElement('div', null,
        React.createElement('p', { className: 'text-sm font-black text-white' }, title),
        subtitle ? React.createElement('p', { className: 'text-[10px] text-slate-400 font-bold mt-0.5' }, subtitle) : null
      )
    )
  );
}

// ── نقطة ملوّنة حسب الحالة (لقوائم البنود المرتبة بالأولوية) ──
export function ToneDot({ tone }: { tone: ResultTone }) {
  return React.createElement('span', { className: `w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]}` });
}

// ── زرار نسخ ذاتي الإدارة: بياخد دالة بترجع النص وقت الضغط ──
interface CopyButtonProps {
  getText: () => string;
  idleLabel: string;
  copiedLabel: string;
}
export function CopyButton({ getText, idleLabel, copiedLabel }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const onClick = () => {
    const text = getText();
    if (!text) return;
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return React.createElement('button', {
    type: 'button',
    onClick,
    className: `w-full py-3 rounded-2xl font-black text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] border ${
      copied ? 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' : 'bg-white/5 border-white/10 text-slate-300'
    }`,
  }, copied ? `✓ ${copiedLabel}` : idleLabel);
}

// ── تنبيه سفلي ثابت (نص تحذيري صغير) ──
interface DisclaimerNoteProps { text: string }
export function DisclaimerNote({ text }: DisclaimerNoteProps) {
  return React.createElement('p', { className: 'text-[9.5px] text-amber-200/70 font-bold leading-relaxed px-1' }, `⚠️ ${text}`);
}
