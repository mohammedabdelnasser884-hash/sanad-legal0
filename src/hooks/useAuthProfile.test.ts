import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { ProfileRow } from '../types';

// ══════════════════════════════════════════════════════════════════
// Mock db (supabaseClient) — بيغطي الاستخدامات الفعلية في useAuthProfile.ts:
//   - db.auth.getSession()                                    [effect أول]
//   - db.auth.onAuthStateChange(cb)                            [effect أول]
//   - db.from('profiles').select('*').eq('user_id',x).maybeSingle() [loadProfile]
// مفيش استخدام لـ db.from خارج ده في الملف.
// ══════════════════════════════════════════════════════════════════
type MaybeSingleResult = { data: Partial<ProfileRow> | null; error: { message: string } | null };

let getSessionResult: { data: { session: { user: { id: string; email?: string | null } } | null } } = {
  data: { session: null },
};
let maybeSingleResult: MaybeSingleResult = { data: null, error: null };
let abortShouldHang = false;
let authChangeListeners: Array<(event: string, session: { user: { id: string; email?: string | null } } | null) => void> = [];
const unsubscribeSpy = vi.fn();
const fromSpy = vi.fn();

const getSession = vi.fn(() => Promise.resolve(getSessionResult));
const onAuthStateChange = vi.fn((cb: (event: string, session: { user: { id: string; email?: string | null } } | null) => void) => {
  authChangeListeners.push(cb);
  return { data: { subscription: { unsubscribe: unsubscribeSpy } } };
});

function buildMaybeSingleChain() {
  return {
    eq: vi.fn((col: string, val: unknown) => {
      fromSpy(col, val);
      // ⚡ NEW (فيكس timeout — 9 أغسطس 2026): loadProfile بقى بيعدي
      // .abortSignal(...) قبل .maybeSingle() لما أونلاين — لازم السلسلة
      // المموكة تدعمها. abortSignal بيرجع نفس نتيجة maybeSingleResult
      // العادية، إلا لو التست ضبطت abortShouldHang=true (تست الـtimeout).
      return {
        abortSignal: vi.fn((signal: AbortSignal) => ({
          maybeSingle: vi.fn(() => new Promise((resolve, reject) => {
            if (abortShouldHang) {
              signal.addEventListener('abort', () => reject(new Error('aborted')));
              return; // متعلّقة عمدًا — التست بتستخدم fake timers لتفعيل الـabort
            }
            resolve(maybeSingleResult);
          })),
        })),
      };
    }),
  };
}

const from = vi.fn(() => ({ select: vi.fn(() => buildMaybeSingleChain()) }));

vi.mock('../supabaseClient', () => ({
  db: { auth: { getSession: (...a: unknown[]) => (getSession as (...a: unknown[]) => unknown)(...a), onAuthStateChange: (...a: unknown[]) => (onAuthStateChange as (...a: unknown[]) => unknown)(...a) }, from: (...a: Parameters<typeof from>) => from(...a) },
}));

const toast = vi.fn();
vi.mock('../shared/lib/notifications', () => ({ toast: (...a: unknown[]) => toast(...a) }));

const setCurrentTenantId = vi.fn();
vi.mock('../constants', () => ({ setCurrentTenantId: (...a: unknown[]) => setCurrentTenantId(...a) }));

const recordError = vi.fn();
vi.mock('../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

let useAuthProfile: typeof import('./useAuthProfile').useAuthProfile;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  getSessionResult = { data: { session: null } };
  maybeSingleResult = { data: null, error: null };
  abortShouldHang = false;
  authChangeListeners = [];
  getSession.mockClear();
  onAuthStateChange.mockClear();
  unsubscribeSpy.mockClear();
  fromSpy.mockClear();
  from.mockClear();
  toast.mockClear();
  setCurrentTenantId.mockClear();
  recordError.mockClear();
  ({ useAuthProfile } = await import('./useAuthProfile'));
});

