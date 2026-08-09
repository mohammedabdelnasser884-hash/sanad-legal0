import { describe, it, expect, vi, beforeEach } from 'vitest';

// ══════════════════════════════════════════════════════════════════
// ✅ NEW (فيكس "البانر البرتقالي بيفضل ثابت حتى بعد رجوع النت" —
// 9 أغسطس 2026): offlineQueue.ts كان عنده مستمعين على أحداث مخصصة
// 'network-offline'/'network-online' محدش في المشروع كله كان بيبعتها
// (dispatchEvent) — فـhideOfflineBanner ماكانتش بتتنادى أبدًا لما النت
// يرجع فعليًا. الفيكس: ربط نفس المنطق بأحداث المتصفح الحقيقية
// 'online'/'offline'. التست ده بيتأكد من السلوك الجديد مباشرة.
//
// نفس نمط offlineQueue.fkTempId.test.ts بالظبط (mock لموديولات
// offlineQueue.ts الثلاثة قبل الاستيراد، عشان الاستيراد نفسه ميفشلش).
// ══════════════════════════════════════════════════════════════════
vi.mock('../supabaseClient', () => ({ db: {} }));

const showOfflineBanner = vi.fn();
const hideOfflineBanner = vi.fn();
const showSyncIndicator = vi.fn();
const hideSyncIndicator = vi.fn();
vi.mock('../shared/lib/notifications', () => ({
  showOfflineBanner: (...a: unknown[]) => showOfflineBanner(...a),
  hideOfflineBanner: (...a: unknown[]) => hideOfflineBanner(...a),
  showSyncIndicator: (...a: unknown[]) => showSyncIndicator(...a),
  hideSyncIndicator: (...a: unknown[]) => hideSyncIndicator(...a),
  toast: vi.fn(),
}));
vi.mock('../shared/lib/dataAccess', () => ({ logActivity: vi.fn(), recalcNextHearing: vi.fn() }));

describe('offlineQueue.ts — بانر الأوفلاين مربوط بأحداث المتصفح الحقيقية', () => {
  beforeEach(async () => {
    vi.resetModules();
    showOfflineBanner.mockClear();
    hideOfflineBanner.mockClear();
    showSyncIndicator.mockClear();
    hideSyncIndicator.mockClear();
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    window.__getOfflineQueueCount = vi.fn(async () => 0);
    await import('./offlineQueue');
  });

  it('حدث المتصفح الحقيقي "offline" → showOfflineBanner بتتنادى', async () => {
    window.dispatchEvent(new Event('offline'));
    await Promise.resolve();
    await Promise.resolve();
    expect(showOfflineBanner).toHaveBeenCalled();
  });

  it('حدث المتصفح الحقيقي "online" → hideOfflineBanner بتتنادى فورًا', async () => {
    window.dispatchEvent(new Event('offline'));
    await Promise.resolve();
    showOfflineBanner.mockClear();

    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();
    expect(hideOfflineBanner).toHaveBeenCalled();
  });

  it('"online" ومفيش عمليات معلّقة (count=0) → مؤشر المزامنة منعرضش خالص (كان بيفضل عالق للأبد قبل الفيكس)', async () => {
    window.__getOfflineQueueCount = vi.fn(async () => 0);
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();
    expect(showSyncIndicator).not.toHaveBeenCalled();
  });

  it('"online" وفيه عمليات معلّقة (count>0) → مؤشر المزامنة بيتعرض', async () => {
    window.__getOfflineQueueCount = vi.fn(async () => 3);
    window.dispatchEvent(new Event('online'));
    await Promise.resolve();
    await Promise.resolve();
    expect(showSyncIndicator).toHaveBeenCalledWith('جاري المزامنة...');
  });

  it('الأحداث المخصصة القديمة "network-offline"/"network-online" مالهاش تأثير دلوقتي (تأكيد إنها بقت مش مستخدمة)', async () => {
    window.dispatchEvent(new CustomEvent('network-offline'));
    await Promise.resolve();
    expect(showOfflineBanner).not.toHaveBeenCalled();

    window.dispatchEvent(new CustomEvent('network-online'));
    await Promise.resolve();
    expect(hideOfflineBanner).not.toHaveBeenCalled();
  });
});
