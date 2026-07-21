import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ══════════════════════════════════════════════════════════════════
// 🔒 FIX (مراجعة قبل المرحلة 2): الملف ده كان بيعمل mock لـ db.from()
// فقط، لكن handleLinkCase وhandleAddClientOnly بيمروا فعليًا على
// window.__dbWrite (Global function من src/lib/offlineQueue.ts) — مش
// db.from() مباشرة. من غير mock مباشر لـ window.__dbWrite، أي نداء ليه
// كان بيرمي "window.__dbWrite is not a function" فعليًا وقت التشغيل
// (بيتلقّط في catch العام، فيظهر توست "❌ خطأ غير متوقع" بدل توست
// النجاح المتوقع) — يعني تستات handleAddClientOnly (وبعد التعديل هنا،
// handleLinkCase كمان) كانت هتفشل فعليًا. اتصلح بنفس النمط المتبع في
// useCaseActions.test.ts بالظبط: window.__dbWrite بيتعمل mock مباشر
// كـ vi.fn() مُوجَّه (router) حسب type/table، بدل ما نعتمد على db.from.
//
// 🆕 المرحلة 3-1: handleLinkExistingClient اتحوّل هو كمان لـ __dbWrite
// (UPDATE:cases، مع _offlineSelfTempId لو createdCaseId لسه تمبيد — شوف
// resolveOfflineSelfId في offlineQueue.ts).
//
// 🆕 المرحلة 3-2: handleAddAndLinkClient اتحوّل هو كمان بالكامل لـ
// __dbWrite (INSERT:clients بتمبيد + UPDATE:cases بـ _offlineSelfTempId
// و/أو _offlineFkTempId حسب الحالة — شوف تعليقات useClientLinking.ts).
// db.from() فضل مستخدم مباشرة بس في البحث عن موكل مطابق (is/or، read-only)
// في handleLinkCase — ده مقصود ومش هيتحول (زي ما الخطة نصّت).
// ⚡ FIX: الاستعلام اتغيّر من .ilike('full_name', ...) لـ
// .is('deleted_at', null).or('full_name.ilike...,client_name.ilike...') —
// راجع تعليق FIX جوه useClientLinking.ts (فلتر deleted_at كان ناقص +
// full_name كان مش مضمون امتلاؤه). الـ mock هنا بيتابع نفس السلسلة.
// ══════════════════════════════════════════════════════════════════
type Result = { data?: unknown; error?: unknown };

function makeMockDb() {
  const configured: Record<string, Result> = {};
  const clientsOrSpy = vi.fn();
  const clientsIsSpy = vi.fn();

  const setResult = (key: string, result: Result) => { configured[key] = result; };
  const get = (key: string, fallback: Result) => configured[key] ?? fallback;

  const from = vi.fn((table: string) => {
    if (table === 'clients') {
      return {
        // البحث عن موكل مطابق — read-only، لسه db.from مباشر (زي ما الخطة نصّت)
        select: vi.fn(() => ({
          is: vi.fn((col: string, val: unknown) => {
            clientsIsSpy(col, val);
            return {
              or: vi.fn((clause: string) => {
                clientsOrSpy(clause);
                return { limit: vi.fn(() => Promise.resolve(get('clients:select', { data: [], error: null }))) };
              }),
            };
          }),
        })),
      };
    }
    return {};
  });

  return { from, setResult, clientsOrSpy, clientsIsSpy };
}

let mockDb = makeMockDb();
vi.mock('../../../supabaseClient', () => ({
  db: { from: (...a: Parameters<typeof mockDb.from>) => mockDb.from(...a) },
}));

const toast = vi.fn();
vi.mock('../../../shared/lib/notifications', () => ({ toast: (...a: unknown[]) => toast(...a) }));

const recordError = vi.fn();
vi.mock('../../../systemHealth', () => ({ recordError: (...a: unknown[]) => recordError(...a) }));

const getCurrentTenantId = vi.fn();
vi.mock('../../../constants', () => ({ getCurrentTenantId: () => getCurrentTenantId() }));

const recalcNextHearing = vi.fn();
vi.mock('../../../shared/lib/dataAccess', () => ({ recalcNextHearing: (...a: unknown[]) => recalcNextHearing(...a) }));

import { useClientLinking, type SavedFormData } from './useClientLinking';
import type { Form } from '../NewStandaloneSessionModal';

