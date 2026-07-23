import React, { useState } from 'react';
import type { MappedCase, MappedClient } from '../../../hooks/useAppData';
import type { CaseSessionRow, CaseNoteRow } from '../../../types';
import type { CaseDocWithUrl, CasePartyRow } from '../hooks/useCaseDetailActions';
// ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 6): كشف التعارض بين البيانات
// الحرة المكتوبة في القضية وملف الموكل المختار وقت الربط اللاحق.
import { findClientDataMismatches, type FieldMismatch } from '../../calendar/hooks/caseSessionLinkingShared';
// 🆕 (خطة "المسمى القانوني" — مرحلة 5): منطق موحّد لعرض المسمى القانوني
// عند تعدد الأشخاص تحت طرف واحد — نفس الدالة مستخدمة في هيدر CaseDetailView.tsx.
import { summarizePartySide } from '../../../shared/parties/partyDisplay';

interface InfoSectionProps {
  caseData: MappedCase;
  client: MappedClient | null;
  sessions: CaseSessionRow[];
  notes: CaseNoteRow[];
  docs: CaseDocWithUrl[];
  // ⚡ NEW (خطة تعدد الأطراف، مرحلة 8 — 23 يوليو 2026): كل أطراف القضية
  // من case_parties (لو موجودة) — بتحل محل عرض عمودي plaintiff/defendant
  // القديمين لما تكون فيها قيمة واحدة أو أكتر. array فاضية (قضية قديمة
  // قبل مرحلة 4، أو لسه معملهاش تعديل بالفورم الجديد) = fallback كامل
  // لعرض الأعمدة القديمة زي ما كان بالظبط.
  caseParties?: CasePartyRow[];
  // ⚡ NEW (19 يوليو 2026): للسماح بربط القضية بموكل موجود من نفس تاب
  // البيانات لما القضية لسه مش مرتبطة بحد (شوف useCaseActions.handleLinkClient).
  clients?: MappedClient[];
  linkingClient?: boolean;
  onLinkClient?: (clientId: string) => void | Promise<void>;
  // ⚡ CHANGED (خطة توحيد إنشاء الموكل، Phase 1): بقت مجرد فتح لـ
  // NewClientModal الكامل (مليان ببيانات المدعي) — مش عملية حفظ. الحفظ
  // والربط وفحص التكرار كلهم بقوا مسؤولية useClientActions.handleSaveClient.
  onCreateAndLinkClient?: () => void;
  // ⚡ NEW (نقل زرار فك الربط من EditCaseModal لنفس مكان زرار الربط):
  // بيصفّر client_id بس (من غير ما يلمس باقي بيانات القضية). نفس نمط
  // onLinkClient/linkingClient بالظبط — بيوصل من CaseDetailView عبر
  // handleUnlinkClient (useCaseActions.ts).
  unlinkingClient?: boolean;
  onUnlinkClient?: () => void | Promise<void>;
  // ⚡ NEW (خطة تعدد الأطراف، مرحلة 13.1 — 23 يوليو 2026): زرار "إنشاء
  // موكل" لطرف بعينه من caseParties — بديل onCreateAndLinkClient لما فيه
  // أكتر من طرف عليه ⭐ (شوف قسم 9 في الخطة). caseData/CaseDetailView هي
  // اللي بتحدد caseId وبتتولى onAfterLink (تحديث caseParties).
  onCreateAndLinkClientForParty?: (party: CasePartyRow, isPrimaryParty: boolean) => void;
}

interface InfoRow {
  label: string;
  value: string | null;
}

