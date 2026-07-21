import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ClientRow, ProfileRow } from '../../../types';
import type { MappedCase } from '../../../hooks/useAppData';

// ══════════════════════════════════════════════════════════════════
// Mock db (supabaseClient) — بيغطي بس سلسلة الاستدعاء اللي recalcNextHearing
// (dataAccess.ts، Mock مماثل تحت) بتستخدمها فعليًا:
//   - db.from('case_sessions').select('session_date').eq('case_id', x)
//   - db.from('cases').update({next_hearing}).eq('id', x)
// 🆕 المرحلة 6.5 (توسيع الأوفلاين — H-3، تكملة ثالثة): handleAddSession/
// handleDeleteSession/handleUpdateSession بقوا بينادوا window.__dbWrite بدل
// db.from(...)/safeUpdate مباشرة — نفس نمط useCaseDetailActions.test.ts
// (case_notes) بالظبط. mockDb هنا بقى مسؤول بس عن recalcNextHearing.
// ══════════════════════════════════════════════════════════════════
type Result = { data?: unknown; error?: unknown };

function makeMockDb() {
  const configured: Record<string, Result> = {};
  const updateSpy = vi.fn();
  const selectEqSpy = vi.fn();

  const setResult = (key: string, result: Result) => { configured[key] = result; };
  const get = (key: string, fallback: Result) => configured[key] ?? fallback;

  const from = vi.fn((table: string) => ({
    select: vi.fn(() => ({
      eq: vi.fn((col: string, val: unknown) => {
        selectEqSpy(table, col, val);
        return Promise.resolve(get(`${table}:select`, { data: [], error: null }));
      }),
    })),
    update: vi.fn((payload: unknown) => {
      updateSpy(table, payload);
      return { eq: vi.fn(() => Promise.resolve(get(`${table}:update`, { error: null }))) };
    }),
  }));

  return { from, setResult, updateSpy, selectEqSpy };
}

let mockDb = makeMockDb();
vi.mock('../../../supabaseClient', () => ({ db: { from: (...a: Parameters<typeof mockDb.from>) => mockDb.from(...a) } }));

// 🆕 المرحلة 6.5: mock لـ window.__dbWrite — نفس نمط useCaseDetailActions.test.ts
// (dbWriteMock() بترجع نفس الـ vi.fn ثابتة عبر إعادة إسنادها في beforeEach).
function dbWriteMock(): ReturnType<typeof vi.fn> {
  return window.__dbWrite as unknown as ReturnType<typeof vi.fn>;
}

const toast = vi.fn();
vi.mock('../../../shared/lib/notifications', () => ({ toast: (...a: unknown[]) => toast(...a) }));

const logActivity = vi.fn();
// recalcNextHearing اتنقلت لملف dataAccess.ts المشترك (قبل خطوة 6.5) — بنعمل
// mock ليها هنا بنفس منطق النسخة الحقيقية، عشان تفضل شغالة على mockDb
// الموجود فوق (بتقرأ case_sessions وتحدّث cases.next_hearing). صفر تغيير
// هنا عن قبل خطوة 6.5 — الدالة دي مالهاش علاقة بـ __dbWrite أصلاً.
vi.mock('../../../shared/lib/dataAccess', () => ({
  logActivity: (...a: unknown[]) => logActivity(...a),
  recalcNextHearing: async (
    db: {
      from: (table: string) => {
        select: (col: string) => { eq: (col: string, val: string) => Promise<{ data: { session_date: string | null }[] | null }> };
        update: (payload: { next_hearing: string | null }) => { eq: (col: string, val: string) => Promise<unknown> };
      };
    },
    caseId: string,
  ) => {
    const { data: allSessions } = await db.from('case_sessions').select('session_date').eq('case_id', caseId);
    const todayStr = new Date().toISOString().slice(0, 10);
    let nearest: string | null = null;
    (allSessions || []).forEach((s: { session_date: string | null }) => {
      if (!s.session_date || s.session_date < todayStr) return;
      if (!nearest || s.session_date < nearest) nearest = s.session_date;
    });
    await db.from('cases').update({ next_hearing: nearest }).eq('id', caseId);
  },
}));

import { useCaseSessions } from './useCaseSessions';

const client: ClientRow = { id: 'client-1', full_name: 'أحمد محمد' } as ClientRow;
const profile: ProfileRow = { id: 'lawyer-1', full_name: 'المحامي سالم' } as ProfileRow;