// ══════════════════════════════════════════════════════════════════
// mock مباشر لـ window.__dbWrite — نفس نمط useCaseActions.test.ts
// (dbWriteMock helper هناك) بالظبط. بيوجّه حسب `${type}:${table}` عشان
// نقدر نتحكم في نتيجة كل نداء لوحده (INSERT:cases لإنشاء القضية،
// UPDATE:case_sessions لربط الجلسة، INSERT:clients لـ handleAddClientOnly).
// ══════════════════════════════════════════════════════════════════
type DbWriteOp = { type: 'INSERT' | 'UPDATE' | 'DELETE'; table: string; data?: Record<string, unknown>; id?: string; returning?: boolean };
type DbWriteResult = { error: unknown; offline?: boolean; queued?: boolean; data?: unknown };

function makeDbWriteMock() {
  const configured: Record<string, DbWriteResult> = {};
  const calls: DbWriteOp[] = [];
  const setResult = (key: string, result: DbWriteResult) => { configured[key] = result; };
  const defaults: Record<string, DbWriteResult> = {
    'INSERT:cases': { error: null, offline: false, data: { id: 'new-case-1' } },
    'UPDATE:case_sessions': { error: null, offline: false },
    'INSERT:clients': { error: null, offline: false, data: { id: 'new-client-1' } },
    'UPDATE:cases': { error: null, offline: false },
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

function makeSavedFormData(overrides: Partial<Form> = {}, caseOverrides: Partial<Omit<SavedFormData, 'form'>> = {}): SavedFormData {
  const form: Form = {
    title: '', court: 'محكمة الجيزة', plaintiff: 'أحمد محمد', plaintiff_national_id: '',
    plaintiff_power_of_attorney: '', defendant: '', defendant_national_id: '', circuit_number: '',
    ...overrides,
  } as Form;
  return { form, finalCaseType: 'مدني', finalCourtLevel: '', fullCaseNumber: '10 لسنة 2026', sessionId: null, ...caseOverrides };
}

describe('useClientLinking', () => {
  beforeEach(() => {
    mockDb = makeMockDb();
    dbWrite = makeDbWriteMock();
    window.__dbWrite = dbWrite.fn as unknown as typeof window.__dbWrite;
    vi.clearAllMocks();
    getCurrentTenantId.mockReturnValue('tenant-1');
  });

  describe('handleLinkCase', () => {
    it('savedFormData فاضي (null) → لا تفعل شيئًا، ومفيش أي نداء __dbWrite', async () => {
      const onSaved = vi.fn();
      const { result } = renderHook(() => useClientLinking(null, onSaved));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(dbWrite.fn).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it('نجاح إنشاء القضية (أونلاين) ولقاء موكل مطابق → toast نجاح، onSaved، تخزين createdCaseId (id حقيقي)، recalcNextHearing، والبحث عن الموكل بيلاقي نتيجة → clientStep=found', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'new-case-1' } });
      mockDb.setResult('clients:select', { data: [{ id: 'client-1', full_name: 'أحمد محمد' }], error: null });
      const onSaved = vi.fn();
      const saved = makeSavedFormData();
      const { result } = renderHook(() => useClientLinking(saved, onSaved));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(dbWrite.callsFor('INSERT:cases')[0]).toEqual(expect.objectContaining({
        type: 'INSERT', table: 'cases',
        data: expect.objectContaining({
          case_number_official: '10 لسنة 2026', case_type: 'مدني', plaintiff: 'أحمد محمد', status: 'نشطة',
          _offlineTempId: expect.stringMatching(/^tmp-/),
        }),
        returning: true,
      }));
      expect(toast).toHaveBeenCalledWith('✅ تم إنشاء ملف القضية');
      expect(onSaved).toHaveBeenCalled();
      expect(result.current.createdCaseId).toBe('new-case-1');
      expect(mockDb.clientsIsSpy).toHaveBeenCalledWith('deleted_at', null);
      expect(mockDb.clientsOrSpy).toHaveBeenCalledWith('full_name.ilike.%أحمد محمد%,client_name.ilike.%أحمد محمد%');
      expect(result.current.clientStep).toBe('found');
      expect(result.current.foundClient).toEqual({ id: 'client-1', full_name: 'أحمد محمد' });
      expect(result.current.linkingCase).toBe(false);
    });

    it('نجاح إنشاء القضية لكن مفيش موكل مطابق في البحث → clientStep=notfound', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'new-case-2' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      const saved = makeSavedFormData();
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(result.current.clientStep).toBe('notfound');
      expect(result.current.foundClient).toBe(null);
    });

    it('اسم المدعي فاضي/مسافات بس بعد trim → مفيش أي بحث عن موكل، clientStep=notfound فورًا', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'new-case-3' } });
      const saved = makeSavedFormData({ plaintiff: '   ' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(mockDb.clientsOrSpy).not.toHaveBeenCalled();
      expect(result.current.clientStep).toBe('notfound');
    });

    it('العنوان الفاضي في الفورم → بيستخدم fullCaseNumber كعنوان (fallback)', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'new-case-4' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      const saved = makeSavedFormData({ title: '' }, { fullCaseNumber: '20 لسنة 2026' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(dbWrite.callsFor('INSERT:cases')[0].data).toEqual(expect.objectContaining({ title: '20 لسنة 2026' }));
    });

    it('🆕 فشل إنشاء القضية (error) → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError، وقف فوري من غير onSaved أو بحث عن موكل', async () => {
      dbWrite.setResult('INSERT:cases', { error: { message: 'insert failed' }, offline: false });
      const onSaved = vi.fn();
      const saved = makeSavedFormData();
      const { result } = renderHook(() => useClientLinking(saved, onSaved));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر إنشاء القضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('case_create', 'insert failed', expect.objectContaining({ label: 'إنشاء قضية' }));
      expect(onSaved).not.toHaveBeenCalled();
      expect(mockDb.clientsOrSpy).not.toHaveBeenCalled();
      expect(result.current.linkingCase).toBe(false);
    });

    it('استثناء غير متوقع (__dbWrite ترمي) → يتلقّط في catch، توست خطأ عام، وlinkingCase بترجع false', async () => {
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });
      const saved = makeSavedFormData();
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingCase).toBe(false);
    });

    it('🆕 لو savedFormData فيه sessionId (الجلسة الأصلية) → بعد إنشاء القضية بينفذ UPDATE على case_sessions.case_id بقيمة القضية الجديدة (id حقيقي)، وبينادي recalcNextHearing (أونلاين)', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-linked-1' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      const saved = makeSavedFormData({}, { sessionId: 'session-abc' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(dbWrite.callsFor('UPDATE:case_sessions')[0]).toEqual(expect.objectContaining({
        type: 'UPDATE', table: 'case_sessions', id: 'session-abc', data: { case_id: 'case-linked-1' },
      }));
      expect(recalcNextHearing).toHaveBeenCalledWith(expect.anything(), 'case-linked-1');
    });

    it('🆕 مفيش sessionId (جلسة اتعملها case مباشرة من غير مرور بالمودال ده) → مفيش أي UPDATE على case_sessions ومفيش recalcNextHearing', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-nolink-1' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      const saved = makeSavedFormData({}, { sessionId: null });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(dbWrite.callsFor('UPDATE:case_sessions')).toHaveLength(0);
      expect(recalcNextHearing).not.toHaveBeenCalled();
    });

    it('🆕 (المرحلة 2) أوفلاين بالكامل: إنشاء القضية بيترجع queued من غير id حقيقي → createdCaseId بيتخزّن كتمبيد، وUPDATE الجلسة بيتبعت بـ _offlineFkTempId، ومفيش recalcNextHearing (هتتحسب بعد المزامنة)', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      mockDb.setResult('clients:select', { data: [], error: null });
      const saved = makeSavedFormData({ title: 'قضية أوفلاين' }, { sessionId: 'session-offline-1' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleLinkCase(); });

      expect(toast).toHaveBeenCalledWith('📥 القضية محفوظة محلياً — ستُضاف فور عودة الإنترنت');
      expect(result.current.createdCaseId).toMatch(/^tmp-/);
      const sessionUpdateCall = dbWrite.callsFor('UPDATE:case_sessions')[0];
      expect(sessionUpdateCall.id).toBe('session-offline-1');
      expect(sessionUpdateCall.data?.case_id).toBe(result.current.createdCaseId);
      expect(sessionUpdateCall.data?._offlineFkTempId).toEqual([
        { field: 'case_id', tempId: result.current.createdCaseId, table: 'cases', fallbackNameValue: 'قضية أوفلاين' },
      ]);
      expect(recalcNextHearing).not.toHaveBeenCalled();
    });
  });

  describe('handleLinkExistingClient', () => {
    it('مفيش createdCaseId أو foundClient → لا تفعل شيئًا', async () => {
      const { result } = renderHook(() => useClientLinking(makeSavedFormData(), vi.fn()));

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')).toHaveLength(0);
    });

    it('🆕 المرحلة 3-1: نجاح الربط (createdCaseId id حقيقي من handleLinkCase أونلاين) → __dbWrite بـ UPDATE:cases id حقيقي من غير أي sentinel تمبيد، توست نجاح، clientStep=done', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-x' } });
      mockDb.setResult('clients:select', { data: [{ id: 'client-found-1', full_name: 'أحمد محمد' }], error: null });
      const { result } = renderHook(() => useClientLinking(makeSavedFormData(), vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')[0]).toEqual({
        type: 'UPDATE', table: 'cases', id: 'case-x', data: { client_id: 'client-found-1' },
      });
      expect(toast).toHaveBeenCalledWith('✅ تم ربط الموكل بالقضية');
      expect(result.current.clientStep).toBe('done');
      expect(result.current.linkingToCase).toBe(false);
    });

    it('🆕 المرحلة 3-1: createdCaseId لسه تمبيد (القضية اتقيدت أوفلاين في handleLinkCase) → __dbWrite بـ _offlineSelfTempId + _offlineSelfFallbackName (عنوان القضية)، وتوست "محفوظ محلياً" لو رجع queued', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      mockDb.setResult('clients:select', { data: [{ id: 'client-found-offline', full_name: 'أحمد محمد' }], error: null });
      const saved = makeSavedFormData({ title: 'قضية أوفلاين للربط' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      const tempCaseId = result.current.createdCaseId as string;
      expect(tempCaseId).toMatch(/^tmp-/);

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(dbWrite.callsFor('UPDATE:cases')[0]).toEqual({
        type: 'UPDATE', table: 'cases', id: tempCaseId,
        data: { client_id: 'client-found-offline', _offlineSelfTempId: tempCaseId, _offlineSelfFallbackName: 'قضية أوفلاين للربط' },
      });
      expect(toast).toHaveBeenCalledWith('📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
      expect(result.current.clientStep).toBe('done');
    });

    it('🆕 فشل الربط (error) → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError، من غير تغيير clientStep', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-y' } });
      dbWrite.setResult('UPDATE:cases', { error: { message: 'update failed' } });
      mockDb.setResult('clients:select', { data: [{ id: 'client-found-2', full_name: 'محمد' }], error: null });
      const { result } = renderHook(() => useClientLinking(makeSavedFormData(), vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر ربط الموكل بالجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('session_client_link', 'update failed', expect.objectContaining({ label: 'ربط الموكل بالجلسة' }));
      expect(result.current.clientStep).toBe('found');
    });

    it('استثناء غير متوقع (__dbWrite ترمي) → توست خطأ عام، linkingToCase ترجع false', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-z' } });
      mockDb.setResult('clients:select', { data: [{ id: 'client-found-3', full_name: 'سالم' }], error: null });
      const { result } = renderHook(() => useClientLinking(makeSavedFormData(), vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });

      await act(async () => { await result.current.handleLinkExistingClient(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingToCase).toBe(false);
    });
  });

  // 🔄 Phase 4 (خطة توحيد إنشاء الموكل): بعد Phase 2/3، handleAddAndLinkClient
  // وhandleAddClientOnly بقوا مجرد كول-باك متزامن بيفتح NewClientModal
  // الموحّد (onOpenCreateClientForCase / onOpenCreateClient) — الإدراج
  // الفعلي (INSERT:clients) والربط (UPDATE:cases/case_sessions) بقوا جوه
  // handleSaveClient الموحّد (useClientActions.ts)، مش هنا. التستات القديمة
  // اللي كانت بتتأكد من INSERT مباشر اتشالت، ومكانها تستات على استدعاء
  // الكول-باك بالبراميترز الصح — راجع useClientActions.test.ts للتستات
  // الخاصة بالإدراج/الربط الفعلي.
  describe('handleAddAndLinkClient', () => {
    it('مفيش savedFormData أو createdCaseId → لا تنادي الكول-باك', async () => {
      const onOpenCreateClientForCase = vi.fn();
      const { result } = renderHook(() => useClientLinking(null, vi.fn(), undefined, undefined, onOpenCreateClientForCase));

      act(() => { result.current.handleAddAndLinkClient(); });

      expect(onOpenCreateClientForCase).not.toHaveBeenCalled();
    });

    it('اسم المدعي فاضي بعد trim → لا تنادي الكول-باك حتى لو فيه createdCaseId', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-empty' } });
      const onOpenCreateClientForCase = vi.fn();
      const saved = makeSavedFormData({ plaintiff: '  ' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, undefined, onOpenCreateClientForCase));
      await act(async () => { await result.current.handleLinkCase(); });

      act(() => { result.current.handleAddAndLinkClient(); });

      expect(onOpenCreateClientForCase).not.toHaveBeenCalled();
    });

    it('القضية أونلاين (id حقيقي) → الكول-باك بيتنادى بـ caseId الحقيقي وisOfflineTemp=false من غير fallbackTitle', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-1' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      const onOpenCreateClientForCase = vi.fn();
      const saved = makeSavedFormData({ plaintiff: 'موكل جديد', plaintiff_national_id: '12345' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, undefined, onOpenCreateClientForCase));
      await act(async () => { await result.current.handleLinkCase(); });

      act(() => { result.current.handleAddAndLinkClient(); });

      expect(onOpenCreateClientForCase).toHaveBeenCalledWith(
        'case-add-1', 'موكل جديد', '12345', '',
        { isOfflineTemp: false, fallbackTitle: undefined },
      );
    });

    it('القضية أوفلاين (createdCaseId لسه تمبيد من handleLinkCase) → الكول-باك بيتنادى بـ isOfflineTemp=true وfallbackTitle = عنوان القضية', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      mockDb.setResult('clients:select', { data: [], error: null });
      const onOpenCreateClientForCase = vi.fn();
      const saved = makeSavedFormData({ title: 'قضية أوفلاين ب', plaintiff: 'موكل ب' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, undefined, onOpenCreateClientForCase));
      await act(async () => { await result.current.handleLinkCase(); });
      const tempCaseId = result.current.createdCaseId as string;
      expect(tempCaseId).toMatch(/^tmp-/);

      act(() => { result.current.handleAddAndLinkClient(); });

      expect(onOpenCreateClientForCase).toHaveBeenCalledWith(
        tempCaseId, 'موكل ب', '', '',
        { isOfflineTemp: true, fallbackTitle: 'قضية أوفلاين ب' },
      );
    });

    it('العنوان فاضي في الفورم (قضية أوفلاين) → fallbackTitle بيستخدم fullCaseNumber بدلًا منه', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      mockDb.setResult('clients:select', { data: [], error: null });
      const onOpenCreateClientForCase = vi.fn();
      const saved = makeSavedFormData({ title: '', plaintiff: 'موكل بدون عنوان' }, { fullCaseNumber: '30 لسنة 2026' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, undefined, onOpenCreateClientForCase));
      await act(async () => { await result.current.handleLinkCase(); });

      act(() => { result.current.handleAddAndLinkClient(); });

      expect(onOpenCreateClientForCase).toHaveBeenCalledWith(
        expect.stringMatching(/^tmp-/), 'موكل بدون عنوان', '', '',
        { isOfflineTemp: true, fallbackTitle: '30 لسنة 2026' },
      );
    });
  });

  describe('handleAddClientOnly', () => {
    it('savedFormData فاضي → لا تنادي الكول-باك', () => {
      const onOpenCreateClient = vi.fn();
      const { result } = renderHook(() => useClientLinking(null, vi.fn(), undefined, onOpenCreateClient));

      act(() => { result.current.handleAddClientOnly(); });

      expect(onOpenCreateClient).not.toHaveBeenCalled();
    });

    it('اسم المدعي فاضي بعد trim → لا تنادي الكول-باك', () => {
      const onOpenCreateClient = vi.fn();
      const saved = makeSavedFormData({ plaintiff: '   ' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, onOpenCreateClient));

      act(() => { result.current.handleAddClientOnly(); });

      expect(onOpenCreateClient).not.toHaveBeenCalled();
    });

    it('بيانات صحيحة → الكول-باك بيتنادى بـ sessionId/plaintiff/national_id/poa', () => {
      const onOpenCreateClient = vi.fn();
      const saved = makeSavedFormData(
        { plaintiff: 'موكل مستقل', plaintiff_national_id: '999', plaintiff_power_of_attorney: 'توكيل-1' },
        { sessionId: 'session-1' },
      );
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, onOpenCreateClient));

      act(() => { result.current.handleAddClientOnly(); });

      expect(onOpenCreateClient).toHaveBeenCalledWith('session-1', 'موكل مستقل', '999', 'توكيل-1');
    });

    it('sessionId فاضي (الجلسة أوفلاين، لسه من غير id حقيقي) → الكول-باك بيتنادى بـ sessionId = null زي ما هو', () => {
      const onOpenCreateClient = vi.fn();
      const saved = makeSavedFormData({ plaintiff: 'موكل بدون ربط' }, { sessionId: null });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), undefined, onOpenCreateClient));

      act(() => { result.current.handleAddClientOnly(); });

      expect(onOpenCreateClient).toHaveBeenCalledWith(null, 'موكل بدون ربط', '', '');
    });
  });
});
