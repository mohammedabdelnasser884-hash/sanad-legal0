import { useState, useEffect, useCallback, useRef } from 'react';
import { db } from '../../../supabaseClient';
import { toast } from '../../../shared/lib/notifications';
import { resolveStorageUrl } from '../../../shared/lib/storage';
import { escapeHtml } from '../../../shared/lib/sanitize';
import { safeUpdate, logActivity } from '../../../shared/lib/dataAccess';
import { PDF_FONT_FAMILY, PDF_FONT_LINK } from '../../../shared/lib/pdf';
import { loadOfficeSetting } from '../../../constants';
import { formatArDate } from '../../../shared/ui/arabicLocale';
import type { ClientRow, ProfileRow, CaseNoteRow } from '../../../types';
import type { MappedCase } from '../../../hooks/useAppData';
import type { PartySide } from '@/shared/parties/partyTypes';
import { useCaseSessions } from './useCaseSessions';
import { useCaseDocuments } from './useCaseDocuments';
import type { CaseDocWithUrl } from './useCaseDocuments';

// نُبقي إعادة تصدير النوع من هنا عشان أي ملف تاني بيستورده من
// './hooks/useCaseDetailActions' (زي DocsSection.tsx وInfoSection.tsx)
// يفضل شغال من غير أي تعديل في مسار الاستيراد.
export type { CaseDocWithUrl };

// ⚡ NEW (خطة تعدد الأطراف، مرحلة 8 — 23 يوليو 2026): شكل صف case_parties
// كما بيرجع من الداتابيز — نفس تعريف CasePartyRow الموجود بالفعل (منسوخ)
// في EditCaseModal.tsx وStandaloneSessionDetailModal.tsx (case_parties لسه
// مش موجودة في database.types.ts، فمفيش طريقة نولّد بيها الأنواع من هنا).
// مُصدّرة من هنا عشان InfoSection.tsx يستخدمها للعرض بدل ما تتكرر نسخة
// تالتة من نفس التعريف.
export interface CasePartyRow {
    id: string;
    side: PartySide;
    is_client: boolean;
    name: string;
    capacity: string;
    national_id: string | null;
    address: string | null;
    power_of_attorney: string | null;
    client_id: string | null;
    sort_order: number;
}

