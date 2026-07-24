import React from 'react';
import type { MappedCase, MappedClient } from '../../../hooks/useAppData';
import type { CaseSessionRow, CaseNoteRow } from '../../../types';
import type { CaseDocWithUrl, CasePartyRow } from '../hooks/useCaseDetailActions';
import { validateParties, type PartyLegalTitles } from '../../../shared/lib/casePartiesValidation';
import type { PartyFieldValue } from '../../../shared/parties/partyTypes';

// ─────────────────────────────────────────────────────────
//  ChecklistSection — المرحلة 1 من خطة المساعد الذكي
//  ("مراجعة نواقص الملف"، sanad-ai-assistant-plan-6.md، قسم 4.1).
//  Rule-based بالكامل — صفر استدعاء AI، صفر تكلفة، بيانات القضية
//  الموجودة فعليًا في الصفحة (caseData/client/sessions/docs) بس.
//
//  🆕 تحديث (مرحلة 4 من خطة "سد فجوات عرض الأطراف" — 24 يوليو 2026):
//  بند "اكتمال بيانات الطرفين" بقى بيفحص case_parties (لو موجودة) عبر
//  validateParties الجاهزة بدل فحص عمودي plaintiff/defendant القدامى
//  بس — بيغطي نقص الاسم/الصفة/الرقم القومي/المسمى القانوني لأي شخص
//  إضافي تحت الطرف، مش الشخص الأساسي بس. فولباك القضايا القديمة (بدون
//  أي صف case_parties) فاضل زي ما هو بالحرف — صفر تغيير.
// ─────────────────────────────────────────────────────────

interface ChecklistSectionProps {
  caseData: MappedCase;
  client: MappedClient | null;
  sessions: CaseSessionRow[];
  notes: CaseNoteRow[];
  docs: CaseDocWithUrl[];
  caseParties?: CasePartyRow[];
  onGoToTab?: (tab: string) => void;
}

type Severity = 'critical' | 'warning';

interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  severity: Severity;
  hint: string;
  // التاب اللي المستخدم يروحله عشان يكمّل البند ده
  goTo?: string;
}

const isFilled = (v: string | null | undefined) => !!v && v.trim() !== '' && v !== '—';

// نفس تحويلة toField الموجودة في EditCaseModal.tsx/StandaloneSessionDetailModal.tsx
// (CasePartyRow من الداتابيز → PartyFieldValue اللي بتتوقعه validateParties).
const toPartyField = (row: CasePartyRow): PartyFieldValue => ({
  id: row.id,
  side: row.side,
  is_client: row.is_client,
  name: row.name || '',
  capacity: row.capacity || '',
  national_id: row.national_id || '',
  address: row.address || '',
  power_of_attorney: row.power_of_attorney || '',
  client_id: row.client_id || null,
});

// فحص جهة واحدة (مدعي/مدعى عليه) باستخدام نتيجة validateParties العامة —
// ok=false لو مفيش أي صف على الجهة دي أصلًا، أو لو فيه خطأ (اسم/صفة/رقم
// قومي) على أي طرف تابع للجهة دي، أو لو الجهة فيها شخصان فأكثر والمسمى
// القانوني الجامع فاضي.
function sidePartiesOk(
  side: 'plaintiff' | 'defendant',
  partyFields: PartyFieldValue[],
  legalTitles: PartyLegalTitles,
  validationErrors: { partyId: string }[]
): boolean {
  const sideParties = partyFields.filter((p) => p.side === side);
  if (sideParties.length === 0) return false;
  const sidePartyIds = new Set(sideParties.map((p) => p.id));
  const hasFieldError = validationErrors.some((e) => sidePartyIds.has(e.partyId));
  const legalTitleMissing = sideParties.length >= 2 && !legalTitles[side].trim();
  return !hasFieldError && !legalTitleMissing;
}

