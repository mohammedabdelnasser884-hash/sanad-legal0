// ══════════════════════════════════════════════════════════════
//  useNestedModalBackButton — بيخلي أي "نموذج فرعي" (بيتفتح جوه مودال
//  رئيسي مفتوح بالفعل من useNavigation، زي نموذج فرعي لطرف الدعوى جوه
//  NewCaseModal) يتقفل صح لما المستخدم يدوس زر الرجوع الفعلي، بدل ما زر
//  الرجوع يقفل المودال الرئيسي أو يتوه (نفس مشكلة زر الرجوع القديمة في
//  قسمي الوثائق والأرشيف — راجع تعليق nestedModalStack في useNavigation.ts).
//
//  الاستخدام: ينادَى unconditionally في أي مكوّن نموذج فرعي، بتمرير حالة
//  الفتح الحالية ودالة القفل:
//
//    useNestedModalBackButton(isOpen, () => setIsOpen(false));
//
//  خطة "تطوير أطراف الدعوى" — مرحلة 4 (23 يوليو 2026).
// ══════════════════════════════════════════════════════════════

import { useEffect } from 'react';
import { registerNestedModal } from '../../useNavigation';

export function useNestedModalBackButton(isOpen: boolean, onClose: () => void): void {
    useEffect(() => {
        if (!isOpen) return undefined;
        return registerNestedModal(onClose);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);
}
