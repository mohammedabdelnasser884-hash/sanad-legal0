// إشعارات الواجهة: toast، بانر الأوفلاين، مؤشر المزامنة
// 🔒 FIX (تشخيص لوجز E2E — 1 أغسطس 2026): كل نداء لـtoast() كان بيجدول
// setTimeout منفصل لإزالة كلاس 'show' بعد 3.4 ثانية، من غير إلغاء أي
// setTimeout سابق لسه شغّال. لو توستان حصلوا في وقت قريب من بعض (مثلاً:
// رفع مستند ثم حذفه بعد أقل من 3.4 ثانية)، الـtimeout الأول كان بيمسح
// 'show' بدري وهو لسه المفروض يعرض رسالة التوست الثاني — يعني التوست
// التاني بيختفي بصريًا (أو بيبقى غير مرئي لـPlaywright) قبل مدته الطبيعية.
// الحل: نحتفظ بمعرّف الـtimeout الحالي ونلغيه قبل ما نجدول واحد جديد.
let toastHideTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(msg: string, isErr = false) {
    const el = document.getElementById('toast');
    if (!el) return;
    if (toastHideTimer !== null) clearTimeout(toastHideTimer);
    el.textContent = msg;
    (el as HTMLElement).style.borderColor = isErr ? '#f87171' : '#D4AF37';
    (el as HTMLElement).style.color = isErr ? '#f87171' : '#D4AF37';
    el.classList.add('show');
    toastHideTimer = setTimeout(() => { el.classList.remove('show'); toastHideTimer = null; }, 3400);
}

export function showOfflineBanner(pendingCount = 0) {
    const banner = document.getElementById('offline-banner');
    const badge  = document.getElementById('offline-queue-badge');
    if (!banner) return;
    banner.classList.add('visible');
    if (badge) {
        if (pendingCount > 0) { badge.textContent = `${pendingCount} معلّق`; (badge as HTMLElement).style.display = 'inline'; }
        else (badge as HTMLElement).style.display = 'none';
    }
}

export function hideOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.classList.remove('visible');
}

export function showSyncIndicator(text = 'جاري المزامنة...') {
    const el = document.getElementById('sync-indicator');
    const tx = document.getElementById('sync-text');
    if (el) el.classList.add('visible');
    if (tx) tx.textContent = text;
}

export function hideSyncIndicator(successText: string | null = null) {
    const el = document.getElementById('sync-indicator');
    const tx = document.getElementById('sync-text');
    if (successText && tx) {
        tx.textContent = successText;
        setTimeout(() => { if (el) el.classList.remove('visible'); }, 2000);
    } else {
        if (el) el.classList.remove('visible');
    }
}

export async function flushPendingSubscription() {
    if (window.__pendingSubscription) {
        await window.__savePushSubscription(window.__pendingSubscription);
        window.__pendingSubscription = null;
    }
}
