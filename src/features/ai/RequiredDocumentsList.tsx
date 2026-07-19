import React, { useState, useEffect, useMemo } from 'react';
import { CasePicker, EmptyState, SummaryBanner, SectionCard, CopyButton, DisclaimerNote } from '../../shared/ui/TaskResultKit';
import type { MappedCase } from '../../hooks/useAppData';

// ─────────────────────────────────────────────────────────
//  RequiredDocumentsList — المرحلة 1 من خطة المساعد الذكي
//  ("قائمة المستندات المطلوبة حسب نوع القضية"، sanad-ai-assistant-plan-9.md، قسم 4.1).
//  Rule-based بالكامل — صفر استدعاء AI. بيصنّف نوع القضية بمطابقة
//  كلمات مفتاحية (عشان يغطي أنواع القضايا المختلفة لكل دولة في
//  constants.ts) ويرجّع قائمة مستندات أساسية + حسب نوع القضية.
//  التأشير (تم توفيره) بيتسجّل محليًا لجلسة العرض بس، مش في قاعدة
//  البيانات — القائمة استرشادية عامة مش بديل للمراجعة القانونية.
// ─────────────────────────────────────────────────────────

interface RequiredDocumentsListProps {
  cases: MappedCase[];
}

interface DocCategory {
  key: string;
  label: string;
  icon: string;
  docs: string[];
}

const BASE_DOCS: string[] = [
  'توكيل رسمي (أو تفويض) من الموكل',
  'بطاقة الرقم القومي / الهوية للموكل',
  'عقد الاتفاق على الأتعاب (إن وجد)',
  'صحيفة الدعوى أو العريضة الافتتاحية (لو القضية مرفوعة بالفعل)',
];

// ترتيب الفحص مهم: الأخص أولاً (مثلاً "أحوال شخصية" قبل مطابقة عامة)
const CATEGORY_RULES: { keywords: string[]; category: DocCategory }[] = [
  {
    keywords: ['جنائي', 'جزائي'],
    category: {
      key: 'criminal', label: 'جنائي / جزائي', icon: '⚖️',
      docs: ['محضر الشرطة أو النيابة', 'تقرير الطب الشرعي (لو وجد)', 'إثبات تقديم البلاغ', 'إفادات الشهود المتاحة'],
    },
  },
  {
    keywords: ['أحوال شخصية', 'أسري', 'أسرة'],
    category: {
      key: 'personal_status', label: 'أحوال شخصية', icon: '👨‍👩‍👧',
      docs: ['قسيمة الزواج أو الطلاق', 'شهادات ميلاد الأبناء', 'بطاقات الرقم القومي لطرفي النزاع', 'إثبات الدخل (في دعاوى النفقة)'],
    },
  },
  {
    keywords: ['عقاري'],
    category: {
      key: 'real_estate', label: 'عقاري', icon: '🏠',
      docs: ['عقد الملكية أو البيع', 'مستخرج رسمي من الشهر العقاري / السجل العقاري', 'رخصة البناء (لو متعلقة بالنزاع)', 'تقرير معاينة أو خبرة هندسية (لو وجد)'],
    },
  },
  {
    keywords: ['عمالي'],
    category: {
      key: 'labor', label: 'عمالي', icon: '👷',
      docs: ['عقد العمل', 'كشوف الأجور / التأمينات الاجتماعية', 'إنذار الفصل أو خطاب الاستقالة (لو وجد)', 'شهادة الخبرة'],
    },
  },
  {
    keywords: ['إداري'],
    category: {
      key: 'administrative', label: 'إداري', icon: '🏛️',
      docs: ['القرار الإداري محل الطعن', 'التظلم الإداري السابق (لو قُدّم)', 'إثبات تاريخ العلم بالقرار'],
    },
  },
  {
    keywords: ['ضرائب', 'جمارك'],
    category: {
      key: 'tax', label: 'ضرائب وجمارك', icon: '🧾',
      docs: ['الإقرار الضريبي', 'قرار المصلحة أو اللجنة محل الطعن', 'الدفاتر والمستندات المحاسبية'],
    },
  },
  {
    keywords: ['دستوري'],
    category: {
      key: 'constitutional', label: 'دستوري', icon: '📜',
      docs: ['الحكم أو القرار محل الدفع بعدم الدستورية', 'مذكرة الدفع الأصلية المُقدَّمة في الدعوى الموضوعية'],
    },
  },
  {
    keywords: ['ملكية فكرية'],
    category: {
      key: 'ip', label: 'ملكية فكرية', icon: '💡',
      docs: ['شهادة تسجيل العلامة التجارية / البراءة', 'إثبات الاستخدام أو النشر', 'محضر إثبات حالة (لو وجد تعدٍّ)'],
    },
  },
  {
    keywords: ['بنكي', 'مصرفي'],
    category: {
      key: 'banking', label: 'بنكي / مصرفي', icon: '🏦',
      docs: ['كشف الحساب البنكي', 'عقد التسهيل الائتماني أو القرض'],
    },
  },
  {
    keywords: ['بحري'],
    category: {
      key: 'maritime', label: 'بحري', icon: '🚢',
      docs: ['سند الشحن', 'عقد النقل البحري'],
    },
  },
  {
    keywords: ['تحكيم'],
    category: {
      key: 'arbitration', label: 'تحكيم', icon: '🤝',
      docs: ['اتفاق التحكيم', 'لائحة الدعوى التحكيمية'],
    },
  },
  {
    keywords: ['تجاري', 'استثماري'],
    category: {
      key: 'commercial', label: 'تجاري', icon: '🏢',
      docs: ['السجل التجاري لطرفي النزاع', 'العقد التجاري محل النزاع', 'كشوف حساب / فواتير', 'تقرير خبير حسابي (لو وجد)'],
    },
  },
  {
    // fallback: مدني / مدني عام / أي نوع تاني
    keywords: ['مدني'],
    category: {
      key: 'civil', label: 'مدني', icon: '📄',
      docs: ['سند الحق محل النزاع (عقد / إيصال / سند دين)', 'المراسلات أو الإنذارات السابقة', 'أي مستندات إثبات (فواتير، محررات)'],
    },
  },
];

