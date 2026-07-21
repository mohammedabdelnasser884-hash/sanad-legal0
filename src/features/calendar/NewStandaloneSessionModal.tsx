import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from '../../shared/lib/notifications';
import { validateFullNameParts } from '../../shared/lib/clientValidation';
import { escapeTelegramHtml } from '../../shared/lib/sanitize';
import { logActivity } from '../../shared/lib/dataAccess';
import { db } from '../../supabaseClient';
import { showErrorToast } from '../../shared/lib/errorReporting';
import { Inp } from '@/shared/ui/Inp';
import { PoaInput } from '@/shared/ui/PoaInput';
import { Sel } from '@/shared/ui/Sel';
import type { MappedCase } from '../../hooks/useAppData';
import { useClientLinking } from './hooks/useClientLinking';
import type { OpenCreateClientForSession, OpenCreateClientForCase } from './hooks/useClientLinking';

// ══════════════════════════════════════════
//  Modal إضافة جلسة مستقلة (بدون ربط بقضية)
// ══════════════════════════════════════════

const CASE_TYPES = ['مدني', 'تجاري', 'جنائي', 'عمالي', 'إداري', 'أسرة', 'أخرى'];

export interface Form {
    court: string;
    title: string;
    case_number: string;
    case_year: string;
    case_type: string;
    case_type_custom: string;
    circuit_number: string;
    court_level: string;
    court_level_other: string;
    session_date: string;
    session_time: string;
    plaintiff: string;
    plaintiff_role: string;
    plaintiff_national_id: string;
    plaintiff_power_of_attorney: string;
    defendant: string;
    defendant_role: string;
    defendant_national_id: string;
    next_action: string;
    // ⚡ موحّد مع cases.session_hall — نص واحد "الدور الأول - قاعة 5"،
    // بدل session_floor/session_hall المنفصلين اللي كانوا هنا قبل كده
    // (نفس النمط القديم اللي اتشال من جدول cases). session_floor
    // اتسيب كعمود قديم في الداتابيز بس مبقاش بيتكتب فيه من هنا.
    session_hall: string;
    secretary_hall: string;
    secretary_name: string;
    secretary_mobile: string;
    description: string;
    result: string;
}

const EMPTY: Form = {
    court: '',
    title: '',
    case_number: '',
    case_year: '',
    case_type: '',
    case_type_custom: '',
    circuit_number: '',
    court_level: '',
    court_level_other: '',
    session_date: '',
    session_time: 'صباحي',
    plaintiff: '',
    plaintiff_role: '',
    plaintiff_national_id: '',
    plaintiff_power_of_attorney: '',
    defendant: '',
    defendant_role: '',
    defendant_national_id: '',
    next_action: '',
    session_hall: '',
    secretary_hall: '',
    secretary_name: '',
    secretary_mobile: '',
    description: '',
    result: '',
};

const COURT_LEVELS = ['ابتدائي', 'استئناف', 'نقض', 'أخرى'];

// أرقام بس، وبالظبط 14 رقم — بيتقص أي حرف مش رقم أول بأول
const onlyDigits = (v: string, max = 14) => v.replace(/\D/g, '').slice(0, max);

function SectionTitle({ children }: { children: string }) {
    return React.createElement('p', {
        className: 'text-[10px] font-black text-premium-gold/70 uppercase tracking-widest pt-2 pb-0.5 border-b border-white/5'
    }, children);
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children?: React.ReactNode }) {
    return React.createElement('div', null,
        React.createElement('label', { className: 'block text-[10px] font-bold text-slate-400 mb-1.5' },
            label,
            required && React.createElement('span', { className: 'text-rose-400 mr-0.5' }, ' *')
        ),
        children
    );
}

const inputCls = 'w-full p-3 text-xs rounded-xl border border-white/10 bg-premium-bg text-white placeholder-slate-600';
const inputStyle = { fontFamily: 'Cairo,sans-serif' };