function buildChecklist(
  caseData: MappedCase,
  client: MappedClient | null,
  sessions: CaseSessionRow[],
  docs: CaseDocWithUrl[],
  caseParties: CasePartyRow[]
): ChecklistItem[] {
  const todayStr = new Date().toISOString().slice(0, 10);
  const hasUpcomingSession = sessions.some((s) => s.session_date && s.session_date >= todayStr);

  // لو القضية دخل عليها بيانات فعليًا من فورم الأطراف الجديد (case_parties
  // مش فاضية)، الفحص يتحول للقائمة الحقيقية عبر validateParties — بيغطي
  // نقص الرقم القومي/المسمى القانوني لأي شخص إضافي، مش الشخص الأساسي بس.
  // القضايا القديمة (caseParties فاضية) بتاخد نفس الفحص القديم بالحرف.
  let plaintiffOk: boolean;
  let plaintiffHint: string;
  let defendantOk: boolean;
  let defendantHint: string;

  if (caseParties.length > 0) {
    const partyFields = caseParties.map(toPartyField);
    const legalTitles: PartyLegalTitles = {
      plaintiff: caseData.plaintiff_legal_title || '',
      defendant: caseData.defendant_legal_title || '',
    };
    const { errors } = validateParties(partyFields, legalTitles);

    plaintiffOk = sidePartiesOk('plaintiff', partyFields, legalTitles, errors);
    defendantOk = sidePartiesOk('defendant', partyFields, legalTitles, errors);
    plaintiffHint = 'بيانات طرف المدعي/الطاعن ناقصة (اسم/صفة/رقم قومي لأحد الأشخاص، أو المسمى القانوني الجامع)';
    defendantHint = 'بيانات طرف المدعى عليه/المطعون ضده ناقصة (اسم/صفة/رقم قومي لأحد الأشخاص، أو المسمى القانوني الجامع)';
  } else {
    plaintiffOk = isFilled(caseData.plaintiff);
    plaintiffHint = 'طرف الدعوى الأول (المدعي/الطاعن) غير مسجّل';
    defendantOk = isFilled(caseData.defendant);
    defendantHint = 'طرف الدعوى الثاني (المدعى عليه/المطعون ضده) غير مسجّل';
  }

  return [
    {
      id: 'type',
      label: 'نوع القضية',
      ok: isFilled(caseData.type),
      severity: 'critical',
      hint: 'نوع القضية غير محدد',
      goTo: 'info',
    },
    {
      id: 'court',
      label: 'المحكمة',
      ok: isFilled(caseData.court),
      severity: 'critical',
      hint: 'اسم المحكمة غير مسجّل',
      goTo: 'info',
    },
    {
      id: 'number',
      label: 'رقم القيد',
      ok: isFilled(caseData.number),
      severity: 'critical',
      hint: 'رقم قيد القضية غير مسجّل',
      goTo: 'info',
    },
    {
      id: 'plaintiff',
      label: 'اسم المدعي / الطاعن',
      ok: plaintiffOk,
      severity: 'critical',
      hint: plaintiffHint,
      goTo: 'info',
    },
    {
      id: 'defendant',
      label: 'اسم المدعى عليه / المطعون ضده',
      ok: defendantOk,
      severity: 'critical',
      hint: defendantHint,
      goTo: 'info',
    },
    {
      id: 'client',
      label: 'الموكل مرتبط بالقضية',
      ok: !!client,
      severity: 'critical',
      hint: 'مفيش موكل مربوط بالقضية دي',
      goTo: 'info',
    },
    {
      id: 'court_level',
      label: 'درجة التقاضي',
      ok: isFilled(caseData.court_level),
      severity: 'warning',
      hint: 'درجة التقاضي (ابتدائي/استئناف/نقض...) غير محددة',
      goTo: 'info',
    },
    {
      id: 'circuit',
      label: 'رقم الدائرة',
      ok: isFilled(caseData.circuit_number),
      severity: 'warning',
      hint: 'رقم الدائرة غير مسجّل',
      goTo: 'info',
    },
    {
      id: 'upcoming_session',
      label: 'جلسة قادمة مسجّلة',
      ok: hasUpcomingSession,
      severity: 'warning',
      hint: 'مفيش جلسة قادمة مسجّلة للقضية دي',
      goTo: 'timeline',
    },
    {
      id: 'docs',
      label: 'مستند واحد على الأقل مرفوع',
      ok: docs.length > 0,
      severity: 'warning',
      hint: 'مفيش أي مستند مرفوع على القضية',
      goTo: 'docs',
    },
  ];
}