function makeCase(overrides: Partial<MappedCase> = {}): MappedCase {
  return {
    id: 'case-1', number: '10', title: 'قضية مدنية', court: 'محكمة الجيزة', type: 'مدني',
    court_level: null, circuit_number: null, status: 'نشطة', date: '2026-07-01', client_id: 'client-1',
    plaintiff: null, plaintiff_role: null, defendant: null, defendant_role: null, year: 2026, updated_at: '2026-07-16T10:00:00.000Z', court_floor: null,
    court_hall: null, session_hall: null, secretary_hall: null, secretary_name: null, session_time: null,
    ...overrides,
  } as MappedCase;
}

function renderSessionsHook(caseData: MappedCase = makeCase(), onNotify: ((m: string) => void) | undefined = vi.fn()) {
  const refetchAll = vi.fn();
  const view = renderHook(() => useCaseSessions(caseData, client, profile, onNotify, refetchAll));
  return { ...view, refetchAll };
}

beforeEach(() => {
  mockDb = makeMockDb();
  vi.clearAllMocks();
  window.__dbWrite = vi.fn() as unknown as typeof window.__dbWrite;
  // افتراضي آمن لـ recalcNextHearing (بيتنادى بعد كل إضافة/حذف/تعديل ناجح أونلاين)
  mockDb.setResult('case_sessions:select', { data: [], error: null });
});

describe('useCaseSessions — recalcNextHearing', () => {
  it('بيختار أقرب تاريخ >= اليوم ويحدّث next_hearing بيه، ويتجاهل التواريخ الماضية', async () => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const future1 = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    const future2 = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
    const past = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    mockDb.setResult('case_sessions:select', {
      data: [{ session_date: past }, { session_date: future1 }, { session_date: future2 }, { session_date: todayStr }],
      error: null,
    });
    const { result } = renderSessionsHook();
    await act(async () => { await result.current.recalcNextHearing('case-1'); });
    expect(mockDb.selectEqSpy).toHaveBeenCalledWith('case_sessions', 'case_id', 'case-1');
    expect(mockDb.updateSpy).toHaveBeenCalledWith('cases', { next_hearing: todayStr });
  });

  it('مفيش أي جلسة قادمة (كلها ماضية أو مفيش جلسات خالص) → next_hearing = null', async () => {
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    mockDb.setResult('case_sessions:select', { data: [{ session_date: past }], error: null });
    const { result } = renderSessionsHook();
    await act(async () => { await result.current.recalcNextHearing('case-1'); });
    expect(mockDb.updateSpy).toHaveBeenCalledWith('cases', { next_hearing: null });
  });
});

