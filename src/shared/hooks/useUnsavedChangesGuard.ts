// ══════════════════════════════════════════════════════════════
//  useUnsavedChangesGuard — بيلف onClose الأصلي لأي فورم، ولو
//  الفورم فيه تغييرات عن حالته الأولية، بيعرض تأكيد قبل الإغلاق
//  الفعلي (بدل ما يقفل على طول ويضيع الكلام).
//
//  ده تحذير للخروج "بالغلط" بس (دوس رجوع/✕ بالغلط) — مش بديل عن
//  useFormDraft (اللي بيغطي الخروج المفاجئ/غير المتعمد زي قفل
//  التطبيق من النظام). الاتنين بيشتغلوا مع بعض.
//
//  الاستخدام:
//
//    const guardedClose = useUnsavedChangesGuard(form, initialForm, onClose);
//    // استخدم guardedClose بدل onClose في زرار الإغلاق وoverlay click
//
//  خطة حفظ المسودات التلقائي — 1 أغسطس 2026.
// ══════════════════════════════════════════════════════════════

import { useCallback, useRef, useEffect } from 'react';

const CONFIRM_MESSAGE = 'لديك بيانات لم يتم حفظها بعد. هل تريد الخروج بدون حفظ؟';

export function useUnsavedChangesGuard<T>(current: T, baseline: T, onClose: () => void): () => void {
    // baseline بتتاخد نسخة ثابتة أول مرة بس (حالة الفورم الأصلية/المحمّلة)
    const baselineRef = useRef<string>(JSON.stringify(baseline));
    useEffect(() => {
        baselineRef.current = JSON.stringify(baseline);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return useCallback(() => {
        let isDirty = false;
        try { isDirty = JSON.stringify(current) !== baselineRef.current; } catch { isDirty = false; }
        if (!isDirty) { onClose(); return; }
        if (window.confirm(CONFIRM_MESSAGE)) onClose();
    }, [current, onClose]);
}
