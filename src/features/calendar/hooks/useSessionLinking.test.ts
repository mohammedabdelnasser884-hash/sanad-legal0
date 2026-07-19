import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ══════════════════════════════════════════════════════════════════
// 🆕 (المرحلة 2 — خطة توسيع الأوفلاين) أول ملف تست لـ useSessionLinking.ts
// (مكانش موجود قبل كده). كان بيركّز على handleLinkCase بس وقتها.
//
// 🆕 المرحلة 3-1: handleLinkExistingClient اتحوّل هو كمان لـ __dbWrite
// (UPDATE:cases) — تستاته مضافة تحت.
//
// 🆕 المرحلة 3-2: handleAddAndLinkClient اتحوّل هو كمان بالكامل لـ
// __dbWrite (INSERT:clients بتمبيد + UPDATE:cases بـ _offlineSelfTempId
// و/أو _offlineFkTempId حسب الحالة). searchExistingClients (بحث read-only)
// فضل db.from() المُحقَن مباشرة — مقصود ومش هيتحول.
//
// db (الباراميتر التاني للـ hook) بيتحقن مباشرة (dependency injection)،
// فمحتاجناش أي vi.mock للـ supabaseClient هنا — بنعمل mock كائن بسيط.
// window.__dbWrite بيتعمل mock بنفس نمط useClientLinking.test.ts/
// useCaseActions.test.ts (router حسب type/table).
// ══════════════════════════════════════════════════════════════════
const toast = vi.fn();
vi.mock('../../../shared/lib/notifications', () => ({ toast: (...a: unknown[]) => toast(...a) }));