const severityStyle: Record<Severity, { badge: string; dot: string }> = {
  critical: { badge: 'bg-rose-500/15 text-rose-400 border-rose-500/30', dot: 'bg-rose-500' },
  warning: { badge: 'bg-amber-500/15 text-amber-400 border-amber-500/30', dot: 'bg-amber-500' },
};

function ChecklistSection({ caseData, client, sessions, docs, caseParties = [], onGoToTab }: ChecklistSectionProps) {
  const items = buildChecklist(caseData, client, sessions, docs, caseParties);
  const missing = items.filter((i) => !i.ok);
  const missingCritical = missing.filter((i) => i.severity === 'critical');
  const total = items.length;
  const doneCount = total - missing.length;
  const isComplete = missing.length === 0;

  return React.createElement('div', { className: 'space-y-4 fade-in' },
    // ── ملخص أعلى الصفحة ──
    React.createElement('div', {
      className: `rounded-2xl p-4 border ${isComplete ? 'bg-emerald-500/10 border-emerald-500/20' : missingCritical.length > 0 ? 'bg-rose-500/10 border-rose-500/20' : 'bg-amber-500/10 border-amber-500/20'}`,
    },
      React.createElement('div', { className: 'flex items-center justify-between' },
        React.createElement('div', { className: 'flex items-center gap-2.5' },
          React.createElement('span', { className: 'text-2xl' }, isComplete ? '✅' : missingCritical.length > 0 ? '⚠️' : '🟡'),
          React.createElement('div', null,
            React.createElement('p', { className: 'text-sm font-black text-white' },
              isComplete ? 'الملف مكتمل' : `${missing.length} بند ناقص`
            ),
            React.createElement('p', { className: 'text-[10px] text-slate-400 font-bold mt-0.5' },
              `${doneCount} من ${total} بند مكتمل`
            )
          )
        ),
        React.createElement('span', { className: 'text-lg font-black text-slate-300' },
          `${Math.round((doneCount / total) * 100)}%`
        )
      )
    ),

    // ── قائمة البنود ──
    React.createElement('div', { className: 'bg-premium-card border border-white/5 rounded-2xl p-4 space-y-0' },
      React.createElement('p', { className: 'text-[9px] font-black text-slate-500 mb-3 tracking-widest' }, '— بنود المراجعة —'),
      items.map((item, i) =>
        React.createElement('button', {
          key: item.id,
          type: 'button',
          disabled: item.ok || !item.goTo,
          onClick: () => { if (!item.ok && item.goTo) onGoToTab?.(item.goTo); },
          className: `w-full flex items-center justify-between gap-3 py-3 text-right ${i < items.length - 1 ? 'border-b border-white/5' : ''} ${!item.ok && item.goTo ? 'active:opacity-60' : ''}`,
        },
          React.createElement('div', { className: 'flex items-center gap-2.5' },
            React.createElement('span', { className: `w-2 h-2 rounded-full shrink-0 ${item.ok ? 'bg-emerald-500' : severityStyle[item.severity].dot}` }),
            React.createElement('span', { className: `text-xs font-bold ${item.ok ? 'text-slate-300' : 'text-white'}` }, item.label)
          ),
          item.ok
            ? React.createElement('span', { className: 'text-emerald-400 text-sm' }, '✓')
            : React.createElement('span', { className: `text-[9px] font-black px-2 py-1 rounded-lg border ${severityStyle[item.severity].badge}` },
                item.severity === 'critical' ? 'ناقص' : 'مستحسن'
              )
        )
      )
    ),

    // ── تفاصيل النواقص (hints) ──
    missing.length > 0 && React.createElement('div', { className: 'bg-premium-card border border-white/5 rounded-2xl p-4 space-y-2.5' },
      React.createElement('p', { className: 'text-[9px] font-black text-slate-500 mb-1 tracking-widest' }, '— تفاصيل —'),
      missing.map((item) =>
        React.createElement('div', { key: item.id, className: 'flex items-start gap-2' },
          React.createElement('span', { className: `mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${severityStyle[item.severity].dot}` }),
          React.createElement('p', { className: 'text-[11px] text-slate-400 leading-relaxed' }, item.hint)
        )
      )
    )
  );
}

export default ChecklistSection;