export default function NewStandaloneSessionModal({ onClose, onSaved, onClientAdded, onNotify, cases = [], onOpenCreateClient, onOpenCreateClientForCase }: {
    onClose: () => void;
    onSaved: () => void;
    onClientAdded?: () => void;
    onNotify?: (msg: string) => void;
    cases?: MappedCase[];
    // ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 3): فتح NewClientModal الموحّد
    // من "إضافة الموكل لقائمة الموكلين فقط" — شوف App.tsx
    // (handleOpenCreateClientForSession) وuseClientLinking.ts.
    onOpenCreateClient?: OpenCreateClientForSession;
    // ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 2): فتح NewClientModal الموحّد
    // من "إنشاء موكل جديد وربطه" (بعد تحويل جلسة مستقلة لقضية) — شوف
    // App.tsx (handleOpenCreateClientForCase) وuseClientLinking.ts.
    onOpenCreateClientForCase?: OpenCreateClientForCase;
}) {
    const [form, setForm] = useState<Form>(EMPTY);
    const [linkMode, setLinkMode] = useState<'standalone' | 'existing'>('standalone');
    const [caseSearch, setCaseSearch] = useState('');
    const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const [postSaveModal, setPostSaveModal] = useState(false);
    const [savedFormData, setSavedFormData] = useState<{ form: Form; finalCaseType: string; finalCourtLevel: string; fullCaseNumber: string; sessionId: string | null } | null>(null);
    const {
        linkingCase, linkingClient, linkingToCase,
        createdCaseId, setCreatedCaseId,
        clientStep, setClientStep,
        foundClient, setFoundClient, foundClientMatchType,
        handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
    } = useClientLinking(savedFormData, onSaved, onClientAdded, onOpenCreateClient, onOpenCreateClientForCase);

    const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f: Form) => ({ ...f, [k]: e.target.value }));

    const finalCaseType = form.case_type === 'أخرى' ? (form.case_type_custom || 'أخرى') : form.case_type;
    const finalCourtLevel = form.court_level === 'أخرى' ? (form.court_level_other || '') : form.court_level;
    const fullCaseNumber = [form.case_number, form.case_year].filter(Boolean).join('/');
    const selectedCase = cases.find((c: MappedCase) => c.id === selectedCaseId) || null;
    const filteredCases = !caseSearch ? cases : cases.filter((c: MappedCase) =>
        c.title?.includes(caseSearch) || c.number?.includes(caseSearch) ||
        c.plaintiff?.includes(caseSearch) || c.defendant?.includes(caseSearch)
    );

    const handleSave = async () => {
        if (!form.session_date) { toast('⚠️ تاريخ الجلسة مطلوب', true); return; }
        if (linkMode === 'existing' && !selectedCaseId) { toast('⚠️ اختر القضية أولاً', true); return; }
        if (linkMode === 'standalone') {
            if (!form.title?.trim() || !form.plaintiff?.trim() || !form.defendant?.trim()) {
                toast('⚠️ يجب ملء الحقول الإجبارية المحددة بعلامة (*)', true);
                return;
            }
            if (!form.plaintiff_role?.trim() || !form.defendant_role?.trim()) {
                toast('⚠️ صفة الموكل وصفة الخصم إجبارية', true);
                return;
            }
            // 🔒 FIX (تقرير الموثوقية — نتيجة 5 الفرعية): اسم الخصم لازم يكون
            // ثلاثي على الأقل — من غير فحص تكرار خالص (تكرار اسم الخصم في
            // أكتر من جلسة/قضية أمر طبيعي جدًا). اسم الموكل (form.plaintiff)
            // بيتفحص بالفعل في useSessionLinking.ts وقت تحويله لموكل فعلي.
            const oppNameErr = validateFullNameParts(form.defendant || '');
            if (oppNameErr) {
                toast('⚠️ اسم الخصم لازم يكون ثلاثي على الأقل (الاسم الأول، الأب، الجد)', true);
                return;
            }
            // 🔒 FIX (تقرير الموثوقية — نتيجة 4): القرار المتخذ — إجباري
            // للموكل، اختياري للخصم (غالبًا مش بيبقى معانا وقت تسجيل جلسة
            // مستقلة)، وفحص الصيغة (14 رقم بالظبط) لو الخصم اتكتب.
            if (form.plaintiff_national_id.length !== 14) {
                toast('⚠️ الرقم القومي للموكل مطلوب ولازم يكون 14 رقم بالظبط', true);
                return;
            }
            if (form.defendant_national_id && form.defendant_national_id.length !== 14) {
                toast('⚠️ الرقم القومي للخصم لازم يكون 14 رقم بالظبط', true);
                return;
            }
        }
        setSaving(true);
        try {
            // ⚡ FIX (مرحلة 0 — توسيع الأوفلاين): تحويل من db.from() المباشر لـ
            // __dbWrite. النداء ده مستقل تمامًا (case_id إما null أو id قضية
            // حقيقي مُختار من الدروب داون في وضع "existing" — مفيش سلسلة
            // تعتمد على id لسه في الطابور)، فآمن يتحول فورًا من غير أي توسيع
            // في نظام الطابور نفسه. لو أوفلاين، sessionData.id هيبقى مفقود
            // (العملية اتقيدت بس)، فـ savedFormData.sessionId هيبقى null —
            // ده متعامل معاه بالفعل في useClientLinking.ts (خطوة ربط الجلسة
            // بالقضية بتتخطى لو sessionId فاضي)، صفر تغيير سلوك إضافي مطلوب.
            const { data: sessionData, error, offline, queued } = await window.__dbWrite({
                type: 'INSERT',
                table: 'case_sessions',
                data: {
                    case_id: linkMode === 'existing' ? selectedCaseId : null,
                    session_date: form.session_date,
                    session_time: form.session_time || null,
                    court_level: finalCourtLevel || null,
                    session_hall: form.session_hall || null,
                    secretary_hall: form.secretary_hall || null,
                    secretary_name: form.secretary_name || null,
                    secretary_mobile: form.secretary_mobile || null,
                    title: form.title || null,
                    case_number: fullCaseNumber || null,
                    court: form.court || null,
                    case_type: finalCaseType || null,
                    circuit_number: form.circuit_number || null,
                    plaintiff: form.plaintiff || null,
                    plaintiff_role: form.plaintiff_role || null,
                    plaintiff_national_id: form.plaintiff_national_id || null,
                    plaintiff_power_of_attorney: form.plaintiff_power_of_attorney || null,
                    defendant: form.defendant || null,
                    defendant_role: form.defendant_role || null,
                    defendant_national_id: form.defendant_national_id || null,
                    description: form.description || null,
                    result: form.result || null,
                    next_action: form.next_action || null,
                },
                returning: true,
            });

            if (error) {
                showErrorToast('session_save', error, 'تعذّر حفظ الجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'حفظ الجلسة');
                return;
            }

            if (offline && queued) {
                toast(linkMode === 'existing' ? '📥 الجلسة محفوظة محلياً — ستُضاف فور عودة الإنترنت' : '📥 الجلسة المستقلة محفوظة محلياً — ستُضاف فور عودة الإنترنت');
                onSaved();
                onClose();
                return;
            }

            // إشعار تيليجرام
            try {
                if (onNotify) {
                    let msg = linkMode === 'existing'
                        ? `📅 <b>جلسة جديدة</b>\n\n`
                        : `📅 <b>جلسة مستقلة جديدة</b>\n\n`;
                    if (linkMode === 'existing' && selectedCase) {
                        msg += `⚖️ <b>${escapeTelegramHtml(selectedCase.title || '—')}</b>\n`;
                        msg += `📋 رقم القيد: ${escapeTelegramHtml(selectedCase.number || '—')}\n`;
                        msg += `🏛 المحكمة: ${escapeTelegramHtml(selectedCase.court || '—')}\n`;
                    } else {
                        if (form.title)       msg += `⚖️ <b>${escapeTelegramHtml(form.title)}</b>\n`;
                        if (fullCaseNumber)   msg += `📋 رقم القضية: ${escapeTelegramHtml(fullCaseNumber)}\n`;
                        if (form.court)       msg += `🏛 المحكمة: ${escapeTelegramHtml(form.court)}\n`;
                        if (finalCaseType)    msg += `📂 النوع: ${escapeTelegramHtml(finalCaseType)}\n`;
                    }
                    msg += `📆 تاريخ الجلسة: ${escapeTelegramHtml(form.session_date)} (${escapeTelegramHtml(form.session_time)})\n`;
                    if (linkMode === 'standalone') {
                        if (form.plaintiff)   msg += `👤 الموكل: ${escapeTelegramHtml(form.plaintiff)}${form.plaintiff_role ? ' — ' + escapeTelegramHtml(form.plaintiff_role) : ''}\n`;
                        if (form.defendant)   msg += `👤 الخصم: ${escapeTelegramHtml(form.defendant)}${form.defendant_role ? ' — ' + escapeTelegramHtml(form.defendant_role) : ''}\n`;
                    }
                    if (form.next_action) msg += `⚡ الإجراء القادم: ${escapeTelegramHtml(form.next_action)}\n`;
                    onNotify(msg);
                }
            } catch { /* تيليجرام اختياري */ }

            try {
                logActivity(db, linkMode === 'existing' ? 'إضافة جلسة لقضية موجودة' : 'إضافة جلسة مستقلة', {
                    entity_type: 'session',
                    details: form.session_date || null,
                });
            } catch { /* activity log اختياري */ }

            if (linkMode === 'existing') {
                toast('✅ تمت إضافة الجلسة');
                onSaved();
                onClose();
                return;
            }

            toast('✅ تمت إضافة الجلسة المستقلة');
            onSaved();
            setSavedFormData({ form, finalCaseType, finalCourtLevel, fullCaseNumber, sessionId: sessionData?.id || null });
            setPostSaveModal(true);
        } catch {
            toast('❌ حدث خطأ غير متوقع، حاول مرة أخرى', true);
        } finally {
            setSaving(false);
        }
    };

    const postSave = postSaveModal ? createPortal(
        React.createElement('div', {
            className: 'fixed inset-0 z-[60] flex items-center justify-center px-4',
            style: { background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)' }
        },
            React.createElement('div', {
                className: 'w-full max-w-sm rounded-3xl p-6 space-y-4',
                style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)' }
            },

                // ── Step 1: الخيارات الأساسية (قبل إنشاء القضية) ──
                clientStep === 'idle' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '✅'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'تمت إضافة الجلسة'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'هل تريد إنشاء سجلات إضافية؟')
                    ),
                    React.createElement('div', { className: 'space-y-2 pt-1' },
                        React.createElement('button', {
                            onClick: handleLinkCase,
                            disabled: linkingCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '⚖️'),
                            React.createElement('span', null, linkingCase ? '⏳ جاري الإنشاء...' : 'إنشاء ملف قضية من هذه البيانات')
                        ),
                        savedFormData?.form.plaintiff?.trim() && React.createElement('button', {
                            onClick: handleAddClientOnly,
                            disabled: linkingClient,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '👤'),
                            React.createElement('span', null, linkingClient ? '⏳ جاري الإضافة...' : 'إضافة الموكل لقائمة الموكلين فقط')
                        )
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'لا شكراً، إغلاق')
                ),

                // ── Step 2a: لقينا موكل في الـ DB ──
                clientStep === 'found' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '👤'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'وجدنا موكلاً مطابقاً'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, 'هل تريد ربط القضية الجديدة بـ'),
                        React.createElement('p', { className: 'text-xs font-bold text-premium-gold mt-1' }, foundClient?.full_name)
                    ),
                    React.createElement('div', { className: 'space-y-2 pt-1' },
                        React.createElement('button', {
                            onClick: handleLinkExistingClient,
                            disabled: linkingToCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '🔗'),
                            React.createElement('span', null, linkingToCase ? '⏳ جاري الربط...' : 'نعم، ربط بهذا الموكل')
                        ),
                        // ⚡ FIX: التطابق ده لما يكون مؤكد (اسم/رقم قومي/توكيل بالظبط —
                        // foundClientMatchType === 'exact') فزرار "موكل جديد" كان بيوصل
                        // لطريق مسدود، لأن checkClientDuplicate هيرفضه تاني بنفس السبب.
                        // نعرضه بس لما يكون التطابق تخمين بالاسم فقط (fuzzy).
                        foundClientMatchType !== 'exact' && React.createElement('button', {
                            onClick: handleAddAndLinkClient,
                            disabled: linkingToCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '➕'),
                            React.createElement('span', null, 'إضافة موكل جديد وربطه')
                        ),
                        foundClientMatchType === 'exact' && React.createElement('p', {
                            className: 'text-[10px] text-slate-500 text-center px-2'
                        }, 'الاسم أو الرقم القومي أو رقم التوكيل مطابق تمامًا لموكل مسجل بالفعل — لو ده شخص مختلف فعلاً، عدّل بياناته من صفحة الموكلين مباشرة.')
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'تخطي')
                ),

                // ── Step 2b: مفيش موكل ──
                clientStep === 'notfound' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-1' },
                        React.createElement('div', { className: 'text-2xl' }, '👤'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'ربط الموكل بالقضية'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, savedFormData?.form.plaintiff
                            ? `"${savedFormData.form.plaintiff}" غير موجود في الموكلين`
                            : 'لا يوجد اسم موكل في البيانات')
                    ),
                    savedFormData?.form.plaintiff?.trim() && React.createElement('div', { className: 'space-y-2 pt-1' },
                        React.createElement('button', {
                            onClick: handleAddAndLinkClient,
                            disabled: linkingToCase,
                            className: 'w-full py-3 rounded-2xl text-xs font-bold text-white border border-white/10 bg-white/5 hover:bg-white/10 transition-all disabled:opacity-40 flex items-center justify-center gap-2'
                        },
                            React.createElement('span', null, '➕'),
                            React.createElement('span', null, linkingToCase ? '⏳ جاري الإضافة...' : 'إضافة الموكل وربطه بالقضية')
                        )
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-2.5 rounded-2xl text-xs font-bold text-slate-500 hover:text-slate-300 transition-all'
                    }, 'تخطي')
                ),

                // ── Step 3: كل حاجة تمت ──
                clientStep === 'done' && React.createElement(React.Fragment, null,
                    React.createElement('div', { className: 'text-center space-y-2 py-2' },
                        React.createElement('div', { className: 'text-3xl' }, '🎉'),
                        React.createElement('h3', { className: 'text-sm font-black text-white' }, 'تم بنجاح'),
                        React.createElement('p', { className: 'text-[11px] text-slate-400' }, createdCaseId
                            ? 'تمت إضافة الجلسة وإنشاء القضية وربط الموكل'
                            : 'تمت إضافة الجلسة وربط الموكل بها')
                    ),
                    React.createElement('button', {
                        onClick: onClose,
                        className: 'w-full py-3 rounded-2xl text-xs font-black text-premium-bg transition-all',
                        style: { background: 'linear-gradient(135deg,#d4af37,#f0c040)' }
                    }, 'إغلاق')
                )
            )
        ),
        document.body
    ) : null;

    const modal = React.createElement('div', {
        className: 'fixed inset-0 z-50 flex items-end justify-center',
        style: { background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' },
        onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }
    },
        React.createElement('div', {
            className: 'w-full max-w-lg rounded-t-3xl overflow-hidden',
            style: { background: '#0f1623', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '92vh' }
        },
            // ── هيدر ──
            React.createElement('div', {
                className: 'flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/5'
            },
                React.createElement('div', { className: 'flex items-center gap-2' },
                    React.createElement('span', { className: 'text-xl' }, '⚡'),
                    React.createElement('div', null,
                        React.createElement('h2', { className: 'text-sm font-black text-white' }, linkMode === 'existing' ? 'إضافة جلسة' : 'جلسة مستقلة'),
                        React.createElement('p', { className: 'text-[10px] text-slate-400' }, linkMode === 'existing' ? 'لقضية موجودة' : 'بدون ربط بملف قضية')
                    )
                ),
                React.createElement('button', {
                    onClick: onClose,
                    className: 'w-8 h-8 flex items-center justify-center rounded-full bg-white/5 text-slate-400 text-sm hover:bg-white/10'
                }, '✕')
            ),

            // ── محتوى ──
            React.createElement('div', {
                className: 'overflow-y-auto px-5 py-4 space-y-3',
                style: { maxHeight: 'calc(92vh - 130px)' }
            },

                // ── تبديل: قضية مستقلة / قضية موجودة ──
                React.createElement('div', { className: 'flex items-center bg-white/5 rounded-2xl p-1 gap-1' },
                    React.createElement('button', {
                        onClick: () => setLinkMode('standalone'),
                        className: `flex-1 py-2 rounded-xl text-[11px] font-black transition-all ${linkMode === 'standalone' ? 'bg-premium-gold text-premium-bg' : 'text-slate-400'}`
                    }, 'قضية مستقلة'),
                    React.createElement('button', {
                        onClick: () => setLinkMode('existing'),
                        className: `flex-1 py-2 rounded-xl text-[11px] font-black transition-all ${linkMode === 'existing' ? 'bg-premium-gold text-premium-bg' : 'text-slate-400'}`
                    }, 'قضية موجودة')
                ),

                // ── اختيار قضية موجودة (يظهر بس في وضع "قضية موجودة") ──
                linkMode === 'existing' && React.createElement(React.Fragment, null,
                    React.createElement(Field, { label: 'ابحث عن القضية', required: true },
                        React.createElement('input', {
                            value: caseSearch,
                            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setCaseSearch(e.target.value),
                            placeholder: 'اسم القضية، رقمها، أو اسم الموكل/الخصم',
                            className: inputCls,
                            style: inputStyle
                        })
                    ),
                    React.createElement('div', { className: 'max-h-40 overflow-y-auto space-y-1.5 rounded-xl' },
                        filteredCases.slice(0, 20).map((c: MappedCase) => React.createElement('button', {
                            key: c.id,
                            onClick: () => { setSelectedCaseId(c.id); setCaseSearch(''); },
                            className: `w-full text-right p-2.5 rounded-xl text-[11px] border transition-all ${selectedCaseId === c.id ? 'border-premium-gold bg-premium-gold/10 text-premium-gold' : 'border-white/10 bg-white/5 text-slate-300'}`
                        }, (c.title || 'بدون عنوان') + (c.number ? ' — ' + c.number : ''))),
                        filteredCases.length === 0 && React.createElement('p', { className: 'text-[10px] text-slate-500 text-center py-2' }, 'لا توجد نتائج')
                    ),
                    selectedCase && React.createElement('div', { className: 'p-2.5 rounded-xl bg-premium-gold/10 border border-premium-gold/20 text-[11px] text-premium-gold' },
                        '✓ القضية المختارة: ' + (selectedCase.title || selectedCase.number || '—')
                    )
                ),

                // ── بيانات القضية (يظهر بس في وضع "قضية مستقلة") ──
                linkMode === 'standalone' && React.createElement(React.Fragment, null,
                React.createElement(SectionTitle, null, '⚖️ بيانات القضية'),

                // المحكمة — نص حر
                React.createElement(Field, { label: 'المحكمة' },
                    React.createElement('input', {
                        value: form.court,
                        onChange: set('court'),
                        placeholder: 'مثال: محكمة جنوب القاهرة الابتدائية',
                        className: inputCls,
                        style: inputStyle
                    })
                ),

                // موضوع الجلسة / عنوان
                React.createElement(Inp, {
                    label: 'موضوع الجلسة / عنوان',
                    required: true,
                    value: form.title,
                    onChange: set('title'),
                    placeholder: 'مثال: قضية إيجار — استئناف'
                }),

                // رقم القضية + السنة
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Inp, {
                        label: 'رقم القضية',
                        value: form.case_number,
                        onChange: set('case_number'),
                        placeholder: 'مثال: 1234'
                    }),
                    React.createElement(Inp, {
                        label: 'السنة',
                        value: form.case_year,
                        onChange: set('case_year'),
                        placeholder: 'مثال: 2024'
                    })
                ),

                // نوع القضية + الدائرة جمب بعض
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Sel, {
                        label: 'نوع القضية',
                        value: form.case_type,
                        onChange: set('case_type'),
                        options: [{ value: '', label: '— اختر —' }, ...CASE_TYPES.map((t: string) => ({ value: t, label: t }))]
                    }),
                    React.createElement(Inp, {
                        label: 'الدائرة',
                        value: form.circuit_number,
                        onChange: set('circuit_number'),
                        placeholder: 'مثال: الدائرة 7'
                    })
                ),
                form.case_type === 'أخرى' && React.createElement(Inp, {
                    label: 'نوع القضية (تفصيل)',
                    value: form.case_type_custom,
                    onChange: set('case_type_custom'),
                    placeholder: 'مثال: أحوال شخصية'
                })
                ),

                // درجة التقاضي — نفس أزرار مودال إنشاء القضية بالظبط
                React.createElement(Field, { label: 'درجة التقاضي' },
                    React.createElement('div', { className: 'flex gap-2' },
                        COURT_LEVELS.map((lvl: string) => React.createElement('button', {
                            key: lvl,
                            type: 'button',
                            onClick: () => setForm((f: Form) => ({ ...f, court_level: lvl })),
                            className: `flex-1 py-2.5 rounded-xl text-[10px] font-black transition-all active:scale-95 ${form.court_level === lvl ? 'bg-premium-gold text-premium-bg' : 'bg-white/5 border border-white/10 text-slate-400'}`
                        }, lvl))
                    ),
                    form.court_level === 'أخرى' && React.createElement('input', {
                        value: form.court_level_other,
                        onChange: set('court_level_other'),
                        placeholder: 'اكتب درجة التقاضي',
                        className: `${inputCls} mt-2`,
                        style: inputStyle
                    })
                ),

                // تاريخ الجلسة + توقيت الجلسة
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Field, { label: 'تاريخ الجلسة', required: true },
                        React.createElement('input', {
                            type: 'date',
                            value: form.session_date,
                            onChange: set('session_date'),
                            className: inputCls,
                            style: inputStyle
                        })
                    ),
                    React.createElement(Sel, {
                        label: 'توقيت الجلسة',
                        value: form.session_time,
                        onChange: set('session_time'),
                        options: [
                            { value: 'صباحي', label: '🌅 صباحي' },
                            { value: 'مسائي', label: '🌆 مسائي' },
                        ]
                    })
                ),

                // ── بيانات الخصوم ──
                linkMode === 'standalone' && React.createElement(React.Fragment, null,
                React.createElement(SectionTitle, null, '👥 بيانات الخصوم'),

                // الموكل + صفته
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Inp, {
                        label: 'الموكل',
                        required: true,
                        value: form.plaintiff,
                        onChange: set('plaintiff'),
                        placeholder: 'الاسم بالكامل'
                    }),
                    React.createElement(Inp, {
                        label: 'الصفة',
                        required: true,
                        value: form.plaintiff_role,
                        onChange: set('plaintiff_role'),
                        placeholder: 'مثال: مدعي، مستأنف'
                    })
                ),
                // رقم قومي الموكل — إجباري (راجع نتيجة 4 في تقرير الموثوقية)
                React.createElement(Inp, {
                    label: 'الرقم القومي',
                    required: true,
                    value: form.plaintiff_national_id,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f: Form) => ({ ...f, plaintiff_national_id: onlyDigits(e.target.value) })),
                    placeholder: '14 رقم',
                    inputMode: 'numeric',
                    maxLength: 14
                }),
                // بيانات التوكيل — سطر كامل: رقم / حرف / سنة / مكتب توثيق
                React.createElement(PoaInput, {
                    value: form.plaintiff_power_of_attorney,
                    onChange: (v: string) => setForm((f: Form) => ({ ...f, plaintiff_power_of_attorney: v }))
                }),

                React.createElement('div', { className: 'border-t border-white/5 my-1' }),

                // الخصم + صفته
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Inp, {
                        label: 'الخصم',
                        required: true,
                        value: form.defendant,
                        onChange: set('defendant'),
                        placeholder: 'الاسم بالكامل'
                    }),
                    React.createElement(Inp, {
                        label: 'الصفة',
                        required: true,
                        value: form.defendant_role,
                        onChange: set('defendant_role'),
                        placeholder: 'مثال: مدعى عليه، مستأنف ضده'
                    })
                ),
                // رقم قومي الخصم
                React.createElement(Inp, {
                    label: 'الرقم القومي',
                    value: form.defendant_national_id,
                    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f: Form) => ({ ...f, defendant_national_id: onlyDigits(e.target.value) })),
                    placeholder: '14 رقم',
                    inputMode: 'numeric',
                    maxLength: 14
                })
                ),

                // ── الإجراء القادم ──
                React.createElement(SectionTitle, null, '⚡ الإجراء القادم'),
                React.createElement(Inp, {
                    label: 'الإجراء القادم',
                    value: form.next_action,
                    onChange: set('next_action'),
                    placeholder: 'مثال: تقديم مذكرة دفاع'
                }),

                // الطابق وقاعة الجلسة + قاعة/اسم/موبايل سكرتير الجلسة
                React.createElement(Inp, {
                    label: 'الطابق وقاعة الجلسة',
                    value: form.session_hall,
                    onChange: set('session_hall'),
                    placeholder: 'مثال: الدور الأول - قاعة 5'
                }),
                React.createElement(Inp, {
                    label: 'قاعة سكرتير الجلسة',
                    value: form.secretary_hall,
                    onChange: set('secretary_hall'),
                    placeholder: 'رقم أو اسم قاعة السكرتير'
                }),
                React.createElement('div', { className: 'grid grid-cols-2 gap-3' },
                    React.createElement(Inp, {
                        label: 'اسم سكرتير الجلسة',
                        value: form.secretary_name,
                        onChange: set('secretary_name'),
                        placeholder: 'اسم السكرتير'
                    }),
                    React.createElement(Inp, {
                        label: 'موبايل السكرتير',
                        value: form.secretary_mobile,
                        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f: Form) => ({ ...f, secretary_mobile: onlyDigits(e.target.value, 11) })),
                        placeholder: 'رقم الموبايل',
                        inputMode: 'numeric',
                        maxLength: 11
                    })
                ),

                React.createElement('div', { className: 'h-4' })
            ),

            // ── Footer ──
            React.createElement('div', {
                className: 'px-5 py-4 border-t border-white/5 flex gap-3'
            },
                React.createElement('button', {
                    onClick: onClose,
                    className: 'flex-1 py-3 rounded-2xl text-xs font-bold text-slate-400 bg-white/5 hover:bg-white/10 transition-all'
                }, 'إلغاء'),
                React.createElement('button', {
                    onClick: handleSave,
                    disabled: saving || !form.session_date || (linkMode === 'existing' && !selectedCaseId),
                    className: 'flex-2 flex-grow-[2] py-3 rounded-2xl text-xs font-black text-premium-bg transition-all disabled:opacity-40',
                    style: { background: saving ? '#888' : 'linear-gradient(135deg,#d4af37,#f0c040)' }
                }, saving ? '⏳ جاري الحفظ...' : '✅ حفظ الجلسة')
            )
        )
    );

    return React.createElement(React.Fragment, null,
        createPortal(modal, document.body),
        postSave
    );
}