const recordError = vi.fn();
vi.mock('../../../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

const getCurrentTenantId = vi.fn();
vi.mock('../../../constants', () => ({ getCurrentTenantId: () => getCurrentTenantId() }));

const recalcNextHearing = vi.fn();
vi.mock('../../../shared/lib/dataAccess', () => ({ recalcNextHearing: (...a: unknown[]) => recalcNextHearing(...a) }));

import { useSessionLinking } from './useSessionLinking';
import type { CaseSessionRow } from '../../../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';

type DbWriteOp = { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; data?: Record<string, unknown>; id?: string; returning?: boolean };
type DbWriteResult = { error: unknown; offline?: boolean; queued?: boolean; data?: unknown };

function makeDbWriteMock() {
  const configured: Record<string, DbWriteResult> = {};
  const calls: DbWriteOp[] = [];
  const setResult = (key: string, result: DbWriteResult) => { configured[key] = result; };
  const defaults: Record<string, DbWriteResult> = {
    'INSERT:cases': { error: null, offline: false, data: { id: 'new-case-1' } },
    'UPDATE:case_sessions': { error: null, offline: false },
    'UPDATE:cases': { error: null, offline: false },
    'INSERT:clients': { error: null, offline: false, data: { id: 'new-client-1' } },
  };
  const fn = vi.fn(async (op: DbWriteOp): Promise<DbWriteResult> => {
    calls.push(op);
    const key = `${op.type}:${op.table}`;
    return configured[key] ?? defaults[key] ?? { error: null, offline: false };
  });
  const callsFor = (key: string) => calls.filter((c) => `${c.type}:${c.table}` === key);
  return { fn, setResult, calls, callsFor };
}

let dbWrite = makeDbWriteMock();

// mock بسيط لـ db (باراميتر مُحقَن) — بيغطي بس البحث عن موكل مطابق (read-only)
function makeMockDb(clientsSelectResult: { data?: unknown; error?: unknown } = { data: [], error: null }) {
  const ilikeSpy = vi.fn();
  return {
    from: vi.fn((table: string) => {
      if (table === 'clients') {
        return {
          select: vi.fn(() => ({
            is: vi.fn(() => ({
              ilike: vi.fn((col: string, val: string) => {
                ilikeSpy(col, val);
                return { limit: vi.fn(() => Promise.resolve(clientsSelectResult)) };
              }),
            })),
          })),
        };
      }
      return {};
    }),
    ilikeSpy,
  } as unknown as SupabaseClient<Database> & { ilikeSpy: typeof ilikeSpy };
}

function makeSession(overrides: Partial<CaseSessionRow> = {}): CaseSessionRow {
  return {
    id: 'session-1', title: null, case_number: '10 لسنة 2026', court: 'محكمة الجيزة', case_type: 'مدني',
    plaintiff: 'أحمد محمد', plaintiff_role: null, plaintiff_national_id: null, plaintiff_power_of_attorney: null,
    defendant: null, defendant_role: null, defendant_national_id: null, circuit_number: null,
    session_hall: null, session_time: null, court_level: null, secretary_hall: null, secretary_name: null,
    secretary_mobile: null, ...overrides,
  } as CaseSessionRow;
}

describe('useSessionLinking', () => {
  beforeEach(() => {
    dbWrite = makeDbWriteMock();
    window.__dbWrite = dbWrite.fn as unknown as typeof window.__dbWrite;
    vi.clearAllMocks();
    getCurrentTenantId.mockReturnValue('tenant-1');
  });

  describe('handleLinkCase', () => {
    it('نجاح إنشاء القضية (أونلاين) → INSERT بـ _offlineTempId، UPDATE case_sessions.case_id بالـ id الحقيقي (بدون sentinel)، recalcNextHearing، توست نجاح، createdCaseId = id حقيقي', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-1' } });
      const mockDb = makeMockDb({ data: [], error: null });
      const onDone = vi.fn();
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, onDone));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(dbWrite.callsFor('INSERT:cases')[0].data).toEqual(expect.objectContaining({
        _offlineTempId: expect.stringMatching(/^tmp-/),
      }));
      expect(dbWrite.callsFor('UPDATE:case_sessions')[0]).toEqual(expect.objectContaining({
        type: 'UPDATE', table: 'case_sessions', id: 'session-1', data: { case_id: 'case-real-1' },
      }));
      expect(recalcNextHearing).toHaveBeenCalledWith(mockDb, 'case-real-1');
      expect(toast).toHaveBeenCalledWith('✅ تم إنشاء ملف القضية');
      expect(result.current.createdCaseId).toBe('case-real-1');
      expect(onDone).toHaveBeenCalled();
    });

    it('🆕 (المرحلة 2) أوفلاين بالكامل: القضية بترجع queued من غير id حقيقي → createdCaseId = تمبيد، UPDATE الجلسة بيتبعت بـ _offlineFkTempId (case_id بالتمبيد)، ومفيش recalcNextHearing', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      const mockDb = makeMockDb({ data: [], error: null });
      const onDone = vi.fn();
      const session = makeSession({ id: 'session-offline-1', title: 'قضية أوفلاين من جلسة' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, onDone));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(toast).toHaveBeenCalledWith('📥 القضية محفوظة محلياً — ستُضاف فور عودة الإنترنت');
      expect(result.current.createdCaseId).toMatch(/^tmp-/);
      const sessionCall = dbWrite.callsFor('UPDATE:case_sessions')[0];
      expect(sessionCall.id).toBe('session-offline-1');
      expect(sessionCall.data?.case_id).toBe(result.current.createdCaseId);
      expect(sessionCall.data?._offlineFkTempId).toEqual([
        { field: 'case_id', tempId: result.current.createdCaseId, table: 'cases', fallbackNameValue: 'قضية أوفلاين من جلسة' },
      ]);
      expect(recalcNextHearing).not.toHaveBeenCalled();
    });

    it('فشل إنشاء القضية (error) → توست خطأ موحّد، مفيش UPDATE على case_sessions، مفيش onDone', async () => {
      dbWrite.setResult('INSERT:cases', { error: { message: 'insert failed' }, offline: false });
      const mockDb = makeMockDb();
      const onDone = vi.fn();
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, onDone));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر إنشاء القضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('case_create', 'insert failed', expect.objectContaining({ label: 'إنشاء قضية' }));
      expect(dbWrite.callsFor('UPDATE:case_sessions')).toHaveLength(0);
      expect(onDone).not.toHaveBeenCalled();
      expect(result.current.linkingCase).toBe(false);
    });

    it('اسم المدعي فاضي (plaintiff = null) → clientStep=notfound من غير أي بحث', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-noplaintiff' } });
      const mockDb = makeMockDb();
      const { result } = renderHook(() => useSessionLinking(makeSession({ plaintiff: null }), mockDb, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(mockDb.ilikeSpy).not.toHaveBeenCalled();
      expect(result.current.clientStep).toBe('notfound');
    });

    it('استثناء غير متوقع (__dbWrite ترمي) → توست خطأ عام، linkingCase ترجع false', async () => {
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });
      const mockDb = makeMockDb();
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingCase).toBe(false);
    });
  });

  describe('handleLinkExistingClient', () => {
    it('مفيش createdCaseId أو foundClient → لا تفعل شيئًا', async () => {
      const mockDb = makeMockDb();
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, vi.fn()));

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')).toHaveLength(0);
    });

    it('🆕 المرحلة 3-1: نجاح الربط (createdCaseId id حقيقي من handleLinkCase أونلاين) → __dbWrite بـ UPDATE:cases id حقيقي من غير أي sentinel تمبيد، توست نجاح، clientStep=done', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-2' } });
      const mockDb = makeMockDb({ data: [{ id: 'client-found-1', full_name: 'أحمد محمد' }], error: null });
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')[0]).toEqual({
        type: 'UPDATE', table: 'cases', id: 'case-real-2', data: { client_id: 'client-found-1' },
      });
      expect(toast).toHaveBeenCalledWith('✅ تم ربط الموكل بالقضية');
      expect(result.current.clientStep).toBe('done');
      expect(result.current.linkingToCase).toBe(false);
    });

    it('🆕 المرحلة 3-1: createdCaseId لسه تمبيد (القضية اتقيدت أوفلاين في handleLinkCase) → __dbWrite بـ _offlineSelfTempId + _offlineSelfFallbackName (عنوان الجلسة)، وتوست "محفوظ محلياً" لو رجع queued', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const mockDb = makeMockDb({ data: [{ id: 'client-found-offline', full_name: 'أحمد محمد' }], error: null });
      const session = makeSession({ id: 'session-offline-2', title: 'قضية أوفلاين للربط بموكل' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      const tempCaseId = result.current.createdCaseId as string;
      expect(tempCaseId).toMatch(/^tmp-/);

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')[0]).toEqual({
        type: 'UPDATE', table: 'cases', id: tempCaseId,
        data: { client_id: 'client-found-offline', _offlineSelfTempId: tempCaseId, _offlineSelfFallbackName: 'قضية أوفلاين للربط بموكل' },
      });
      expect(toast).toHaveBeenCalledWith('📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
      expect(result.current.clientStep).toBe('done');
    });

    it('🆕 فشل الربط (error) → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError، من غير تغيير clientStep', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-3' } });
      dbWrite.setResult('UPDATE:cases', { error: { message: 'update failed' } });
      const mockDb = makeMockDb({ data: [{ id: 'client-found-2', full_name: 'محمد' }], error: null });
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر ربط الموكل بالقضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('session_client_link', 'update failed', expect.objectContaining({ label: 'ربط الموكل بالقضية' }));
      expect(result.current.clientStep).toBe('found');
    });

    it('استثناء غير متوقع (__dbWrite ترمي) → توست خطأ عام، linkingToCase ترجع false', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-4' } });
      const mockDb = makeMockDb({ data: [{ id: 'client-found-3', full_name: 'سالم' }], error: null });
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingToCase).toBe(false);
    });
  });

  // 🆕 المرحلة 3-2 (خطة توسيع الأوفلاين) — describe جديد بالكامل، مكانش
  // موجود قبل كده (نفس حالة describe('handleLinkExistingClient') وقت
  // المرحلة 3-1). 4 سيناريوهات معيار القبول: (أ) أونلاين بالكامل،
  // (ب) قضية أوفلاين فقط + عميل أونلاين، (جـ) قضية أونلاين + عميل أوفلاين
  // فقط، (د) الاتنين أوفلاين مع بعض (التمبيدين المتزامنين).
  describe('handleAddAndLinkClient', () => {
    it('مفيش createdCaseId → لا تفعل شيئًا', async () => {
      const mockDb = makeMockDb();
      const { result } = renderHook(() => useSessionLinking(makeSession(), mockDb, vi.fn()));

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    it('اسم المدعي فاضي (plaintiff = null) → لا تفعل شيئًا حتى لو فيه createdCaseId', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-empty' } });
      const mockDb = makeMockDb();
      const { result } = renderHook(() => useSessionLinking(makeSession({ plaintiff: null }), mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    it('🆕 (أ) أونلاين بالكامل: القضية والعميل معهم id حقيقي → INSERT:clients بتمبيد (بيتشال قبل الإرسال الحقيقي)، UPDATE:cases بـ client_id الحقيقي من غير أي sentinel، توست نجاح', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-add-1' } });
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-99' } });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: false });
      const mockDb = makeMockDb({ data: [], error: null });
      const onClientAdded = vi.fn();
      const session = makeSession({ plaintiff: 'موكل جديد', plaintiff_national_id: '12345' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn(), onClientAdded));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(dbWrite.callsFor('INSERT:clients')[0]).toEqual(expect.objectContaining({
        type: 'INSERT', table: 'clients',
        data: expect.objectContaining({
          full_name: 'موكل جديد', client_name: 'موكل جديد', tenant_id: 'tenant-1', national_id: '12345',
          _offlineTempId: expect.stringMatching(/^tmp-/),
        }),
        returning: true,
      }));
      expect(dbWrite.callsFor('UPDATE:cases')[0]).toEqual({
        type: 'UPDATE', table: 'cases', id: 'case-real-add-1', data: { client_id: 'new-client-99' },
      });
      expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الموكل وربطه بالقضية');
      expect(result.current.clientStep).toBe('done');
      expect(onClientAdded).toHaveBeenCalled();
    });

    it('🆕 (ب) قضية أوفلاين فقط (createdCaseId تمبيد من handleLinkCase) + عميل أونلاين → UPDATE:cases بـ _offlineSelfTempId/_offlineSelfFallbackName بس', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-online' } });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const mockDb = makeMockDb({ data: [], error: null });
      const session = makeSession({ id: 'session-offline-b', title: 'قضية أوفلاين ب', plaintiff: 'موكل ب' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      const tempCaseId = result.current.createdCaseId as string;
      expect(tempCaseId).toMatch(/^tmp-/);

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')[0]).toEqual({
        type: 'UPDATE', table: 'cases', id: tempCaseId,
        data: {
          client_id: 'new-client-online',
          _offlineSelfTempId: tempCaseId, _offlineSelfFallbackName: 'قضية أوفلاين ب',
        },
      });
      expect(toast).toHaveBeenCalledWith('📥 إضافة الموكل وربطه محفوظة محلياً — ستُزامن عند عودة الإنترنت');
      expect(result.current.clientStep).toBe('done');
    });

    it('🆕 (جـ) قضية أونلاين (id حقيقي) + عميل أوفلاين فقط (INSERT:clients رجع queued) → UPDATE:cases بـ _offlineFkTempId بس على client_id', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-add-c' } });
      dbWrite.setResult('INSERT:clients', { error: null, offline: true, queued: true });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const mockDb = makeMockDb({ data: [], error: null });
      const session = makeSession({ plaintiff: 'موكل جـ' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      const updateCall = dbWrite.callsFor('UPDATE:cases')[0];
      const clientTempId = updateCall.data?.client_id as string;
      expect(clientTempId).toMatch(/^tmp-/);
      expect(updateCall).toEqual({
        type: 'UPDATE', table: 'cases', id: 'case-real-add-c',
        data: {
          client_id: clientTempId,
          _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients', fallbackNameValue: 'موكل جـ' }],
        },
      });
      expect(toast).toHaveBeenCalledWith('📥 إضافة الموكل وربطه محفوظة محلياً — ستُزامن عند عودة الإنترنت');
      expect(result.current.clientStep).toBe('done');
    });

    it('🆕 (د) الاتنين أوفلاين مع بعض (قضية تمبيد + عميل queued) → UPDATE:cases بيحمل _offlineSelfTempId (القضية) و_offlineFkTempId (العميل) مع بعض في نفس العملية', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      dbWrite.setResult('INSERT:clients', { error: null, offline: true, queued: true });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const mockDb = makeMockDb({ data: [], error: null });
      const session = makeSession({ id: 'session-offline-d', title: 'قضية أوفلاين د', plaintiff: 'موكل د' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      const tempCaseId = result.current.createdCaseId as string;

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      const updateCall = dbWrite.callsFor('UPDATE:cases')[0];
      const clientTempId = updateCall.data?.client_id as string;
      expect(clientTempId).toMatch(/^tmp-/);
      expect(clientTempId).not.toBe(tempCaseId);
      expect(updateCall).toEqual({
        type: 'UPDATE', table: 'cases', id: tempCaseId,
        data: {
          client_id: clientTempId,
          _offlineSelfTempId: tempCaseId, _offlineSelfFallbackName: 'قضية أوفلاين د',
          _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients', fallbackNameValue: 'موكل د' }],
        },
      });
      expect(toast).toHaveBeenCalledWith('📥 إضافة الموكل وربطه محفوظة محلياً — ستُزامن عند عودة الإنترنت');
      expect(result.current.clientStep).toBe('done');
    });

    it('🆕 فشل إضافة الموكل → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError، من غير أي UPDATE:cases', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-add-2' } });
      dbWrite.setResult('INSERT:clients', { error: { message: 'client insert failed' }, offline: false });
      const mockDb = makeMockDb({ data: [], error: null });
      const session = makeSession({ plaintiff: 'موكل فاشل' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('client_create', 'client insert failed', expect.objectContaining({ label: 'إضافة موكل' }));
      expect(dbWrite.callsFor('UPDATE:cases')).toHaveLength(0);
    });

    it('🆕 الموكل اتضاف بنجاح لكن الربط فشل → الرسالة الموحدة الخاصة بالربط تتعرض، والخام يتسجل عبر recordError، من غير clientStep=done', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-add-3' } });
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-100' } });
      dbWrite.setResult('UPDATE:cases', { error: { message: 'link failed' } });
      const mockDb = makeMockDb({ data: [], error: null });
      const session = makeSession({ plaintiff: 'موكل بربط فاشل' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر ربط الموكل بالقضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('session_client_link', 'link failed', expect.objectContaining({ label: 'ربط الموكل بالقضية' }));
      expect(result.current.clientStep).not.toBe('done');
    });

    it('استثناء غير متوقع (__dbWrite ترمي) → توست خطأ عام، linkingToCase ترجع false', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-add-4' } });
      const mockDb = makeMockDb({ data: [], error: null });
      const session = makeSession({ plaintiff: 'موكل استثناء' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingToCase).toBe(false);
    });

    it('🆕 مفيش tenant_id متاح (getCurrentTenantId ترجع null) → توست خطأ واضح، ومفيش أي INSERT', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-real-add-5' } });
      const mockDb = makeMockDb({ data: [], error: null });
      getCurrentTenantId.mockReturnValue(null);
      const session = makeSession({ plaintiff: 'موكل بدون تينانت' });
      const { result } = renderHook(() => useSessionLinking(session, mockDb, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true);
      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });
  });
});
