import React from 'react';
import { createPortal } from 'react-dom';

// ══════════════════════════════════════════════════════════════
//  UnsavedChangesConfirmModal — بديل مصمم بشكل التطبيق لـ
//  window.confirm الافتراضي، لما useUnsavedChangesGuard يحتاج يسأل
//  المستخدم قبل ما يقفل فورم فيه بيانات لسه ما اتحفظتش.
//
//  نفس نمط ExitConfirmModal.tsx بالحرف (أيقونة + عنوان + وصف + زرارين
//  في شبكة)، بس بلون تحذير (كهرماني) بدل الأحمر، ومكتوب مناسب لسياق
//  "بيانات غير محفوظة" بدل "الخروج من التطبيق". z-[95]: أعلى من أي
//  فورم بيستخدمها (أعلى قيمة عندهم z-[80] في NewClientModal) وأعلى من
//  تأكيدات الحذف (z-[90])، وأقل من تأكيد الخروج من التطبيق (z-[9999]).
//
//  خطة حفظ المسودات التلقائي — قرار مفتوح اتقفل، 3 أغسطس 2026.
// ══════════════════════════════════════════════════════════════

interface UnsavedChangesConfirmModalProps {
    onConfirm: () => void;
    onCancel: () => void;
}

function UnsavedChangesConfirmModal({ onConfirm, onCancel }: UnsavedChangesConfirmModalProps) {
    return createPortal(
        React.createElement('div', {
            className: 'fixed inset-0 z-[95] flex items-end justify-center',
            style: { background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' },
            onClick: onCancel,
            'data-testid': 'unsaved-changes-confirm-modal'
        },
            React.createElement('div', {
                className: 'w-full max-w-sm mx-4 mb-8 rounded-3xl overflow-hidden',
                style: { background: '#0d1f35', border: '1px solid rgba(255,255,255,0.08)' },
                onClick: (e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()
            },
                React.createElement('div', { className: 'px-6 pt-6 pb-2 text-center' },
                    React.createElement('div', {
                        className: 'w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4',
                        style: { background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)' }
                    },
                        React.createElement('svg', { xmlns: 'http://www.w3.org/2000/svg', className: 'w-7 h-7 text-amber-400', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                            React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.75 16.126ZM12 15.75h.007v.008H12v-.008Z' })
                        )
                    ),
                    React.createElement('h3', { className: 'text-base font-black text-white mb-1' }, 'بيانات غير محفوظة'),
                    React.createElement('p', { className: 'text-xs text-slate-400 font-medium' }, 'لديك بيانات لم يتم حفظها بعد. هل تريد الخروج بدون حفظ؟')
                ),
                React.createElement('div', { className: 'grid grid-cols-2 gap-3 p-4' },
                    React.createElement('button', {
                        onClick: onCancel,
                        'data-testid': 'unsaved-changes-cancel',
                        className: 'py-3 rounded-2xl text-sm font-black text-white active:scale-95 transition-all',
                        style: { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }
                    }, 'إلغاء'),
                    React.createElement('button', {
                        onClick: onConfirm,
                        'data-testid': 'unsaved-changes-confirm',
                        className: 'py-3 rounded-2xl text-sm font-black text-white active:scale-95 transition-all',
                        style: { background: 'linear-gradient(135deg,#f59e0b,#d97706)', boxShadow: '0 4px 15px rgba(245,158,11,0.3)' }
                    }, 'خروج بدون حفظ')
                )
            )
        ),
        document.body
    );
}

export default UnsavedChangesConfirmModal;
