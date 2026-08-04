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
//    const { guardedClose, confirmModal } =
//        useUnsavedChangesGuard(form, initialForm, onClose);
//    // استخدم guardedClose بدل onClose في زرار الإغلاق وoverlay click،
//    // وضيف confirmModal في أي مكان في الشجرة اللي بيرجعها الكومبوننت
//    // (بيرندر بورتال، فمكانه في الشجرة مش مهم).
//
//  خطة حفظ المسودات التلقائي — 1 أغسطس 2026.
//  🔒 FIX (قرار مفتوح اتقفل، 3 أغسطس 2026): كان بيستخدم window.confirm
//  الافتراضي (شكل المتصفح، مش شكل التطبيق) — بقى دلوقتي بيرجّع state
//  + مودال مصمم (UnsavedChangesConfirmModal.tsx) بدل ما ينده window.confirm
//  مباشرة، بنفس منطق isDirty القديم بالظبط.
//
//  🔒 FIX (مراجعة ثانية، 3 أغسطس 2026): زر الرجوع الفعلي (Android/PWA)
//  كان بيقفل المودال مباشرة من غير أي تحذير خالص — useNavigation.ts
//  بيتعامل مع المودالات دي (newCase/caseDetail/newClient/...) كـ"مودال
//  رئيسي" عادي (راجع onPop → Case 1 هناك)، واللي بيقفله على طول من غير
//  ما يعدي على guardedClose أصلاً. بنسجّل نفس منطق الحراسة كـ"نموذج
//  فرعي" عن طريق registerNestedModal، اللي onPop بيفحصه **قبل** أي حاجة
//  تانية — فزر الرجوع بقى بيوصل للحراسة دي الأول بدل ما يقفل المودال
//  الرئيسي على طول.
// ══════════════════════════════════════════════════════════════

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { registerNestedModal } from '../../useNavigation';
import UnsavedChangesConfirmModal from '../modals/UnsavedChangesConfirmModal';

interface UnsavedChangesGuard {
    guardedClose: () => void;
    /** ريندر ده في أي مكان في الشجرة اللي الكومبوننت بترجعها — بيبقى
     *  null لحد ما فيه تغييرات فعلية والمستخدم حاول يقفل (زرار ✕/overlay
     *  click/زر الرجوع الفعلي، الثلاثة بيمروا من نفس المنطق تحت). */
    confirmModal: React.ReactNode;
}

export function useUnsavedChangesGuard<T>(current: T, baseline: T, onClose: () => void): UnsavedChangesGuard {
    // baseline بتتاخد نسخة ثابتة أول مرة بس (حالة الفورم الأصلية/المحمّلة)
    const baselineRef = useRef<string>(JSON.stringify(baseline));
    useEffect(() => {
        baselineRef.current = JSON.stringify(baseline);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // آخر نسخة من current/onClose — الدالة المسجّلة لزر الرجوع الفعلي
    // (registerNestedModal تحت) بتتنادى بعد كده بوقت (مش وقت الرندر)،
    // فلازم تقرا القيمة الطازة وقت الاستدعاء الفعلي مش نسخة قديمة اتقفلت
    // (closure) وقت التسجيل.
    const latestRef = useRef({ current, onClose });
    useEffect(() => { latestRef.current = { current, onClose }; });

    const [isConfirmOpen, setIsConfirmOpen] = useState(false);

    const isDirtyNow = useCallback(() => {
        try { return JSON.stringify(latestRef.current.current) !== baselineRef.current; }
        catch { return false; }
    }, []);

    const guardedClose = useCallback(() => {
        if (!isDirtyNow()) { latestRef.current.onClose(); return; }
        setIsConfirmOpen(true);
    }, [isDirtyNow]);

    // زر الرجوع الفعلي — بنسجّل نفس المنطق بالظبط كـ"نموذج فرعي".
    // regEpoch: بتزيد كل مرة زر الرجوع يتضغط والفورم يقرر يفضل مفتوح
    // (فيه بيانات لسه) — registerNestedModal بيتشال تلقائيًا من الستاك
    // أول ما يتنادى، فلازم نسجّله تاني فورًا عشان ضغطة رجوع تانية (لسه في
    // شاشة التأكيد، أو بعد ما المستخدم يلغي) تتحمي بنفس الطريقة بالظبط.
    const [regEpoch, setRegEpoch] = useState(0);
    useEffect(() => {
        return registerNestedModal(() => {
            if (!isDirtyNow()) { latestRef.current.onClose(); return; }
            setIsConfirmOpen(true);
            setRegEpoch((n) => n + 1);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [regEpoch]);

    const confirmModal = isConfirmOpen
        ? React.createElement(UnsavedChangesConfirmModal, {
            onConfirm: () => { setIsConfirmOpen(false); latestRef.current.onClose(); },
            onCancel: () => setIsConfirmOpen(false),
        })
        : null;

    return { guardedClose, confirmModal };
}