const USER = { id: 'user-1', email: 'lawyer@sanad.test' };
const PROFILE: Partial<ProfileRow> = { id: 'p1', user_id: 'user-1', tenant_id: 'tenant-9', role: 'lawyer', full_name: 'محمد' };

describe('useAuthProfile', () => {
  it('مفيش جلسة (getSession بيرجع session:null) → authLoading بيبقى false مباشرة، profile وauthUser فاضلين null، من غير أي نداء لـ db.from', async () => {
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.profile).toBeNull();
    expect(result.current.authUser).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('جلسة موجودة + بروفايل موجود → loadProfile بتتنادى، profile بيتحط، authLoading بيبقى false، من غير توست', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: PROFILE, error: null };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    expect(result.current.profile).toEqual(PROFILE);
    expect(result.current.authUser).toEqual(USER);
    expect(fromSpy).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result.current.authLoading).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });

  it('🆕 جلسة موجودة لكن خطأ فعلي في جلب البروفايل (RLS/تكرار) → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError فقط، profile بيفضل null', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: null, error: { message: 'duplicate row' } };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(getSession).toHaveBeenCalled());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة. لو المشكلة استمرت، تواصل مع الدعم.'));
    expect(recordError).toHaveBeenCalledWith('auth_profile_load', 'duplicate row', expect.objectContaining({ label: 'تحميل بيانات الحساب' }));
    expect(result.current.profile).toBeNull();
  });

  it('جلسة موجودة لكن مفيش صف بروفايل مرتبط (maybeSingle بترجع data:null من غير error) → توست "مفيش ملف شخصي"', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: null, error: null };
    renderHook(() => useAuthProfile());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('لا يوجد ملف شخصي مرتبط بهذا الحساب — تواصل مع مدير المكتب'));
  });

  it('✅ فيكس: جلسة موجودة والبروفايل فشل/مش موجود → authLoading بيتقفل (false) برضه، مش عالق للأبد', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: null, error: null };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(toast).toHaveBeenCalled());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
  });

  it('✅ أوف لاين: جلسة موجودة + فشل نداء البروفايل + navigator.onLine=false + فيه نسخة محفوظة من قبل لنفس المستخدم → بيرجع للنسخة المحفوظة، authLoading بيتقفل، من غير رسالة الخطأ العادية', async () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: PROFILE, error: null };
    const first = renderHook(() => useAuthProfile());
    await waitFor(() => expect(first.result.current.profile).toEqual(PROFILE));
    first.unmount();
    toast.mockClear();
    recordError.mockClear();

    onLineSpy.mockReturnValue(false);
    maybeSingleResult = { data: null, error: { message: 'network error' } };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    expect(result.current.authLoading).toBe(false);
    expect(toast).toHaveBeenCalledWith('أنت أوف لاين — بتشوف بيانات حسابك المحفوظة');
    expect(recordError).not.toHaveBeenCalled();
    onLineSpy.mockRestore();
  });

  it('أوف لاين لكن مفيش نسخة محفوظة أصلًا → بيرجع لرسالة الخطأ العادية زي الأونلاين، وauthLoading بيتقفل برضه', async () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: null, error: { message: 'network error' } };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(toast).toHaveBeenCalledWith('تعذّر تحميل بيانات حسابك. أعد تحميل الصفحة. لو المشكلة استمرت، تواصل مع الدعم.'));
    expect(result.current.authLoading).toBe(false);
    expect(result.current.profile).toBeNull();
    onLineSpy.mockRestore();
  });

  // ══════════════════════════════════════════════════════════════════
  // ✅ NEW (فيكس "شاشة اللوجو بتفضل ثابتة كتير" — 9 أغسطس 2026):
  // navigator.onLine=false دلوقتي بيتحقق منه قبل أي نداء شبكة، ونداء
  // الشبكة نفسه (لو أونلاين) بقى عليه سقف 8 ثواني (AbortController) —
  // زي useDbConnectivity بالظبط — عشان الشاشة ما تفضلش عالقة لو الاتصال
  // ضعيف/متقطع من غير ما navigator.onLine يبقى false فعليًا.
  // ══════════════════════════════════════════════════════════════════
  it('✅ NEW: navigator.onLine=false من الأساس → مفيش أي نداء شبكة خالص (db.from)، ولو فيه كاش يترجع فورًا', async () => {
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: PROFILE, error: null };
    const first = renderHook(() => useAuthProfile());
    await waitFor(() => expect(first.result.current.profile).toEqual(PROFILE));
    first.unmount();
    from.mockClear();

    onLineSpy.mockReturnValue(false);
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    expect(from).not.toHaveBeenCalled();
    onLineSpy.mockRestore();
  });

  it('✅ NEW: أونلاين لكن النداء متعلّق (اتصال ضعيف) → بيتقفل بعد 8 ثواني بدل ما يفضل عالق للأبد، ويرجع للكاش لو موجود', async () => {
    vi.useFakeTimers();
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: PROFILE, error: null };
    const first = renderHook(() => useAuthProfile());
    await waitFor(() => expect(first.result.current.profile).toEqual(PROFILE));
    first.unmount();

    abortShouldHang = true;
    const { result } = renderHook(() => useAuthProfile());
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(result.current.profile).toEqual(PROFILE);
    expect(recordError).not.toHaveBeenCalled();
    onLineSpy.mockRestore();
    vi.useRealTimers();
  });

  it('onAuthStateChange: session جديدة بمستخدم → بتنادي loadProfile وبتحدّث profile', async () => {
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    maybeSingleResult = { data: PROFILE, error: null };
    await act(async () => {
      authChangeListeners.forEach((cb) => cb('SIGNED_IN', { user: USER }));
      await Promise.resolve();
    });
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    expect(result.current.authUser).toEqual(USER);
  });

  it('onAuthStateChange: session:null (تسجيل خروج) → profile وauthUser بيترجعوا null على طول من غير نداء db.from', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: PROFILE, error: null };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.profile).toEqual(PROFILE));
    from.mockClear();
    await act(async () => {
      authChangeListeners.forEach((cb) => cb('SIGNED_OUT', null));
    });
    expect(result.current.profile).toBeNull();
    expect(result.current.authUser).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it('setCurrentTenantId بينادى بـ tenant_id بتاع البروفايل لما يتحمّل، وبـ null لما البروفايل يترجع null', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: PROFILE, error: null };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(setCurrentTenantId).toHaveBeenCalledWith('tenant-9'));
    await act(async () => {
      authChangeListeners.forEach((cb) => cb('SIGNED_OUT', null));
    });
    await waitFor(() => expect(setCurrentTenantId).toHaveBeenCalledWith(null));
    expect(result.current).toBeDefined();
  });

  it('setCurrentTenantId بينادى بـ null لو tenant_id مفقود من البروفايل نفسه (undefined)', async () => {
    getSessionResult = { data: { session: { user: USER } } };
    maybeSingleResult = { data: { ...PROFILE, tenant_id: null }, error: null };
    renderHook(() => useAuthProfile());
    await waitFor(() => expect(setCurrentTenantId).toHaveBeenCalledWith(null));
  });

  it('unmount بينادي listener.subscription.unsubscribe()', async () => {
    const { unmount } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(onAuthStateChange).toHaveBeenCalled());
    unmount();
    expect(unsubscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('loadProfile(null) مباشرة (عبر setProfile اليدوي في onAuthStateChange) بترجّع authUser/profile null من غير نداء db.from — نفس اختبار SIGNED_OUT بس بيتأكد إنه مش بيعدي بـ user فاضي لـ loadProfile نفسها', async () => {
    getSessionResult = { data: { session: null } };
    const { result } = renderHook(() => useAuthProfile());
    await waitFor(() => expect(result.current.authLoading).toBe(false));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.profile).toBeNull();
  });
});