export function useCaseDetailActions(
  caseData: MappedCase,
  onUpdate: ((newStatus: string) => void) | undefined,
  onDelete: ((caseId: string) => void | Promise<void>) | undefined,
  onNotify: ((msg: string) => void | Promise<void>) | undefined,
  setShowStatusPicker?: (v: boolean) => void,
  client?: ClientRow | null,
  profile?: ProfileRow | null
) {
  // ✅ FIX: caseData بقى MappedCase (مش CaseRow خام) — يعني .type و.number
  // موجودين فعليًا كحقول حقيقية، وماحتاجناش أي كاست أو `any` بعد كده.
  // (كان فيه هنا قبل كده باگ موثّق: التوقيع كان بيقول CaseRow بينما القيمة
  // الفعلية زمن التشغيل دايمًا MappedCase، فكان لازم كاست `as unknown as any`
  // وأثّر على نداءات logActivity تحت اللي كانت بتقرا caseData.case_type
  // (حقل مش موجود أصلاً في MappedCase) فبترجع undefined دايمًا — اتصلح
  // تحت باستخدام caseData.type بدل caseData.case_type.)

  const [notes, setNotes] = useState<CaseNoteRow[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  // ⚡ NEW (خطة تعدد الأطراف، مرحلة 8): كل صفوف case_parties الخاصة
  // بالقضية دي (case_id = caseData.id)، مرتبة بـ sort_order — بتتعرض في
  // InfoSection.tsx بدل عمودي plaintiff/defendant القديمين لو موجودة.
  // القضايا القديمة (قبل مرحلة 4، أو لسه معملهاش تعديل بالفورم الجديد)
  // هترجع array فاضية، وInfoSection بيرجع لعرض الأعمدة القديمة (fallback
  // كامل، صفر تغيير سلوك).
  const [caseParties, setCaseParties] = useState<CasePartyRow[]>([]);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);
  const [showAddNote, setShowAddNote] = useState(false);
  const [savingNote, setSavingNote] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [changingStatus, setChangingStatus] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showWhatsApp, setShowWhatsApp] = useState(false);
  const [officeWhatsAppName, setOfficeWhatsAppName] = useState('');
  const [confirmDeleteNote, setConfirmDeleteNote] = useState<{ id: string; preview: string } | null>(null);

  // ── تجميع هوكي الجلسات والمستندات ──
  // fetchSessions (تحت) بتجيب الجلسات + الملاحظات + المستندات مع بعض في نفس
  // النداء (زي الأصل بالظبط). عشان هوكي useCaseSessions/useCaseDocuments
  // يقدروا ينادوها بعد أي إضافة/تعديل/حذف من غير مشكلة ترتيب استدعاء الهوكس
  // (fetchSessions محتاجة setSessions/setDocs الراجعين من الهوكين نفسهم)،
  // بنمرّرلهم غلاف ثابت بينادي أحدث نسخة من fetchSessions عن طريق ref.
  const refetchAllRef = useRef<() => Promise<void>>(async () => {});
  const refetchAll = useCallback(() => refetchAllRef.current(), []);

  const sessionsHook = useCaseSessions(caseData, client, profile, onNotify, refetchAll);
  const docsHook = useCaseDocuments(caseData, client, profile, refetchAll);
  const { sessions, setSessions } = sessionsHook;
  const { docs, setDocs } = docsHook;

  const fetchSessions = useCallback(async () => {
    setLoadingSessions(true);
    const { data } = await db.from('case_sessions').select('*').eq('case_id', caseData.id).order('session_date', { ascending: false });
    setSessions(data || []);
    const { data: nd } = await db.from('case_notes').select('*').eq('case_id', caseData.id).order('created_at', { ascending: false });
    setNotes(nd || []);
    const { data: dd } = await db.from('case_documents').select('*').eq('case_id', caseData.id).order('created_at', { ascending: false });
    // ⚠️ case-docs بقى باكت private — نولّد رابط موقّع طازة لكل مستند.
    const ddWithUrls: CaseDocWithUrl[] = await Promise.all((dd || []).map(async (d) => ({
      ...d,
      file_url: await resolveStorageUrl('case-docs', d.storage_path || d.file_url),
    })));
    setDocs(ddWithUrls);
    // ⚡ NEW (مرحلة 8): case_parties بقت مضافة في database.types.ts (خطة
    // تعدد الأطراف، مرحلة 1) — مفيش داعي لكاست 'as cases' تاني هنا. فشل
    // الاستعلام (مشكلة اتصال) بيرجّع array فاضية بدل ما يمنع تحميل باقي
    // التاب — InfoSection.tsx هيرجع لعرض الأعمدة القديمة تلقائيًا في الحالة دي.
    const { data: pd, error: partiesErr } = await db.from('case_parties')
      .select('*')
      .eq('case_id', caseData.id)
      .order('sort_order', { ascending: true });
    setCaseParties(partiesErr ? [] : ((pd as unknown as CasePartyRow[]) || []));
    setLoadingSessions(false);
  }, [caseData.id, setSessions, setDocs]);

  useEffect(() => { refetchAllRef.current = fetchSessions; }, [fetchSessions]);
  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  const handleExportPdf = async () => {
    setExportingPdf(true);
    const MONTHS_FULL = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const now = new Date();
    const dateStr = now.getDate() + ' ' + MONTHS_FULL[now.getMonth()] + ' ' + now.getFullYear();

    // جلب بيانات المكتب
    const [officeName, officeAddress, officePhone, officeEmail, officeLogo] = await Promise.all([
      loadOfficeSetting('office_name'),
      loadOfficeSetting('office_address'),
      loadOfficeSetting('office_phone'),
      loadOfficeSetting('office_email'),
      loadOfficeSetting('office_logo'),
    ]);
    const name = escapeHtml(officeName || '');
    const address = escapeHtml(officeAddress || '');
    const phone = escapeHtml(officePhone || '');
    const email = escapeHtml(officeEmail || '');
    const contactLine = [address, phone, email].filter(Boolean).join(' | ');

    // شعار سند الرسمي SVG (يُستخدم لما مفيش شعار مكتب)
    const sanadSvg = `<svg width="32" height="32" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
          <line x1="6" y1="13" x2="34" y2="13" stroke="#D4AF37" stroke-width="4.5" stroke-linecap="round"/>
          <line x1="9.5" y1="21" x2="34" y2="21" stroke="#D4AF37" stroke-width="4.5" stroke-linecap="round"/>
          <line x1="13" y1="29" x2="34" y2="29" stroke="#D4AF37" stroke-width="4.5" stroke-linecap="round"/>
          <line x1="6" y1="13" x2="6" y2="32" stroke="#D4AF37" stroke-width="4.5" stroke-linecap="round"/>
          <circle cx="6" cy="13" r="4.5" fill="#D4AF37"/>
          <circle cx="6" cy="33" r="3" fill="#D4AF37" opacity="0.38"/>
        </svg>`;

    const logoHtml = officeLogo
      ? `<img src="${officeLogo}" style="width:56px;height:56px;object-fit:contain;border-radius:8px;border:1px solid rgba(255,255,255,0.2);" />`
      : `<div style="width:48px;height:48px;border-radius:10px;background:linear-gradient(135deg,#0d1a2e,#0B1320);border:1px solid rgba(212,175,55,0.25);display:flex;align-items:center;justify-content:center;">${sanadSvg}</div>`;

    const displayName = name || 'سَنَد'; // name متهرّبة فعلًا أعلى الدالة
    const displaySub = name ? '' : 'نظام التشغيل القانوني';

    // تنسيق رقم القيد
    const caseNum = (() => { const p = (caseData.number || '').split('/'); return p.length === 2 ? p[0] + ' لسنة ' + p[1] : caseData.number || '—'; })();

    // ⚠️ تهريب كل قيمة جاية من المستخدم (عنوان قضية، خصوم، جلسات، ملاحظات،
    // أسماء ملفات...) قبل دمجها في HTML خام — وإلا ممكن أي حقل من دول
    // يحمل كود (مثلاً <img onerror=...>) ويتنفذ في نافذة الطباعة (XSS مخزّنة).
    const safeCaseTitle = escapeHtml(caseData.title || '');
    const safeCaseStatus = escapeHtml(caseData.status || 'نشطة');
    const safeCaseNum = escapeHtml(caseNum);
    const safeCaseType = escapeHtml(caseData.type || '—');
    const safeCaseCourt = escapeHtml(caseData.court || '—');
    const safeClientName = escapeHtml(client?.full_name || '—');
    // ⚡ FIX: نفس مبدأ CaseDetailView.tsx/InfoSection.tsx — نقرا الصفة من
    // عمود plaintiff_role/defendant_role المخصص، ونرجع لـ regex بس كـ
    // fallback لصفوف قديمة لسه معندهاش العمود متعبي.
    // ⚠️ وبيتقسم بس لو اللي جوه القوسين كلمة صفة قانونية معروفة، عشان
    // مايتقطعش جزء من اسم شركة زي "(ش.م.م)" في ملف PDF رسمي.
    const knownCapacityPattern = /مدعي|مدعى عليه|مستأنف|طاعن|مطعون ضده|متهم|مجني عليه|محكوم عليه|خصم|مدين|دائن|موكل|وكيل|طالب|مطلوب ضده|منفذ ضده/;
    const splitParty = (val: string | null | undefined) => {
        if(!val) return null;
        const m = val.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
        if(m && knownCapacityPattern.test(m[2])) return {name:m[1].trim(), capacity:m[2].trim()};
        return {name:val, capacity:''};
    };
    const plaintiffParty = caseData.plaintiff
        ? (caseData.plaintiff_role ? {name: caseData.plaintiff, capacity: caseData.plaintiff_role} : splitParty(caseData.plaintiff))
        : null;
    const defendantParty = caseData.defendant
        ? (caseData.defendant_role ? {name: caseData.defendant, capacity: caseData.defendant_role} : splitParty(caseData.defendant))
        : null;
    const safePlaintiffName = escapeHtml(plaintiffParty?.name || '');
    const safePlaintiffLabel = escapeHtml(plaintiffParty?.capacity || 'المدعي / الطاعن');
    const safeDefendantName = escapeHtml(defendantParty?.name || '');
    const safeDefendantLabel = escapeHtml(defendantParty?.capacity || 'المدعى عليه / المطعون ضده');

    // ⚡ NEW (خطة تعدد الأطراف، مرحلة 10 — 23 يوليو 2026): لو القضية عندها
    // صفوف case_parties (جاية بالفعل من fetchSessions فوق، مرحلة 8)، بنعرض
    // كل الأطراف (كل مدعي/مدعى عليه بصفته وعلامة "— موكل" لو is_client) في
    // قسم مستقل بدل حقلي plaintiffParty/defendantParty المفردين في الهيدر —
    // نفس منطق التبويب/التصفية المستخدم في InfoSection.tsx (مرحلة 8) بالحرف.
    // لو caseParties فاضية (قضية قديمة قبل مرحلة 4، أو لسه معملهاش تعديل
    // بالفورم الجديد)، hasCaseParties بتبقى false وهنرجع بالكامل لعرض
    // plaintiffParty/defendantParty القديم في header-fields — صفر تغيير
    // سلوك في المسار القديم.
    const safeCaseParties = caseParties.map((p) => ({
        side: p.side,
        isClient: !!p.is_client,
        name: escapeHtml(p.name || ''),
        capacity: escapeHtml(p.capacity || (p.side === 'plaintiff' ? 'المدعي / الطاعن' : 'المدعى عليه / المطعون ضده')),
    }));
    const partyPlaintiffs = safeCaseParties.filter((p) => p.side === 'plaintiff');
    const partyDefendants = safeCaseParties.filter((p) => p.side === 'defendant');
    const hasCaseParties = safeCaseParties.length > 0;

    // ⚡ NEW (خطة تطوير أطراف الدعوى، مرحلة 6 — 24 يوليو 2026): المسمى
    // القانوني الجامع لكل جهة (مخزّن على مستوى القضية نفسها منذ مرحلة 1
    // من نفس الخطة) — بيُستخدم كعنوان فوق قائمة الأشخاص في تقرير الـ PDF
    // بس لما يكون عدد أشخاص الجهة أكتر من واحد (مطابقةً لنفس شرط الظهور
    // في فورم الإدخال وInfoSection.tsx، بند 5-2 من التقرير).
    const safePlaintiffLegalTitle = escapeHtml((caseData.plaintiff_legal_title || '').trim());
    const safeDefendantLegalTitle = escapeHtml((caseData.defendant_legal_title || '').trim());

    // بيبني بلوك عرض جهة واحدة (مدعي أو مدعى عليه) داخل قسم "أطراف الدعوى":
    //   - شخص واحد (الحالة الغالبة): بلوك حقل مفرد، **بلا أي تغيير عن الشكل
    //     القديم** (label = الصفة + علامة "— موكل"، span = الاسم).
    //   - أكتر من شخص: بلوك واحد يمتد بعرض الصف كامل، بعنوان 🔖 المسمى
    //     القانوني (لو موجود) فوق قائمة مضغوطة سطر لكل شخص — بدل ما كان
    //     بيتكرر بلوك حقل كامل لكل شخص (تفاديًا لإطالة التقرير غير الضرورية
    //     عند تعدد الأشخاص، حسب اشتراط بند 5-1 من التقرير).
    const renderPartySideBlock = (
      persons: { name: string; capacity: string; isClient: boolean }[],
      legalTitle: string
    ): string => {
      if (persons.length === 0) return '';
      if (persons.length === 1) {
        const p = persons[0];
        return `<div class="field"><label>${p.capacity}${p.isClient ? ' — موكل' : ''}</label><span>${p.name}</span></div>`;
      }
      const titleLine = legalTitle ? `<div class="party-group-title">🔖 ${legalTitle}</div>` : '';
      const lines = persons.map((p) =>
        `<div class="party-person-line">${p.name}${p.capacity ? ` <span class="party-person-capacity">(${p.capacity})</span>` : ''}${p.isClient ? ' <span class="party-person-client">— موكل</span>' : ''}</div>`
      ).join('');
      return `<div class="party-group-box">${titleLine}${lines}</div>`;
    };

    // ⚡ FIX (19 يوليو 2026): بيانات الجلسة/السكرتير كانت بتتحفظ في القضية
    // بس مكانتش بتظهر في تقرير PDF خالص — بنضيفها كقسم مستقل تحت الهيدر.
    const safeSessionTimeLabel = caseData.session_time === 'صباحي' ? '🌅 صباحي' : caseData.session_time === 'مسائي' ? '🌆 مسائي' : '';
    const safeSessionHall = escapeHtml(caseData.session_hall || '');
    const safeSecretaryHall = escapeHtml(caseData.secretary_hall || '');
    const safeSecretaryName = escapeHtml(caseData.secretary_name || '');
    const safeSecretaryMobile = escapeHtml(caseData.secretary_mobile || '');
    const hasExtraInfo = !!(safeSessionTimeLabel || safeSessionHall || safeSecretaryHall || safeSecretaryName || safeSecretaryMobile);

    const win = window.open('', '_blank');
    if (!win) { setExportingPdf(false); return; }

    const html = `<!DOCTYPE html><html lang="ar" dir="rtl"><head>
<meta charset="UTF-8"><title>ملف القضية - ${safeCaseTitle}</title>
${PDF_FONT_LINK}
<style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:${PDF_FONT_FAMILY};background:#f8f9fa;color:#1a1a2e;padding:20px;}
  .page{max-width:800px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);}
  .header{background:linear-gradient(135deg,#1a1a2e,#16213e);color:#D4AF37;padding:28px 32px;}
  .header-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;}
  .office-info{display:flex;align-items:center;gap:12px;}
  .office-name{font-size:16px;font-weight:900;color:#D4AF37;}
  .office-contact{font-size:10px;color:rgba(212,175,55,0.6);margin-top:2px;}
  .case-title{font-size:20px;font-weight:900;color:#fff;text-align:center;}
  .case-sub{font-size:11px;color:rgba(212,175,55,0.7);text-align:center;margin-top:6px;}
  .badge{display:inline-block;padding:4px 14px;border-radius:20px;border:1px solid #D4AF37;color:#D4AF37;font-size:11px;margin-top:8px;}
  .header-fields{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:18px;padding-top:16px;border-top:1px solid rgba(212,175,55,0.2);}
  .header-field{background:rgba(255,255,255,0.06);border:1px solid rgba(212,175,55,0.15);border-radius:8px;padding:10px 12px;}
  .header-field label{font-size:9px;color:rgba(212,175,55,0.65);display:block;margin-bottom:3px;font-weight:700;}
  .header-field span{font-size:12px;font-weight:700;color:#fff;}
  .gold-bar{height:3px;background:linear-gradient(90deg,#D4AF37,#E8C84A,#D4AF37);}
  .section{padding:20px 24px;border-bottom:1px solid #f0f0f0;}
  .section h2{font-size:13px;font-weight:900;color:#1a1a2e;margin-bottom:14px;padding-bottom:6px;border-bottom:2px solid #D4AF37;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
  .field{background:#f8f9fa;border-radius:8px;padding:10px 12px;}
  .field label{font-size:9px;color:#888;display:block;margin-bottom:3px;font-weight:700;}
  .field span{font-size:12px;font-weight:700;color:#1a1a2e;}
  .party-group-box{grid-column:1/-1;background:#f8f9fa;border-radius:8px;padding:10px 12px;}
  .party-group-title{font-size:11px;font-weight:900;color:#1a1a2e;margin-bottom:6px;padding-bottom:6px;border-bottom:1px solid #e8e8e8;}
  .party-person-line{font-size:11px;font-weight:700;color:#1a1a2e;padding:2px 0;}
  .party-person-capacity{font-size:10px;font-weight:600;color:#888;}
  .party-person-client{font-size:10px;font-weight:700;color:#D4AF37;}
  .session-card{border:1px solid #e8e8e8;border-right:4px solid #D4AF37;border-radius:8px;padding:12px;margin-bottom:8px;}
  .session-date{font-size:12px;font-weight:900;color:#D4AF37;margin-bottom:6px;}
  .session-label{font-size:9px;color:#888;font-weight:700;margin-top:6px;}
  .session-val{font-size:11px;color:#333;margin-top:2px;line-height:1.6;}
  .doc-row{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid #eee;border-radius:8px;margin-bottom:5px;}
  .doc-name{font-size:11px;font-weight:700;color:#1a1a2e;}
  .doc-cat{font-size:9px;color:#888;}
  .note-card{background:#f8f9fa;border-radius:8px;padding:10px;margin-bottom:6px;border-right:3px solid #94a3b8;}
  .note-text{font-size:11px;color:#333;line-height:1.7;}
  .note-date{font-size:9px;color:#888;margin-top:4px;}
  .footer{background:#f8f9fa;padding:14px 24px;text-align:center;font-size:9px;color:#888;}
  @media print{body{padding:0;}.page{box-shadow:none;border-radius:0;}}
</style></head><body>
<div class="page">
  <div class="header">
    <div class="header-top">
      <div class="office-info">
        ${logoHtml}
        <div>
          <div class="office-name">${displayName}</div>
          ${displaySub ? `<div style="font-size:9px;color:rgba(212,175,55,0.5);margin-top:1px;">${displaySub}</div>` : ''}
          ${contactLine ? `<div class="office-contact">${contactLine}</div>` : ''}
        </div>
      </div>
      <div style="text-align:left">
        <div style="font-size:10px;color:rgba(212,175,55,0.6);">تاريخ الإصدار</div>
        <div style="font-size:12px;font-weight:700;color:#D4AF37;">${dateStr}</div>
      </div>
    </div>
    <div style="border-top:1px solid rgba(212,175,55,0.2);padding-top:16px;text-align:center;">
      <div class="case-title">⚖️ ${safeCaseTitle}</div>
      <div class="case-sub">ملف القضية الكامل</div>
      <div class="badge">${safeCaseStatus}</div>
    </div>
    <div class="header-fields">
      <div class="header-field"><label>رقم القيد</label><span>${safeCaseNum}</span></div>
      <div class="header-field"><label>نوع القضية</label><span>${safeCaseType}</span></div>
      <div class="header-field"><label>المحكمة</label><span>${safeCaseCourt}</span></div>
      <div class="header-field"><label>الموكل</label><span>${safeClientName}</span></div>
      ${!hasCaseParties && plaintiffParty ? `<div class="header-field"><label>${safePlaintiffLabel}</label><span>${safePlaintiffName}</span></div>` : ''}
      ${!hasCaseParties && defendantParty ? `<div class="header-field"><label>${safeDefendantLabel}</label><span>${safeDefendantName}</span></div>` : ''}
    </div>
  </div>
  <div class="gold-bar"></div>

  ${hasCaseParties ? `
  <div class="section">
    <h2>⚖️ أطراف الدعوى</h2>
    <div class="grid2">
      ${renderPartySideBlock(partyPlaintiffs, safePlaintiffLegalTitle)}
      ${renderPartySideBlock(partyDefendants, safeDefendantLegalTitle)}
    </div>
  </div>` : ''}

  ${hasExtraInfo ? `
  <div class="section">
    <h2>🗂 بيانات إضافية</h2>
    <div class="grid2">
      ${safeSessionTimeLabel ? `<div class="field"><label>ميعاد الجلسة</label><span>${safeSessionTimeLabel}</span></div>` : ''}
      ${safeSessionHall ? `<div class="field"><label>الطابق وقاعة الجلسة</label><span>${safeSessionHall}</span></div>` : ''}
      ${safeSecretaryHall ? `<div class="field"><label>قاعة سكرتير الجلسة</label><span>${safeSecretaryHall}</span></div>` : ''}
      ${safeSecretaryName ? `<div class="field"><label>اسم سكرتير الجلسة</label><span>${safeSecretaryName}</span></div>` : ''}
      ${safeSecretaryMobile ? `<div class="field"><label>موبايل سكرتير الجلسة</label><span>${safeSecretaryMobile}</span></div>` : ''}
    </div>
  </div>` : ''}

  ${sessions.length > 0 ? `
  <div class="section">
    <h2>🗓 الجلسات (${sessions.length})</h2>
    ${sessions.map((s) => `
    <div class="session-card">
      <div class="session-date">📅 ${escapeHtml(s.session_date || '')}</div>
      ${s.description ? `<div class="session-label">ما جرى</div><div class="session-val">${escapeHtml(s.description)}</div>` : ''}
      ${s.result ? `<div class="session-label">النتيجة</div><div class="session-val">${escapeHtml(s.result)}</div>` : ''}
      ${s.next_action ? `<div class="session-label">الإجراء القادم</div><div class="session-val">${escapeHtml(s.next_action)}</div>` : ''}
    </div>`).join('')}
  </div>` : ''}

  ${notes.length > 0 ? `
  <div class="section">
    <h2>📝 الملاحظات (${notes.length})</h2>
    ${notes.map((n) => `
    <div class="note-card">
      <div class="note-text">${escapeHtml(n.content || '')}</div>
      <div class="note-date">${n.created_at ? formatArDate(n.created_at) : ''}</div>
    </div>`).join('')}
  </div>` : ''}

  ${docs.length > 0 ? `
  <div class="section">
    <h2>📁 المستندات (${docs.length})</h2>
    ${docs.map((d) => `
    <div class="doc-row">
      <div style="font-size:20px">${/\.pdf$/i.test(d.original_name || '') ? '📄' : /\.(jpg|jpeg|png|gif|webp)$/i.test(d.original_name || '') ? '🖼' : /\.(doc|docx)$/i.test(d.original_name || '') ? '📝' : '📎'}</div>
      <div><div class="doc-name">${escapeHtml(d.file_name || '')}</div><div class="doc-cat">${escapeHtml(d.category || 'مستند')}</div></div>
    </div>`).join('')}
  </div>` : ''}

  <div class="footer">🔒 ملف سري — ${displayName}${contactLine ? ' | ' + contactLine : ''} | تاريخ الإصدار: ${dateStr}</div>
</div>
<script>window.onload=()=>{window.print();}</script>
</body></html>`;
    win.document.write(html);
    win.document.close();
    setExportingPdf(false);
    toast('📄 جاري فتح ملف الطباعة...');
  };

  const handleAddNote = async () => {
    if (!noteText.trim()) return;
    setSavingNote(true);
    // 🆕 المرحلة 6 (توسيع الأوفلاين — H-3، تكملة ثانية): __dbWrite بدل
    // db.from(...).insert() المباشر — نفس نمط useRemindersTab.ts بالظبط.
    // case_notes مالهاش FK فعلي على case_id (مؤكَّد بالقسم 0.1 من التقرير)،
    // ومفيش سيناريو عملي لملاحظة بتتضاف لقضية لسه تمبيد (الشاشة دي أصلاً
    // مبتفتحش غير لقضية حقيقية متزامنة)، فمفيش داعي لـ _offlineFkTempId هنا.
    const { error, offline, queued } = await window.__dbWrite({
      type: 'INSERT', table: 'case_notes', data: {
        case_id: caseData.id,
        content: noteText.trim(),
      }
    });
    setSavingNote(false);
    if (offline && queued) {
      toast('📥 الملاحظة محفوظة محلياً — ستُزامن عند عودة الإنترنت');
      setNoteText('');
      setShowAddNote(false);
      return;
    }
    if (error) { toast('❌ فشل إضافة الملاحظة — تحقق من الاتصال وأعد المحاولة', true); return; }
    toast('✅ تمت إضافة الملاحظة');
    logActivity(db, 'إضافة ملاحظة', {
      entity_type: 'note', details: caseData.title || null,
      case_name: caseData.title || null, case_type: caseData.type || null,
      client_name: client?.full_name || null,
      userName: profile?.full_name || null,
    });
    setNoteText('');
    setShowAddNote(false);
    fetchSessions();
  };

  const handleDeleteNote = async (noteId: string) => {
    // 🆕 المرحلة 6 (تكملة ثانية): __dbWrite بدل db.from(...).delete() المباشر.
    const { error, offline, queued } = await window.__dbWrite({ type: 'DELETE', table: 'case_notes', id: noteId });
    if (offline && queued) {
      toast('📥 الحذف محفوظ محلياً — سيُزامن عند عودة الإنترنت');
      return;
    }
    if (error) { toast('❌ فشل حذف الملاحظة، حاول مرة أخرى', true); return; }
    toast('🗑 تم حذف الملاحظة');
    logActivity(db, 'حذف ملاحظة', {
      entity_type: 'note', entity_id: noteId, details: caseData.title || null,
      case_name: caseData.title || null, case_type: caseData.type || null,
      client_name: client?.full_name || null,
      userName: profile?.full_name || null,
    });
    fetchSessions();
  };

  const handleUpdateNote = async (noteId: string, content: string) => {
    // نجيب updated_at الحالي من الـ notes المحفوظة في state
    const note = notes.find((n) => n.id === noteId);
    // 🆕 المرحلة 6 (تكملة ثانية): __dbWrite بدل safeUpdate — بيحافظ على نفس
    // فحص التعارض (knownUpdatedAt) أونلاين، وكمان بيقيّد في طابور الأوفلاين
    // لو النت مقطوع (بعكس safeUpdate اللي كانت بترجع فشل صريح بس).
    const { error, offline, queued, conflict } = await window.__dbWrite({
      type: 'UPDATE', table: 'case_notes', data: { content }, id: noteId, knownUpdatedAt: note?.updated_at || null
    });
    if (offline && queued) {
      toast('📥 التعديل محفوظ محلياً — سيُزامن عند عودة الإنترنت');
      return;
    }
    if (conflict) { toast('⚠️ هذه الملاحظة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true); return; }
    if (error) { toast('❌ فشل تعديل الملاحظة — تحقق من الاتصال وأعد المحاولة', true); return; }
    toast('✅ تم تعديل الملاحظة');
    logActivity(db, 'تعديل ملاحظة', {
      entity_type: 'note', entity_id: noteId, details: caseData.title || null,
      case_name: caseData.title || null, case_type: caseData.type || null,
      client_name: client?.full_name || null,
      userName: profile?.full_name || null,
    });
    fetchSessions();
  };

  const handleChangeStatus = async (newStatus: string) => {
    setChangingStatus(true);
    setShowStatusPicker?.(false);
    const { success, conflict } = await safeUpdate(db, 'cases', caseData.id, { status: newStatus }, caseData.updated_at || null);
    setChangingStatus(false);
    // 🔒 FIX (تقرير الموثوقية — القسم 12، Concurrent Editing): كانت بترجع
    // بصمت تام عند التعارض. نفس نمط الرسالة المستخدم في case_notes/cases.
    if (conflict) { toast('⚠️ هذه القضية عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true); return; }
    if (!success) { toast('❌ فشل تغيير الحالة', true); return; }
    toast('✅ تم تحديث حالة القضية');
    logActivity(db, 'تغيير حالة قضية', {
      entity_type: 'case', entity_id: caseData.id, details: `${caseData.title} — ${newStatus}`,
      case_name: caseData.title || null, case_type: caseData.type || null,
      client_name: client?.full_name || null,
      userName: profile?.full_name || null,
    });
    onUpdate?.(newStatus);
  };

  return {
    // جلسات (من useCaseSessions)
    sessions: sessionsHook.sessions, setSessions: sessionsHook.setSessions,
    showAddSession: sessionsHook.showAddSession, setShowAddSession: sessionsHook.setShowAddSession,
    editingSession: sessionsHook.editingSession, setEditingSession: sessionsHook.setEditingSession,
    deletingSessionId: sessionsHook.deletingSessionId, setDeletingSessionId: sessionsHook.setDeletingSessionId,
    sessionUpdateTarget: sessionsHook.sessionUpdateTarget, setSessionUpdateTarget: sessionsHook.setSessionUpdateTarget,
    savingSession: sessionsHook.savingSession,
    sessionForm: sessionsHook.sessionForm, setSessionForm: sessionsHook.setSessionForm,
    confirmDeleteSession: sessionsHook.confirmDeleteSession, setConfirmDeleteSession: sessionsHook.setConfirmDeleteSession,
    handleAddSession: sessionsHook.handleAddSession,
    handleUpdateSession: sessionsHook.handleUpdateSession,
    handleDeleteSession: sessionsHook.handleDeleteSession,

    // مستندات (من useCaseDocuments)
    docs: docsHook.docs, setDocs: docsHook.setDocs,
    uploadingDoc: docsHook.uploadingDoc,
    docCategory: docsHook.docCategory, setDocCategory: docsHook.setDocCategory,
    docLabel: docsHook.docLabel, setDocLabel: docsHook.setDocLabel,
    showDocForm: docsHook.showDocForm, setShowDocForm: docsHook.setShowDocForm,
    pendingFile: docsHook.pendingFile, setPendingFile: docsHook.setPendingFile,
    deletingDocId: docsHook.deletingDocId, setDeletingDocId: docsHook.setDeletingDocId,
    fileInputRef: docsHook.fileInputRef,
    confirmDeleteDoc: docsHook.confirmDeleteDoc, setConfirmDeleteDoc: docsHook.setConfirmDeleteDoc,
    handleFileSelect: docsHook.handleFileSelect,
    handleUploadDoc: docsHook.handleUploadDoc,
    handleDeleteDoc: docsHook.handleDeleteDoc,

    // ملاحظات + حالة القضية + عام (زي ما هو في الملف ده)
    notes, setNotes,
    loadingSessions,
    // ⚡ NEW (مرحلة 8): أطراف القضية الكاملة من case_parties.
    caseParties,
    editingNoteId, setEditingNoteId, editingNoteText, setEditingNoteText,
    deletingNoteId, setDeletingNoteId,
    showAddNote, setShowAddNote,
    savingNote, changingStatus,
    noteText, setNoteText,
    exportingPdf, showWhatsApp, setShowWhatsApp, officeWhatsAppName, setOfficeWhatsAppName,
    confirmDeleteNote, setConfirmDeleteNote,
    fetchSessions, handleExportPdf,
    handleAddNote, handleDeleteNote, handleUpdateNote, handleChangeStatus,
  };
}