function InfoSection({ caseData, client, sessions, notes, docs, caseParties = [], clients = [], linkingClient = false, onLinkClient, onCreateAndLinkClient, unlinkingClient = false, onUnlinkClient, onCreateAndLinkClientForParty }: InfoSectionProps) {
  // ⚡ NEW (مرحلة 13.1 — قسم 9 في الخطة): كل الأطراف عليهم ⭐ (is_client)،
  // والأطراف منهم اللي لسه مش مربوطة بموكل (client_id فاضي) — دي اللي
  // محتاجة زرار "إنشاء موكل". الطرف الأول (بترتيب sort_order، نفس ترتيب
  // fetchSessionClientParties) هو "الطرف الأساسي" اللي بيزامن cases.client_id
  // القديم لو اترّبط — نفس التعريف بالظبط المستخدم في caseSessionLinkingShared.ts.
  const starredParties = caseParties.filter((p) => p.is_client);
  const primaryPartyId = starredParties[0]?.id;
  const unlinkedStarredParties = starredParties.filter((p) => !p.client_id);
  const hasPartyData = caseParties.length > 0;
  // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 7 — fallback الموكل
  // المحذوف): caseData.client_id موجود لكن client وصل null من الأب —
  // يعني القضية *كانت* مربوطة بموكل اتمسح (soft-deleted) بعد كده، مش
  // إن القضية دي مكانتش مربوطة بحد أصلاً. الفرق مهم للمستخدم عشان
  // يفهم ليه فجأة الحقول رجعت حرة.
  const isOrphaned = !!caseData.client_id && !client;
  const [linkStep, setLinkStep] = useState<'closed' | 'choice' | 'pickExisting' | 'confirmMismatch'>('closed');
  const [pickedClientId, setPickedClientId] = useState('');
  // ⚡ NEW (مرحلة 6): الحقول المتعارضة بين بيانات القضية الحرة وملف الموكل
  // المختار — بتتحسب لما يدوس "ربط"، وبتتعرض كتنبيه تأكيد بدل استبدال صامت.
  const [pendingMismatches, setPendingMismatches] = useState<FieldMismatch[]>([]);
  // ⚡ NEW: تأكيد فك الربط inline جوه نفس الكارت (بدل مودال منفصل) — نفس
  // مبدأ حساسية الفعل العكسي، بس هنا مدمج مكان واحد مع زرار الربط.
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false);
  return React.createElement('div', {className: "space-y-4 fade-in"},
                // بيانات القضية
                React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4 space-y-0"},
                    React.createElement('p', {className: "text-[9px] font-black text-slate-500 mb-3 tracking-widest"}, "— بيانات القضية —"),
                    [
                        {label: 'موضوع الدعوى', value: caseData.title},
                        {label: 'نوع القضية', value: caseData.type},
                        {label: 'المحكمة', value: caseData.court},
                        {label: 'درجة التقاضي', value: caseData.court_level},
                        {label: 'رقم الدائرة', value: caseData.circuit_number},
                        {label: 'رقم القيد', value: (()=>{const p=(caseData.number||'').split('/');return p.length===2?p[0]+' لسنة '+p[1]:caseData.number;})()},
                        {label: 'أقرب جلسة', value: caseData.date},
                        {label: 'الحالة', value: caseData.status || 'نشطة'},
                    ].filter((r: InfoRow) => r.value && r.value !== '—').map((row: InfoRow, i: number, arr: InfoRow[]) =>
                        React.createElement('div', {
                            key: row.label,
                            className: `flex items-start justify-between gap-4 py-3 ${i < arr.length - 1 ? 'border-b border-white/5' : ''}`
                        },
                            React.createElement('span', {className: "text-[10px] text-slate-400 font-bold shrink-0"}, row.label),
                            React.createElement('span', {className: "text-xs text-white font-black text-left max-w-[60%] text-right"}, row.value)
                        )
                    )
                ),

                // بيانات إضافية — ميعاد الجلسة وقاعتها وبيانات سكرتير الجلسة
                // ⚡ FIX (19 يوليو 2026): الحقول دي كانت بتتحفظ صح في القضية
                // (خصوصًا لما بتتحول من جلسة مستقلة) بس مكانتش بتظهر هنا خالص.
                (caseData.session_hall || caseData.secretary_hall || caseData.secretary_name || caseData.secretary_mobile || caseData.session_time) &&
                React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4 space-y-0"},
                    React.createElement('p', {className: "text-[9px] font-black text-slate-500 mb-3 tracking-widest"}, "— بيانات إضافية —"),
                    [
                        {label: 'ميعاد الجلسة', value: caseData.session_time ? (caseData.session_time === 'صباحي' ? '🌅 صباحي' : '🌆 مسائي') : null},
                        {label: 'الطابق وقاعة الجلسة', value: caseData.session_hall},
                        {label: 'قاعة سكرتير الجلسة', value: caseData.secretary_hall},
                        {label: 'اسم سكرتير الجلسة', value: caseData.secretary_name},
                        {label: 'موبايل سكرتير الجلسة', value: caseData.secretary_mobile},
                    ].filter((r: InfoRow) => r.value && r.value !== '—').map((row: InfoRow, i: number, arr: InfoRow[]) =>
                        React.createElement('div', {
                            key: row.label,
                            className: `flex items-start justify-between gap-4 py-3 ${i < arr.length - 1 ? 'border-b border-white/5' : ''}`
                        },
                            React.createElement('span', {className: "text-[10px] text-slate-400 font-bold shrink-0"}, row.label),
                            row.label === 'موبايل سكرتير الجلسة'
                                ? React.createElement('a', {href: `tel:${row.value}`, className: "text-xs text-premium-gold font-black text-left max-w-[60%] text-right"}, '📞 ' + row.value)
                                : React.createElement('span', {className: "text-xs text-white font-black text-left max-w-[60%] text-right"}, row.value)
                        )
                    )
                ),

                // أسماء الخصوم
                // ⚡ CHANGED (خطة تعدد الأطراف، مرحلة 8 — 23 يوليو 2026):
                // لو caseParties فيها صفوف، بنعرض القايمة الكاملة (كل
                // مدعي/مدعى عليه، بصفته وعلامة "موكل المكتب" لو is_client)
                // بدل عمودي plaintiff/defendant المفردين. array فاضية
                // (قضية قديمة قبل مرحلة 4) = نفس عرض الأعمدة القديمة
                // بالظبط زي ما كان — صفر تغيير سلوك.
                caseParties.length > 0
                ? React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4"},
                    React.createElement('p', {className: "text-[9px] font-black text-slate-500 mb-3 tracking-widest"}, "— أطراف الدعوى —"),
                    (() => {
                        const plaintiffs = caseParties.filter((p) => p.side === 'plaintiff');
                        const defendants = caseParties.filter((p) => p.side === 'defendant');
                        const renderParty = (p: CasePartyRow, colorClass: string) => React.createElement('div', {
                            key: p.id,
                            className: "flex items-center justify-between gap-3"
                        },
                            React.createElement('span', {className: "text-[10px] text-slate-400 font-bold"}, p.capacity || (p.side === 'plaintiff' ? 'المدعي / الطاعن' : 'المدعى عليه / المطعون ضده')),
                            React.createElement('span', {className: "flex items-center gap-1.5"},
                                p.is_client && React.createElement('span', {
                                    className: "text-[8px] font-black text-premium-gold bg-premium-gold/10 rounded-full px-1.5 py-0.5"
                                }, 'موكل'),
                                React.createElement('span', {className: `text-[11px] font-black ${colorClass}`}, p.name)
                            )
                        );
                        // 🆕 (خطة "المسمى القانوني" — مرحلة 5): يظهر بس لو الجهة
                        // فيها أكتر من شخص مسمّى — الحالة الغالبة (شخص واحد لكل
                        // جهة) تفضل بلا أي تغيير عن الشكل القديم، مطابقة لبند
                        // "توسيع العرض فقط عند تعدد الأشخاص" في قسم 5 من الخطة.
                        const renderLegalTitle = (side: 'plaintiff' | 'defendant', colorClass: string) => {
                            const list = side === 'plaintiff' ? plaintiffs : defendants;
                            const summary = summarizePartySide(list);
                            if (!summary || summary.othersCount === 0) return null;
                            const title = (side === 'plaintiff' ? caseData.plaintiff_legal_title : caseData.defendant_legal_title) || '';
                            if (!title.trim()) return null;
                            return React.createElement('p', {className: `text-[10px] font-black ${colorClass} mb-1.5`}, `🔖 ${title.trim()}`);
                        };
                        return React.createElement('div', {className: "space-y-3"},
                            renderLegalTitle('plaintiff', 'text-emerald-400/80'),
                            plaintiffs.map((p) => renderParty(p, 'text-emerald-400')),
                            plaintiffs.length > 0 && defendants.length > 0 && React.createElement('div', {className: "border-t border-white/5"}),
                            renderLegalTitle('defendant', 'text-rose-400/80'),
                            defendants.map((p) => renderParty(p, 'text-rose-400'))
                        );
                    })()
                )
                : (caseData.plaintiff || caseData.defendant) && React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4"},
                    React.createElement('p', {className: "text-[9px] font-black text-slate-500 mb-3 tracking-widest"}, "— أطراف الدعوى —"),
                    (() => {
                        // ⚡ FIX: نفس مبدأ CaseDetailView.tsx — نقرا الصفة من عمود
                        // plaintiff_role/defendant_role المخصص، ونرجع لـ regex بس
                        // كـ fallback لصفوف قديمة لسه معندهاش العمود متعبي.
                        // ⚠️ وبيتقسم بس لو اللي جوه القوسين كلمة صفة قانونية معروفة،
                        // عشان مايتقطعش جزء من اسم شركة زي "(ش.م.م)".
                        const knownCapacityPattern = /مدعي|مدعى عليه|مستأنف|طاعن|مطعون ضده|متهم|مجني عليه|محكوم عليه|خصم|مدين|دائن|موكل|وكيل|طالب|مطلوب ضده|منفذ ضده/;
                        const splitParty = (val: string | null | undefined) => {
                            if(!val) return null;
                            const m = val.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
                            if(m && knownCapacityPattern.test(m[2])) return {name:m[1].trim(), capacity:m[2].trim()};
                            return {name:val, capacity:''};
                        };
                        const p = caseData.plaintiff
                            ? (caseData.plaintiff_role ? {name: caseData.plaintiff, capacity: caseData.plaintiff_role} : splitParty(caseData.plaintiff))
                            : null;
                        const d = caseData.defendant
                            ? (caseData.defendant_role ? {name: caseData.defendant, capacity: caseData.defendant_role} : splitParty(caseData.defendant))
                            : null;
                        return React.createElement('div', {className: "space-y-3"},
                            p && React.createElement('div', {className: "flex items-center justify-between"},
                                React.createElement('span', {className: "text-[10px] text-slate-400 font-bold"}, p.capacity || "المدعي / الطاعن"),
                                React.createElement('span', {className: "text-[11px] font-black text-emerald-400"}, p.name)
                            ),
                            p && d && React.createElement('div', {className: "border-t border-white/5"}),
                            d && React.createElement('div', {className: "flex items-center justify-between"},
                                React.createElement('span', {className: "text-[10px] text-slate-400 font-bold"}, d.capacity || "المدعى عليه / المطعون ضده"),
                                React.createElement('span', {className: "text-[11px] font-black text-rose-400"}, d.name)
                            )
                        );
                    })()
                ),

                // بيانات الموكل
                client && React.createElement('div', {className: "bg-premium-card border border-emerald-500/15 rounded-2xl p-4"},
                    React.createElement('p', {className: "text-[9px] font-black text-emerald-400/70 mb-3 tracking-widest"}, "— الموكل —"),
                    React.createElement('div', {className: "flex items-center gap-3"},
                        React.createElement('div', {className: "w-11 h-11 rounded-xl bg-emerald-500/15 flex items-center justify-center text-emerald-400 font-black text-sm"},
                            (client.full_name || 'م').charAt(0)
                        ),
                        React.createElement('div', null,
                            React.createElement('p', {className: "text-sm font-black text-white"}, client.full_name),
                            React.createElement('p', {className: "text-[10px] text-emerald-400 font-bold"}, client.type || 'فرد'),
                            client.phone && React.createElement('a', {href:`tel:${client.phone}`, className: "text-[10px] text-slate-400 mt-0.5 block"}, '📞 '+client.phone)
                        )
                    ),
                    // ⚡ NEW: زرار "فك الربط" — نُقل من EditCaseModal لنفس مكان
                    // زرار "ربط القضية بموكل" (نفس الكارت، يتبدّل حسب حالة الربط).
                    onUnlinkClient && (
                        showUnlinkConfirm
                            ? React.createElement('div', {className: "mt-3 pt-3 border-t border-white/5 space-y-2"},
                                React.createElement('p', {className: "text-[10px] text-slate-400 text-center leading-relaxed"},
                                    "متأكد؟ هيتصفّر ربط القضية بملف الموكل، وترجع بياناته قابلة للتعديل الحر."
                                ),
                                React.createElement('div', {className: "flex gap-2"},
                                    React.createElement('button', {
                                        disabled: unlinkingClient,
                                        onClick: async () => {
                                            await onUnlinkClient();
                                            setShowUnlinkConfirm(false);
                                        },
                                        'data-testid': 'info-unlink-client-confirm',
                                        className: "flex-1 bg-rose-500 text-white rounded-xl py-2 text-[10px] font-black disabled:opacity-60"
                                    }, unlinkingClient ? '⏳ جارٍ فك الربط...' : 'نعم، افصل الربط'),
                                    React.createElement('button', {
                                        disabled: unlinkingClient,
                                        onClick: () => setShowUnlinkConfirm(false),
                                        className: "flex-1 bg-white/5 border border-white/10 text-slate-300 rounded-xl py-2 text-[10px] font-black disabled:opacity-60"
                                    }, 'إلغاء')
                                )
                              )
                            : React.createElement('div', {className: "mt-3 pt-3 border-t border-white/5 flex justify-center"},
                                React.createElement('button', {
                                    onClick: () => setShowUnlinkConfirm(true),
                                    'data-testid': 'info-unlink-client',
                                    className: "text-[10px] font-black text-rose-400"
                                }, "🔓 فك الربط")
                              )
                    )
                ),

                // ⚡ NEW (مرحلة 7 — fallback الموكل المحذوف): تنبيه منفصل
                // عن كارت "الموكل" (اللي مش بيظهر أصلاً هنا لأن client
                // null) وعن دعوة "ربط بموكل" تحت — يوضّح إن القضية دي
                // *كانت* مربوطة فعلاً بموكل، مش إنها لسه ما اتربطتش.
                isOrphaned && React.createElement('div', {className: "bg-amber-500/10 border border-amber-500/20 rounded-2xl p-4 space-y-1.5", 'data-testid': 'info-orphaned-client-warning'},
                    React.createElement('p', {className: "text-[9px] font-black text-amber-400 tracking-widest"}, "⚠️ الموكل محذوف"),
                    React.createElement('p', {className: "text-[10px] text-slate-300 leading-relaxed"},
                        "الموكل اللي كانت القضية دي مربوطة بيه اتحذف من قائمة الموكلين. بيانات القضية (الاسم/الرقم القومي/التوكيل/العنوان) هي آخر نسخة معروفة، وبقت قابلة للتعديل الحر من تاب التعديل — تقدر تربط القضية بموكل تاني من تحت لو حابب."
                    )
                ),

                // ربط بموكل — يظهر بس لو القضية مش مرتبطة بموكل، ويختفي
                // تلقائيًا بمجرد ما caseData.client_id يتحدّث (نفس مبدأ كارت
                // "الموكل" فوق، اللي بيظهر هو نفسه لما client يبقى موجود).
                // ⚡ NEW (19 يوليو 2026): بقى فيه خطوة اختيار قبل الربط —
                // "ربط بموكل موجود" (الفلو القديم) أو "إنشاء موكل جديد من
                // بيانات القضية" (اسم المدعي)، بنفس فلسفة اختيار الربط/الإضافة
                // في NewStandaloneSessionModal (شوف useClientLinking.ts).
                // ⚡ CHANGED (مرحلة 13.1 — قسم 9): الكارت ده كان بيظهر بس لما
                // !client (القضية مش مربوطة بموكل خالص). دلوقتي بيظهر كمان لو
                // فيه أطراف عليهم ⭐ لسه مش مربوطة بموكل حتى لو client موجود
                // (طرف تاني غير الأساسي) — عشان زرار "إنشاء موكل" يفضل متاح
                // لكل طرف محتاجه، مش بس وقت أول ربط للقضية.
                (((!client) && (onLinkClient || onCreateAndLinkClient)) || (unlinkedStarredParties.length > 0 && onCreateAndLinkClientForParty))
                  && React.createElement('div', {className: "bg-premium-card border border-dashed border-premium-gold/30 rounded-2xl p-4"},
                    linkStep === 'closed'
                        ? React.createElement('button', {
                            onClick: () => setLinkStep('choice'),
                            className: "w-full flex items-center justify-center gap-2 text-[11px] font-black text-premium-gold py-1.5"
                          }, client ? '👤 إضافة موكل من أطراف القضية' : '🔗 ربط القضية بموكل')
                    : linkStep === 'choice'
                        ? React.createElement('div', {className: "space-y-2"},
                            React.createElement('p', {className: "text-[9px] font-black text-slate-500 tracking-widest mb-1"}, "— اختر طريقة الربط —"),
                            // ⚡ "ربط بموكل موجود" لسه بيربط cases.client_id مباشرة
                            // (مسار قديم، برّه نطاق مرحلة 13) — فمفيش داعي منطقي يظهر
                            // لو القضية أصلاً مربوطة (client موجود)، حتى لو فيه أطراف
                            // تانية محتاجة موكل.
                            !client && onLinkClient && React.createElement('button', {
                                onClick: () => setLinkStep('pickExisting'),
                                className: "w-full flex items-center justify-center gap-2 text-[11px] font-black text-white bg-white/5 border border-white/10 rounded-xl py-2.5"
                            }, '🔗 ربط بموكل موجود'),
                            // ⚡ CHANGED (خطة توحيد إنشاء الموكل، Phase 1): مبقاش فيه خطوة تأكيد
                            // منفصلة هنا — الزرار بيفتح NewClientModal الكامل على طول (مليان
                            // ببيانات المدعي)، وهو نفسه بيتولى فحص التكرار وإظهار خيار الربط لو
                            // لقى تطابق (شوف useClientActions.handleSaveClient).
                            // ⚡ CHANGED (مرحلة 13.1 — قسم 9): لو caseParties فيها بيانات
                            // (hasPartyData)، زرار منفصل لكل طرف عليه ⭐ ومش مربوط (باسمه في
                            // نص الزرار)، بيستخدم onCreateAndLinkClientForParty بدل الزرار
                            // العام. لو caseParties فاضية (قضية قديمة قبل مرحلة 4)، فولباك
                            // كامل لنفس الزرار الواحد القديم — صفر تغيير سلوك.
                            (hasPartyData && onCreateAndLinkClientForParty
                                ? unlinkedStarredParties.map((party: CasePartyRow) => React.createElement('button', {
                                    key: party.id,
                                    onClick: () => { onCreateAndLinkClientForParty(party, party.id === primaryPartyId); setLinkStep('closed'); },
                                    className: "w-full flex items-center justify-center gap-2 text-[11px] font-black text-white bg-white/5 border border-white/10 rounded-xl py-2.5"
                                  }, `👤 إضافة (${party.name}) لقائمة الموكلين`))
                                : (!hasPartyData && onCreateAndLinkClient && React.createElement('button', {
                                    onClick: () => { onCreateAndLinkClient(); setLinkStep('closed'); },
                                    className: "w-full flex items-center justify-center gap-2 text-[11px] font-black text-white bg-white/5 border border-white/10 rounded-xl py-2.5"
                                  }, `➕ إنشاء موكل جديد${caseData.plaintiff ? ' — ' + caseData.plaintiff : ''}`))
                            ),
                            React.createElement('button', {
                                onClick: () => setLinkStep('closed'),
                                className: "w-full py-2 text-[11px] font-bold text-slate-500"
                            }, 'إلغاء')
                          )
                    : linkStep === 'pickExisting'
                        ? React.createElement('div', {className: "space-y-3"},
                            React.createElement('p', {className: "text-[9px] font-black text-slate-500 tracking-widest"}, "— اختر موكلاً —"),
                            React.createElement('select', {
                                value: pickedClientId,
                                onChange: (e: React.ChangeEvent<HTMLSelectElement>) => setPickedClientId(e.target.value),
                                disabled: linkingClient,
                                className: "w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white font-bold outline-none"
                            },
                                React.createElement('option', {value: ''}, '— اختر موكلاً —'),
                                clients.map((c: MappedClient) => React.createElement('option', {key: c.id, value: c.id}, c.full_name))
                            ),
                            React.createElement('div', {className: "flex gap-2"},
                                React.createElement('button', {
                                    disabled: !pickedClientId || linkingClient,
                                    onClick: async () => {
                                        // ⚡ NEW (مرحلة 6): قبل الربط، نقارن بيانات القضية الحرة (لو موجودة)
                                        // بملف الموكل المختار. لو فيه تعارض حقيقي، بنوقف ونعرض تأكيد
                                        // بدل ما نستبدل صامت (onLinkClient بقى بيزامن الحقول دي فعليًا).
                                        const pickedClient = clients.find((c) => c.id === pickedClientId);
                                        const mismatches = pickedClient ? findClientDataMismatches(
                                            {
                                                plaintiff: caseData.plaintiff,
                                                plaintiff_national_id: caseData.plaintiff_national_id,
                                                plaintiff_power_of_attorney: caseData.plaintiff_power_of_attorney,
                                                plaintiff_address: caseData.plaintiff_address,
                                            },
                                            pickedClient,
                                        ) : [];
                                        if (mismatches.length > 0) {
                                            setPendingMismatches(mismatches);
                                            setLinkStep('confirmMismatch');
                                            return;
                                        }
                                        await onLinkClient!(pickedClientId); setLinkStep('closed'); setPickedClientId('');
                                    },
                                    className: "flex-1 bg-premium-gold text-premium-bg rounded-xl py-2.5 text-[11px] font-black disabled:opacity-40"
                                }, linkingClient ? '... جارٍ الربط' : 'ربط'),
                                React.createElement('button', {
                                    disabled: linkingClient,
                                    onClick: () => { setLinkStep('choice'); setPickedClientId(''); },
                                    className: "flex-1 bg-white/5 border border-white/10 text-slate-300 rounded-xl py-2.5 text-[11px] font-black"
                                }, 'رجوع')
                            )
                          )
                    : linkStep === 'confirmMismatch'
                        ? React.createElement('div', {className: "space-y-3"},
                            React.createElement('p', {className: "text-[11px] font-black text-amber-400"}, '⚠️ القيم دي مختلفة عن ملف الموكل:'),
                            React.createElement('div', {className: "space-y-1.5"},
                                pendingMismatches.map((m: FieldMismatch) => React.createElement('div', {
                                    key: m.field,
                                    className: "bg-white/5 border border-white/10 rounded-xl p-2.5 text-[10px]"
                                },
                                    React.createElement('p', {className: "text-slate-400 font-bold mb-1"}, m.label),
                                    React.createElement('p', {className: "text-slate-300"}, `في القضية: ${m.freeTextValue}`),
                                    React.createElement('p', {className: "text-premium-gold"}, `في ملف الموكل: ${m.clientValue}`)
                                ))
                            ),
                            React.createElement('p', {className: "text-[10px] text-slate-500"}, 'هل تحفظ باستخدام بيانات الموكل؟'),
                            React.createElement('div', {className: "flex gap-2"},
                                React.createElement('button', {
                                    disabled: linkingClient,
                                    'data-testid': 'info-link-client-confirm-mismatch',
                                    onClick: async () => { await onLinkClient!(pickedClientId); setLinkStep('closed'); setPickedClientId(''); setPendingMismatches([]); },
                                    className: "flex-1 bg-premium-gold text-premium-bg rounded-xl py-2.5 text-[11px] font-black disabled:opacity-40"
                                }, linkingClient ? '... جارٍ الربط' : 'نعم، استخدم بيانات الموكل'),
                                React.createElement('button', {
                                    disabled: linkingClient,
                                    onClick: () => { setLinkStep('pickExisting'); setPendingMismatches([]); },
                                    className: "flex-1 bg-white/5 border border-white/10 text-slate-300 rounded-xl py-2.5 text-[11px] font-black"
                                }, 'إلغاء')
                            )
                          )
                        : null
                ),


                // إحصائيات سريعة
                React.createElement('div', {className: "grid grid-cols-3 gap-3"},
                    React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4 text-center"},
                        React.createElement('p', {className: "text-3xl font-black text-premium-gold"}, sessions.length),
                        React.createElement('p', {className: "text-[9px] text-slate-400 font-bold mt-1"}, "الجلسات")
                    ),
                    React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4 text-center"},
                        React.createElement('p', {className: "text-3xl font-black text-blue-400"}, notes.length),
                        React.createElement('p', {className: "text-[9px] text-slate-400 font-bold mt-1"}, "الملاحظات")
                    ),
                    React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4 text-center"},
                        React.createElement('p', {className: "text-3xl font-black text-purple-400"}, docs.length),
                        React.createElement('p', {className: "text-[9px] text-slate-400 font-bold mt-1"}, "المستندات")
                    )
                )
            );
}

export default InfoSection;
