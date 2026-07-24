import React from 'react';

// ── سطر الأطراف: المدعي ضد المدعى عليه (مع تباعد و"ضد" بلون مميز) ──
interface PartiesLineProps {
    plaintiff?: string | null;
    defendant?: string | null;
    // ⚡ NEW (24 يوليو، خطة سد فجوات عرض الأطراف — مرحلة 2): لو الطرف فيه
    // أكتر من شخص ومكتوب له مسمى قانوني، يُستخدم بدل الاسم المفرد. اختياريان
    // بالكامل — فاضيين (الحالة الغالبة) يعني صفر تغيير عن السلوك القديم.
    plaintiffLegalTitle?: string | null;
    defendantLegalTitle?: string | null;
    fallback?: string | null;
    className?: string;
}
export function PartiesLine({ plaintiff, defendant, plaintiffLegalTitle, defendantLegalTitle, fallback, className = '' }: PartiesLineProps) {
    const displayPlaintiff = plaintiffLegalTitle || plaintiff;
    const displayDefendant = defendantLegalTitle || defendant;
    if (displayPlaintiff && displayDefendant) {
        return React.createElement('p', { className: `truncate leading-tight ${className}` },
            React.createElement('span', null, displayPlaintiff),
            React.createElement('span', { className: 'mx-1.5 font-black', style: { color: '#a78bfa' } }, 'ضد'),
            React.createElement('span', null, displayDefendant)
        );
    }
    return React.createElement('p', { className: `truncate leading-tight ${className}` }, displayPlaintiff || displayDefendant || fallback);
}
