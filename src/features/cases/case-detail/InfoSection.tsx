import React, { useState } from 'react';
import type { MappedCase, MappedClient } from '../../../hooks/useAppData';
import type { CaseSessionRow, CaseNoteRow } from '../../../types';
import type { CaseDocWithUrl } from '../hooks/useCaseDetailActions';

interface InfoSectionProps {
  caseData: MappedCase;
  client: MappedClient | null;
  sessions: CaseSessionRow[];
  notes: CaseNoteRow[];
  docs: CaseDocWithUrl[];
  // ⚡ NEW (19 يوليو 2026): للسماح بربط القضية بموكل موجود من نفس تاب
  // البيانات لما القضية لسه مش مرتبطة بحد (شوف useCaseActions.handleLinkClient).
  clients?: MappedClient[];
  linkingClient?: boolean;
  onLinkClient?: (clientId: string) => void | Promise<void>;
}

interface InfoRow {
  label: string;
  value: string | null;
}

function InfoSection({ caseData, client, sessions, notes, docs, clients = [], linkingClient = false, onLinkClient }: InfoSectionProps) {
  const [showLinker, setShowLinker] = useState(false);
  const [pickedClientId, setPickedClientId] = useState('');
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
                (caseData.plaintiff || caseData.defendant) && React.createElement('div', {className: "bg-premium-card border border-white/5 rounded-2xl p-4"},
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
                    )
                ),

                // ربط بموكل — يظهر بس لو القضية مش مرتبطة بموكل، ويختفي
                // تلقائيًا بمجرد ما caseData.client_id يتحدّث (نفس مبدأ كارت
                // "الموكل" فوق، اللي بيظهر هو نفسه لما client يبقى موجود).
                !client && onLinkClient && React.createElement('div', {className: "bg-premium-card border border-dashed border-premium-gold/30 rounded-2xl p-4"},
                    !showLinker
                        ? React.createElement('button', {
                            onClick: () => setShowLinker(true),
                            className: "w-full flex items-center justify-center gap-2 text-[11px] font-black text-premium-gold py-1.5"
                          }, '🔗 ربط القضية بموكل')
                        : React.createElement('div', {className: "space-y-3"},
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
                                    onClick: async () => { await onLinkClient(pickedClientId); setShowLinker(false); setPickedClientId(''); },
                                    className: "flex-1 bg-premium-gold text-premium-bg rounded-xl py-2.5 text-[11px] font-black disabled:opacity-40"
                                }, linkingClient ? '... جارٍ الربط' : 'ربط'),
                                React.createElement('button', {
                                    disabled: linkingClient,
                                    onClick: () => { setShowLinker(false); setPickedClientId(''); },
                                    className: "flex-1 bg-white/5 border border-white/10 text-slate-300 rounded-xl py-2.5 text-[11px] font-black"
                                }, 'إلغاء')
                            )
                        )
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