const GENERIC_CATEGORY: DocCategory = {
  key: 'generic', label: 'عام', icon: '📄',
  docs: ['سند الحق أو العقد محل النزاع (لو وجد)', 'أي مراسلات أو إنذارات سابقة متعلقة بالنزاع'],
};

function categorize(caseType: string | null | undefined): DocCategory {
  const t = (caseType || '').trim();
  if (!t) return GENERIC_CATEGORY;
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((kw) => t.includes(kw))) return rule.category;
  }
  return GENERIC_CATEGORY;
}

function RequiredDocumentsList({ cases }: RequiredDocumentsListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(cases[0]?.id || null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const selectedCase = cases.find((c) => c.id === selectedId) || null;
  const category = useMemo(() => categorize(selectedCase?.type), [selectedCase?.type]);
  const allDocs = useMemo(() => [...BASE_DOCS, ...category.docs], [category]);

  useEffect(() => {
    setChecked({});
  }, [selectedId]);

  const toggle = (doc: string) => setChecked((p) => ({ ...p, [doc]: !p[doc] }));

  const buildListText = () => {
    if (!selectedCase) return '';
    const lines = [
      `المستندات المطلوبة — ${selectedCase.title} (${category.label})`,
      ...allDocs.map((d) => `${checked[d] ? '✓' : '☐'} ${d}`),
    ];
    return lines.join('\n');
  };

  if (cases.length === 0) {
    return React.createElement(EmptyState, { icon: '📑', title: 'لا توجد قضايا مسجّلة' });
  }

  const doneCount = allDocs.filter((d) => checked[d]).length;

  return React.createElement('div', { className: 'flex-1 flex flex-col min-h-0' },
    // ── منتقي القضية ──
    React.createElement(CasePicker, { cases, selectedId, onSelect: setSelectedId }),

    React.createElement('div', { className: 'flex-1 overflow-y-auto no-scrollbar px-4 py-3 space-y-4' },
      !selectedCase
        ? React.createElement('p', { className: 'text-xs text-slate-500 py-8 text-center' }, 'اختر قضية لعرض المستندات المطلوبة')
        : React.createElement(React.Fragment, null,

            // ── ملخص أعلى الصفحة ──
            React.createElement(SummaryBanner, {
              icon: category.icon,
              title: `تصنيف: ${category.label}`,
              subtitle: `${doneCount} من ${allDocs.length} متوفّر`,
              tone: 'info',
            }),

            // ── قائمة المستندات ──
            React.createElement(SectionCard, { title: 'مستندات أساسية (كل القضايا)' },
              BASE_DOCS.map((doc, i) => React.createElement('button', {
                key: doc,
                type: 'button',
                onClick: () => toggle(doc),
                className: `w-full flex items-center gap-2.5 py-2.5 text-right ${i < BASE_DOCS.length - 1 ? 'border-b border-white/5' : ''}`,
              },
                React.createElement('span', { className: `w-4 h-4 rounded-md border shrink-0 flex items-center justify-center text-[9px] font-black ${checked[doc] ? 'bg-emerald-500 border-emerald-500 text-premium-bg' : 'border-white/20 text-transparent'}` }, '✓'),
                React.createElement('span', { className: `text-xs font-bold ${checked[doc] ? 'text-slate-500 line-through' : 'text-white'}` }, doc)
              ))
            ),

            category.key !== 'generic' && React.createElement(SectionCard, { title: `مستندات خاصة بنوع "${category.label}"` },
              category.docs.map((doc, i) => React.createElement('button', {
                key: doc,
                type: 'button',
                onClick: () => toggle(doc),
                className: `w-full flex items-center gap-2.5 py-2.5 text-right ${i < category.docs.length - 1 ? 'border-b border-white/5' : ''}`,
              },
                React.createElement('span', { className: `w-4 h-4 rounded-md border shrink-0 flex items-center justify-center text-[9px] font-black ${checked[doc] ? 'bg-emerald-500 border-emerald-500 text-premium-bg' : 'border-white/20 text-transparent'}` }, '✓'),
                React.createElement('span', { className: `text-xs font-bold ${checked[doc] ? 'text-slate-500 line-through' : 'text-white'}` }, doc)
              ))
            ),

            // ── تنبيه ──
            React.createElement(DisclaimerNote, { text: 'قائمة استرشادية عامة حسب تصنيف نوع القضية — راجعها وعدّلها حسب تفاصيل القضية الفعلية.' }),

            // ── نسخ القائمة ──
            React.createElement(CopyButton, {
              getText: buildListText,
              idleLabel: '📋 نسخ قائمة المستندات',
              copiedLabel: 'اتنسخت القائمة',
            }),
          )
    )
  );
}

export default RequiredDocumentsList;
