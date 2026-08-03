// ══════════════════════════════════════════════════════════════
//  useFormDraft — حفظ مسودة أي فورم (قضية/جلسة مستقلة/موكل...)
//  تلقائيًا في localStorage أثناء الكتابة، عشان لو المستخدم خرج من
//  التطبيق فجأة قبل ما يدوس "حفظ" (مكالمة، تطبيق تاني ياخد الفوكس،
//  إغلاق من الميموري...) ميرجعش يلاقي الفورم فاضي.
//
//  الاستخدام (جوه أي مكوّن فورم، بعد useState(form)):
//
//    const draft = useFormDraft({ key: 'new-case', data: form });
//    useEffect(() => {
//        if (draft.restoredDraft) {
//            setForm(draft.restoredDraft);
//            toast('تم استرجاع بيانات كنت بتكتبها قبل كده');
//            draft.dismissRestoredDraft();
//        }
//        // eslint-disable-next-line react-hooks/exhaustive-deps
//    }, [draft.restoredDraft]);
//    // بعد نجاح الحفظ الفعلي فقط:
//    draft.clearDraft();
//
//  المفتاح (key) لازم يكون مميز لكل فورم/سجل — مثلاً 'new-case' للفورم
//  الفاضي، أو `edit-case:${caseId}` لفورم تعديل قضية بعينها، عشان
//  مسودة قضية معينة ما تختلطش بمسودة قضية تانية.
//
//  الفورمات اللي فيها بيانات محمّلة من السيرفر أصلاً (Edit*) لازم تبعت
//  enabled=false لحد ما البيانات الأولية تتحمّل فعليًا، عشان الفحص
//  الأول للمسودة (وأي حفظ تلقائي) ميحصلش على بيانات فاضية مؤقتة.
//
//  خطة حفظ المسودات التلقائي — 1 أغسطس 2026.
// ══════════════════════════════════════════════════════════════

import { useEffect, useRef, useState, useCallback } from 'react';
import { db } from '../../supabaseClient';

const DEBOUNCE_MS = 800;

// هوية المستخدم بتتجاب مرة واحدة بس وتتكاش، عشان لو أكتر من فورم فاتح
// نفس الوقت (أو بعضهم ورا بعض) ميحصلش نداء auth.getSession() لكل واحد.
let cachedUserId: string | null = null;
let userIdPromise: Promise<string> | null = null;

async function resolveUserId(): Promise<string> {
    if (cachedUserId) return cachedUserId;
    if (!userIdPromise) {
        userIdPromise = db.auth.getSession()
            .then(({ data }) => {
                cachedUserId = data.session?.user?.id || 'anon';
                return cachedUserId;
            })
            .catch(() => 'anon');
    }
    return userIdPromise;
}

// ⚠️ المفتاح متضمّن هوية المستخدم عشان لو محامي تاني بيستخدم نفس
// الجهاز (متصفح مشترك)، ميشوفش مسودة زميله ولا يختلط بيها.
function storageKey(formKey: string, userId: string): string {
    return `sanad_draft_v1_${userId}_${formKey}`;
}

export interface UseFormDraftOptions<T> {
    /** مفتاح مميز لكل فورم/سجل — راجع الشرح فوق */
    key: string;
    /** بيانات الفورم الحالية (لازم تكون قابلة لـ JSON.stringify) */
    data: T;
    /** لو false، الـhook مبيعملش أي حفظ ولا فحص مسودات (مثلاً: لحد ما بيانات فورم التعديل تتحمّل) */
    enabled?: boolean;
    /** اختياري: دالة بترجع true لو الفورم/المسودة فاضية فعليًا (فمفيش داعي نخزنها أو نعرضها كمسودة) */
    isEmpty?: (data: T) => boolean;
}

export interface UseFormDraftResult<T> {
    /** مسودة اتلاقت محفوظة عند الفتح — null لو مفيش أو لسه بيتفحص */
    restoredDraft: T | null;
    /** ينادى بعد ما الفورم الأب يطبّق الـrestoredDraft، عشان الحلقة متتكررش */
    dismissRestoredDraft: () => void;
    /** ينادى بعد نجاح الحفظ الفعلي في قاعدة البيانات */
    clearDraft: () => void;
}

export function useFormDraft<T>({ key, data, enabled = true, isEmpty }: UseFormDraftOptions<T>): UseFormDraftResult<T> {
    const [restoredDraft, setRestoredDraft] = useState<T | null>(null);
    const [checked, setChecked] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const userIdRef = useRef<string>('anon');

    // فحص أوّلي: هل فيه مسودة محفوظة من قبل لنفس المفتاح؟
    useEffect(() => {
        if (!enabled) return undefined;
        let cancelled = false;
        setChecked(false);
        resolveUserId().then((uid) => {
            if (cancelled) return;
            userIdRef.current = uid;
            try {
                const raw = localStorage.getItem(storageKey(key, uid));
                if (raw) {
                    const parsed = JSON.parse(raw) as T;
                    if (!isEmpty || !isEmpty(parsed)) setRestoredDraft(parsed);
                }
            } catch { /* مسودة تالفة أو localStorage معطلة — نتجاهل، مش خطأ حرج */ }
            setChecked(true);
        });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);

    // حفظ تلقائي (debounced) بعد كل تغيير في بيانات الفورم
    useEffect(() => {
        if (!enabled || !checked) return undefined;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            try {
                if (isEmpty && isEmpty(data)) {
                    localStorage.removeItem(storageKey(key, userIdRef.current));
                } else {
                    localStorage.setItem(storageKey(key, userIdRef.current), JSON.stringify(data));
                }
            } catch { /* localStorage ممتلئة/معطلة — الحفظ الأساسي مش متأثر، نتجاهل بصمت */ }
        }, DEBOUNCE_MS);
        return () => { if (timerRef.current) clearTimeout(timerRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, enabled, checked, key]);

    const clearDraft = useCallback(() => {
        try { localStorage.removeItem(storageKey(key, userIdRef.current)); } catch { /* ignore */ }
    }, [key]);

    const dismissRestoredDraft = useCallback(() => setRestoredDraft(null), []);

    return { restoredDraft, dismissRestoredDraft, clearDraft };
}
