import React from 'react';
import { I } from '../../constants';

interface AIComingSoonModalProps {
    onClose: () => void;
}

// ─────────────────────────────────────────────────────────
//  AIComingSoonModal — بيتفتح بدل قسم المساعد الذكي (AI) لكل
//  المستخدمين ما عدا السوبر أدمن (راجع isAISuperAdmin في App.tsx).
//  نفس نمط التصميم المستخدم في DeleteConfirmModal (بطاقة وسط
//  الشاشة + خلفية داكنة قابلة للإغلاق باللمس برّه البطاقة).
// ─────────────────────────────────────────────────────────
function AIComingSoonModal({ onClose }: AIComingSoonModalProps) {
    return React.createElement('div', {
        className: 'fixed inset-0 z-[90] flex items-center justify-center bg-black/80 backdrop-blur-sm p-5',
        onClick: (e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); },
        'data-testid': 'ai-coming-soon-modal',
    },
        React.createElement('div', { className: 'w-full max-w-sm bg-premium-card border border-white/10 rounded-3xl p-6 slide-up shadow-2xl text-center space-y-4' },
            React.createElement('div', {
                className: 'w-16 h-16 mx-auto rounded-2xl flex items-center justify-center',
                style: { background: 'linear-gradient(135deg,#c9922a,#D4AF37,#E8C84A)', boxShadow: '0 4px 24px rgba(212,175,55,0.4)' }
            }, React.createElement(I.AI, { cls: 'w-8 h-8 text-[#070d1a]' })),
            React.createElement('h3', { className: 'text-base font-black text-white' }, 'المساعد الذكي قريبًا'),
            React.createElement('p', { className: 'text-xs text-slate-400 font-bold leading-relaxed' },
                'قسم المساعد الذكي قيد التطوير حاليًا ضمن خطتنا لتحسين تجربتكم على المنصة. ترقّبوا إطلاقه قريبًا.'
            ),
            React.createElement('button', {
                onClick: onClose,
                'data-testid': 'ai-coming-soon-close',
                className: 'w-full py-3 rounded-xl font-black text-sm text-premium-bg active:scale-95 transition-all',
                style: { background: 'linear-gradient(135deg,#D4AF37,#E8C84A)' }
            }, 'تمام')
        )
    );
}

export default AIComingSoonModal;