describe('useCaseSessions — handleAddSession', () => {
  it('من غير تاريخ (date فاضي) → مفيش أي نداء __dbWrite خالص', async () => {
    const { result } = renderSessionsHook();
    await act(async () => { await result.current.handleAddSession(); });
    expect(dbWriteMock()).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('نجاح أونلاين → __dbWrite INSERT صحيح، إعادة حساب next_hearing، توست نجاح، تسجيل نشاط، رسالة تيليجرام، وتصفير الفورم', async () => {
    dbWriteMock().mockResolvedValue({ error: null });
    const onNotify = vi.fn();
    const { result, refetchAll } = renderSessionsHook(makeCase(), onNotify);
    act(() => { result.current.setSessionForm({ date: '2026-08-01', time_period: 'مسائي', location_floor: '3', location_hall: 'أ', description: 'مرافعة أولى', result: '', next_action: '' }); });
    await act(async () => { await result.current.handleAddSession(); });

    expect(dbWriteMock()).toHaveBeenCalledWith({
      type: 'INSERT', table: 'case_sessions', data: {
        case_id: 'case-1', session_date: '2026-08-01', session_time: 'مسائي',
        session_floor: '3', session_hall: 'أ', description: 'مرافعة أولى', result: null, next_action: null,
      },
    });
    expect(mockDb.updateSpy).toHaveBeenCalledWith('cases', expect.any(Object));
    expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الجلسة');
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), 'إضافة جلسة', expect.objectContaining({
      entity_type: 'session', case_type: 'مدني', client_name: 'أحمد محمد', userName: 'المحامي سالم',
    }));
    expect(onNotify).toHaveBeenCalledTimes(1);
    const msg = onNotify.mock.calls[0][0] as string;
    expect(msg).toContain('جلسة جديدة');
    expect(msg).toContain('قضية مدنية');
    expect(msg).toContain('2026-08-01');
    expect(result.current.sessionForm).toEqual({ date: '', time_period: 'صباحي', location_floor: '', location_hall: '', description: '', result: '', next_action: '' });
    expect(result.current.showAddSession).toBe(false);
    expect(refetchAll).toHaveBeenCalled();
  });

  it('نجاح من غير onNotify (undefined) → يكمل عادي من غير أي استثناء', async () => {
    dbWriteMock().mockResolvedValue({ error: null });
    const { result } = renderSessionsHook(makeCase(), undefined);
    act(() => { result.current.setSessionForm({ ...result.current.sessionForm, date: '2026-08-01' }); });
    await act(async () => { await result.current.handleAddSession(); });
    expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الجلسة');
  });

  it('أوفلاين ومتقيّدة → توست "محفوظة محلياً"، تصفير الفورم، من غير إعادة حساب next_hearing ولا تسجيل نشاط', async () => {
    dbWriteMock().mockResolvedValue({ error: null, offline: true, queued: true });
    const { result, refetchAll } = renderSessionsHook();
    act(() => { result.current.setSessionForm({ ...result.current.sessionForm, date: '2026-08-01' }); });
    await act(async () => { await result.current.handleAddSession(); });

    expect(toast).toHaveBeenCalledWith('📥 الجلسة محفوظة محلياً — ستُزامن عند عودة الإنترنت');
    expect(mockDb.updateSpy).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(result.current.sessionForm).toEqual({ date: '', time_period: 'صباحي', location_floor: '', location_hall: '', description: '', result: '', next_action: '' });
    expect(result.current.showAddSession).toBe(false);
    expect(refetchAll).not.toHaveBeenCalled();
  });

  it('فشل الإدخال → توست فشل، من غير إعادة حساب next_hearing ولا تسجيل نشاط', async () => {
    dbWriteMock().mockResolvedValue({ error: { message: 'insert failed' } });
    const { result, refetchAll } = renderSessionsHook();
    act(() => { result.current.setSessionForm({ ...result.current.sessionForm, date: '2026-08-01' }); });
    await act(async () => { await result.current.handleAddSession(); });

    expect(toast).toHaveBeenCalledWith('❌ فشل إضافة الجلسة — تحقق من الاتصال وأعد المحاولة', true);
    expect(mockDb.updateSpy).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(refetchAll).not.toHaveBeenCalled();
  });
});

describe('useCaseSessions — handleDeleteSession', () => {
  it('نجاح أونلاين → __dbWrite DELETE صحيح مع sentinel القضية، إعادة حساب next_hearing، توست نجاح، تسجيل نشاط بـ entity_id، وrefetchAll', async () => {
    dbWriteMock().mockResolvedValue({ error: null });
    const { result, refetchAll } = renderSessionsHook();
    await act(async () => { await result.current.handleDeleteSession('sess-1'); });

    expect(dbWriteMock()).toHaveBeenCalledWith({
      type: 'DELETE', table: 'case_sessions', id: 'sess-1', data: { _offlineSessionCaseId: 'case-1' },
    });
    expect(mockDb.updateSpy).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('🗑 تم حذف الجلسة');
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), 'حذف جلسة', expect.objectContaining({ entity_type: 'session', entity_id: 'sess-1' }));
    expect(refetchAll).toHaveBeenCalled();
  });

  it('أوفلاين ومتقيّدة → توست "الحذف محفوظ محلياً"، من غير إعادة حساب أو تسجيل نشاط', async () => {
    dbWriteMock().mockResolvedValue({ error: null, offline: true, queued: true });
    const { result, refetchAll } = renderSessionsHook();
    await act(async () => { await result.current.handleDeleteSession('sess-1'); });

    expect(toast).toHaveBeenCalledWith('📥 الحذف محفوظ محلياً — سيُزامن عند عودة الإنترنت');
    expect(mockDb.updateSpy).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(refetchAll).not.toHaveBeenCalled();
  });

  it('فشل الحذف → توست فشل بس، من غير إعادة حساب أو تسجيل نشاط', async () => {
    dbWriteMock().mockResolvedValue({ error: { message: 'delete failed' } });
    const { result, refetchAll } = renderSessionsHook();
    await act(async () => { await result.current.handleDeleteSession('sess-1'); });

    expect(toast).toHaveBeenCalledWith('❌ فشل حذف الجلسة، حاول مرة أخرى', true);
    expect(mockDb.updateSpy).not.toHaveBeenCalled();
    expect(logActivity).not.toHaveBeenCalled();
    expect(refetchAll).not.toHaveBeenCalled();
  });
});

