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

// ══════════════════════════════════════════════════════════════
//  🔒 NEW (تقرير فحص أعطال الأوف لاين — 13 أغسطس 2026): فحوصات التكرار
//  (رقم قيد القضية / بيانات الموكل) بتتنفذ *قبل* أي INSERT/UPDATE فعلي في
//  5 دوال حفظ، وكانت بتنادي db.from(...) مباشرة من غير أي وعي بحالة
//  الاتصال — يعني أوف لاين، الفحص نفسه بيفشل (مفيش نت يوصله للسيرفر)،
//  والـ catch حوله كان بيعرض توست خطأ ويوقف العملية بالكامل (return false)
//  من غير ما توصل خالص لـ window.__dbWrite (المكان الوحيد اللي فيه منطق
//  التقييد في طابور الأوفلاين).
//
//  runDuplicateCheckOfflineAware بتلف نداء فحص التكرار بنفس منطق
//  createFetchGuard: لو أوف لاين من الأساس أو الفحص عدّى الـ8 ثواني
//  (تايم آوت)، بترجع skipped:true (يعني "أجّل الفحص، السيرفر هيرفض
//  التكرار وقت المزامنة الفعلية على أي حال عن طريق الـUNIQUE index") بدل
//  ما توقف الحفظ. أي خطأ حقيقي تاني (مش أوف لاين ولا تايم آوت) بيتعاد
//  رميه زي ما هو عشان المنادي يفضل يعامله بنفس الأسلوب القديم (توست خطأ +
//  إيقاف الحفظ).
// ══════════════════════════════════════════════════════════════

export interface DuplicateCheckOutcome<T> {
    /** true = الفحص اتأجل (أوف لاين أو تايم آوت) — مفيش نتيجة فعلية، كمّل الحفظ عادي */
    skipped: boolean;
    result?: T;
}

export async function runDuplicateCheckOfflineAware<T>(
    checkFn: (signal: AbortSignal) => Promise<T>,
    timeoutMs = 8000
): Promise<DuplicateCheckOutcome<T>> {
    const guard = createFetchGuard(timeoutMs);
    if (guard.offline) return { skipped: true };
    try {
        const result = await checkFn(guard.controller.signal);
        return { skipped: false, result };
    } catch (e) {
        if (guard.didTimeOut()) return { skipped: true };
        throw e;
    } finally {
        guard.cleanup();
    }
}
