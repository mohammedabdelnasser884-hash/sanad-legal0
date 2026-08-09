// ══════════════════════════════════════════════════════════════
//  offlineGuard — نفس نمط الحماية المستخدم في useDbConnectivity.ts
//  و useAuthProfile.ts (فحص navigator.onLine أولاً + سقف 8 ثواني
//  AbortController)، مستخرج هنا كمكان مشترك عشان يتطبق على شاشات
//  القراءة (القضايا/الموكلين/التذكيرات/الجلسات) من غير تكرار نفس
//  الكود 5 مرات.
//
//  ⚡ NEW (فيكس "تأخير محسوس عند التنقل بين الأقسام أوف لاين" —
//  9 أغسطس 2026): قبل كده كل شاشة/تاب كانت بتنادي db.from(...)
//  مباشرة من غير أي فحص أو سقف زمني — لو النت ضعيف/متقطع (مش أوف
//  لاين بالكامل بحيث navigator.onLine يبقى false)، الطلب كان بيفضل
//  معلّق لحد ما يفشل من نفسه (وقت غير محدد حسب المتصفح/الشبكة) قبل
//  ما يرجع للكاش. دلوقتي: 1) لو navigator.onLine=false من الأساس،
//  منحاولش نتصل بالسيرفر خالص ونروح للكاش فورًا، 2) لو هنحاول
//  الاتصال فعلاً، بنقفله بعد 8 ثواني كحد أقصى.
// ══════════════════════════════════════════════════════════════

export interface FetchGuard {
    /** true لو navigator.onLine=false من الأساس (مفيش داعي نحاول نتصل خالص) */
    offline: boolean;
    /** AbortController جاهز — مرّره لـ .abortSignal(guard.controller.signal) */
    controller: AbortController;
    /** استخدمها بعد ما catch تمسك خطأ، عشان تعرف السبب كان timeout ولا لأ */
    didTimeOut: () => boolean;
    /** لازم تتنادى في finally عشان تلغي الـ setTimeout لو الطلب خلص قبل الوقت */
    cleanup: () => void;
}

export function createFetchGuard(timeoutMs = 8000): FetchGuard {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = offline ? null : setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    return {
        offline,
        controller,
        didTimeOut: () => timedOut,
        cleanup: () => { if (timeoutId) clearTimeout(timeoutId); },
    };
}