describe('useCaseSessions — handleUpdateSession', () => {
  it('تعارض (conflict) → توست تعارض واضح (🆕 تحسين عن السلوك القديم — safeUpdate كانت بترجع صمت تام)، من غير إعادة حساب ولا refetchAll', async () => {
    dbWriteMock().mockResolvedValue({ error: { message: 'conflict' }, conflict: true, offline: false });
    const { result, refetchAll } = renderSessionsHook();
    await act(async () => { await result.current.handleUpdateSession('sess-1', { date: '2026-08-01' }); });

    expect(toast).toHaveBeenCalledWith('⚠️ هذه الجلسة عدّلها شخص آخر بعد ما فتحتها — أعد المحاولة', true);
    expect(mockDb.updateSpy).not.toHaveBeenCalled();
    expect(refetchAll).not.toHaveBeenCalled();
  });

  it('فشل (error بلا conflict) → توست فشل بس', async () => {
    dbWriteMock().mockResolvedValue({ error: { message: 'update failed' } });
    const { result, refetchAll } = renderSessionsHook();
    await act(async () => { await result.current.handleUpdateSession('sess-1', { date: '2026-08-01' }); });

    expect(toast).toHaveBeenCalledWith('❌ فشل تعديل بيانات الجلسة — تحقق من الاتصال وأعد المحاولة', true);
    expect(refetchAll).not.toHaveBeenCalled();
  });

  it('أوفلاين ومتقيّدة → توست "التعديل محفوظ محلياً"، من غير إعادة حساب أو تسجيل نشاط', async () => {
    dbWriteMock().mockResolvedValue({ error: null, offline: true, queued: true });
    const { result, refetchAll } = renderSessionsHook();
    await act(async () => { await result.current.handleUpdateSession('sess-1', { date: '2026-08-01' }); });

    expect(toast).toHaveBeenCalledWith('📥 التعديل محفوظ محلياً — سيُزامن عند عودة الإنترنت');
    expect(logActivity).not.toHaveBeenCalled();
    expect(refetchAll).not.toHaveBeenCalled();
  });

  it('الجلسة مش موجودة في الـ state المحلي (sessions فاضية) → __dbWrite بيتنادى بـ knownUpdatedAt: null', async () => {
    dbWriteMock().mockResolvedValue({ error: null });
    const { result } = renderSessionsHook();
    await act(async () => { await result.current.handleUpdateSession('sess-not-in-state', { date: '2026-08-01' }); });

    expect(dbWriteMock()).toHaveBeenCalledWith(expect.objectContaining({
      type: 'UPDATE', table: 'case_sessions', id: 'sess-not-in-state', knownUpdatedAt: null,
    }));
  });

  it('نجاح مع جلسة موجودة في الـ state → __dbWrite بـ updated_at الصحيح وsentinel القضية، إعادة حساب next_hearing، توست نجاح، تسجيل نشاط، ورسالة تيليجرام', async () => {
    dbWriteMock().mockResolvedValue({ error: null });
    const onNotify = vi.fn();
    const { result, refetchAll } = renderSessionsHook(makeCase(), onNotify);
    act(() => { result.current.setSessions([{ id: 'sess-1', updated_at: '2026-07-01T00:00:00.000Z' } as never]); });

    await act(async () => {
      await result.current.handleUpdateSession('sess-1', { date: '2026-08-05', time_period: 'صباحي', description: 'تعديل الوصف' });
    });

    expect(dbWriteMock()).toHaveBeenCalledWith({
      type: 'UPDATE', table: 'case_sessions', id: 'sess-1',
      data: expect.objectContaining({ session_date: '2026-08-05', session_time: 'صباحي', description: 'تعديل الوصف', _offlineSessionCaseId: 'case-1' }),
      knownUpdatedAt: '2026-07-01T00:00:00.000Z',
    });
    expect(mockDb.updateSpy).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('✅ تم تعديل الجلسة');
    expect(logActivity).toHaveBeenCalledWith(expect.anything(), 'تعديل جلسة', expect.objectContaining({ entity_type: 'session', entity_id: 'sess-1' }));
    expect(onNotify).toHaveBeenCalledTimes(1);
    expect(onNotify.mock.calls[0][0] as string).toContain('تم تعديل جلسة');
    expect(refetchAll).toHaveBeenCalled();
  });
});
