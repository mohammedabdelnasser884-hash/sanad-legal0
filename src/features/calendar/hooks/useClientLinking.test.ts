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
// db.from() فضل مستخدم مباشرة بس في البحث عن موكل مطابق (ilike، read-only)
// في handleLinkCase — ده مقصود ومش هيتحول (زي ما الخطة نصّت).
// ══════════════════════════════════════════════════════════════════
type Result = { data?: unknown; error?: unknown };

function makeMockDb() {
  const configured: Record<string, Result> = {};
  const clientsIlikeSpy = vi.fn();

  const setResult = (key: string, result: Result) => { configured[key] = result; };
  const get = (key: string, fallback: Result) => configured[key] ?? fallback;

  const from = vi.fn((table: string) => {
    if (table === 'clients') {
      return {
        // البحث عن موكل مطابق — read-only، لسه db.from مباشر (زي ما الخطة نصّت)
        select: vi.fn(() => ({
          ilike: vi.fn((col: string, val: string) => {
            clientsIlikeSpy(col, val);
            return { limit: vi.fn(() => Promise.resolve(get('clients:select', { data: [], error: null }))) };
          }),
        })),
      };
    }
    return {};
  });

  return { from, setResult, clientsIlikeSpy };
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
      expect(mockDb.clientsIlikeSpy).toHaveBeenCalledWith('full_name', '%أحمد محمد%');
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

      expect(mockDb.clientsIlikeSpy).not.toHaveBeenCalled();
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
      expect(mockDb.clientsIlikeSpy).not.toHaveBeenCalled();
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

  describe('handleAddAndLinkClient', () => {
    it('مفيش savedFormData أو createdCaseId → لا تفعل شيئًا', async () => {
      const { result } = renderHook(() => useClientLinking(null, vi.fn()));

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    it('اسم المدعي فاضي بعد trim → لا تفعل شيئًا حتى لو فيه createdCaseId', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-empty' } });
      const saved = makeSavedFormData({ plaintiff: '  ' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    // 🆕 المرحلة 3-2: 4 سيناريوهات معيار القبول — (أ) أونلاين بالكامل،
    // (ب) قضية أوفلاين فقط + عميل أونلاين، (جـ) قضية أونلاين + عميل أوفلاين
    // فقط، (د) الاتنين أوفلاين مع بعض (التمبيدين المتزامنين).

    it('🆕 (أ) أونلاين بالكامل: القضية والعميل معهم id حقيقي → INSERT:clients بتمبيد (بيتشال قبل الإرسال الحقيقي)، UPDATE:cases بـ client_id الحقيقي من غير أي sentinel، توست نجاح', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-1' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-99' } });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: false });
      const saved = makeSavedFormData({ plaintiff: 'موكل جديد', plaintiff_national_id: '12345' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
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
        type: 'UPDATE', table: 'cases', id: 'case-add-1', data: { client_id: 'new-client-99' },
      });
      expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الموكل وربطه بالقضية');
      expect(result.current.clientStep).toBe('done');
      expect(result.current.linkingToCase).toBe(false);
    });

    it('🆕 (ب) قضية أوفلاين فقط (createdCaseId تمبيد من handleLinkCase) + عميل أونلاين → UPDATE:cases بـ _offlineSelfTempId/_offlineSelfFallbackName بس، من غير _offlineFkTempId', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: true, queued: true });
      mockDb.setResult('clients:select', { data: [], error: null });
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-online' } });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const saved = makeSavedFormData({ title: 'قضية أوفلاين ب', plaintiff: 'موكل ب' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
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

    it('🆕 (جـ) قضية أونلاين (id حقيقي) + عميل أوفلاين فقط (INSERT:clients رجع queued) → UPDATE:cases بـ _offlineFkTempId بس على client_id، من غير _offlineSelfTempId', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-c' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      dbWrite.setResult('INSERT:clients', { error: null, offline: true, queued: true });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const saved = makeSavedFormData({ plaintiff: 'موكل جـ' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      const updateCall = dbWrite.callsFor('UPDATE:cases')[0];
      const clientTempId = updateCall.data?.client_id as string;
      expect(clientTempId).toMatch(/^tmp-/);
      expect(updateCall).toEqual({
        type: 'UPDATE', table: 'cases', id: 'case-add-c',
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
      mockDb.setResult('clients:select', { data: [], error: null });
      dbWrite.setResult('INSERT:clients', { error: null, offline: true, queued: true });
      dbWrite.setResult('UPDATE:cases', { error: null, offline: true, queued: true });
      const saved = makeSavedFormData({ title: 'قضية أوفلاين د', plaintiff: 'موكل د' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      const tempCaseId = result.current.createdCaseId as string;

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      const updateCall = dbWrite.callsFor('UPDATE:cases')[0];
      const clientTempId = updateCall.data?.client_id as string;
      expect(tempCaseId).toMatch(/^tmp-/);
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

    it('🆕 فشل إضافة الموكل → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError، من غير أي محاولة ربط (مفيش UPDATE:cases)', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-2' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      dbWrite.setResult('INSERT:clients', { error: { message: 'client insert failed' }, offline: false });
      const saved = makeSavedFormData({ plaintiff: 'موكل فاشل' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('client_create', 'client insert failed', expect.objectContaining({ label: 'إضافة موكل' }));
      expect(dbWrite.callsFor('UPDATE:cases')).toHaveLength(0);
    });

    it('🆕 الموكل اتضاف بنجاح لكن الربط فشل → الرسالة الموحدة الخاصة بالربط تتعرض، والخام يتسجل عبر recordError، من غير clientStep=done', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-3' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-100' } });
      dbWrite.setResult('UPDATE:cases', { error: { message: 'link failed' } });
      const saved = makeSavedFormData({ plaintiff: 'موكل بربط فاشل' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر ربط الموكل بالقضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('session_client_link', 'link failed', expect.objectContaining({ label: 'ربط الموكل بالقضية' }));
      expect(result.current.clientStep).not.toBe('done');
    });

    it('استثناء غير متوقع → توست خطأ عام، linkingToCase ترجع false', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-4' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      const saved = makeSavedFormData({ plaintiff: 'موكل استثناء' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingToCase).toBe(false);
    });

    it('🆕 مفيش tenant_id متاح (getCurrentTenantId ترجع null) → توست خطأ واضح، ومفيش أي INSERT', async () => {
      dbWrite.setResult('INSERT:cases', { error: null, offline: false, data: { id: 'case-add-5' } });
      mockDb.setResult('clients:select', { data: [], error: null });
      getCurrentTenantId.mockReturnValue(null);
      const saved = makeSavedFormData({ plaintiff: 'موكل بدون تينانت' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));
      await act(async () => { await result.current.handleLinkCase(); });

      await act(async () => { await result.current.handleAddAndLinkClient(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true);
      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });
  });

  describe('handleAddClientOnly', () => {
    it('savedFormData فاضي → لا تفعل شيئًا', async () => {
      const { result } = renderHook(() => useClientLinking(null, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    it('اسم المدعي فاضي بعد trim → لا تفعل شيئًا', async () => {
      const saved = makeSavedFormData({ plaintiff: '   ' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    it('نجاح (أونلاين) → __dbWrite بـ full_name/national_id، توست نجاح', async () => {
      dbWrite.setResult('INSERT:clients', { error: null, offline: false });
      const saved = makeSavedFormData({ plaintiff: 'موكل مستقل', plaintiff_national_id: '999' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(dbWrite.callsFor('INSERT:clients')[0].data).toEqual(expect.objectContaining({
        full_name: 'موكل مستقل', client_name: 'موكل مستقل', tenant_id: 'tenant-1', national_id: '999',
      }));
      expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الموكل لقائمة الموكلين');
      expect(result.current.linkingClient).toBe(false);
    });

    it('🆕 أوفلاين (queued) → توست "محفوظ محلياً" بدل توست النجاح العادي', async () => {
      dbWrite.setResult('INSERT:clients', { error: null, offline: true, queued: true });
      const onClientAdded = vi.fn();
      const saved = makeSavedFormData({ plaintiff: 'موكل أوفلاين' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn(), onClientAdded));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(toast).toHaveBeenCalledWith('📥 الموكل محفوظ محلياً — سيُضاف فور عودة الإنترنت');
      expect(onClientAdded).toHaveBeenCalled();
    });

    it('🆕 فشل الإدخال → الرسالة الموحدة تتعرض، والخام يتسجل عبر recordError', async () => {
      dbWrite.setResult('INSERT:clients', { error: { message: 'plain insert failed' }, offline: false });
      const saved = makeSavedFormData({ plaintiff: 'موكل فشل الإدخال' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', true);
      expect(recordError).toHaveBeenCalledWith('client_create', 'plain insert failed', expect.objectContaining({ label: 'إضافة موكل' }));
    });

    it('استثناء غير متوقع → توست خطأ عام، linkingClient ترجع false', async () => {
      dbWrite.fn.mockImplementationOnce(() => { throw new Error('boom'); });
      const saved = makeSavedFormData({ plaintiff: 'موكل استثناء منفرد' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(toast).toHaveBeenCalledWith('❌ خطأ غير متوقع', true);
      expect(result.current.linkingClient).toBe(false);
    });

    it('🆕 مفيش tenant_id متاح → توست خطأ واضح، ومفيش أي INSERT', async () => {
      getCurrentTenantId.mockReturnValue(null);
      const saved = makeSavedFormData({ plaintiff: 'موكل منفرد بدون تينانت' });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(toast).toHaveBeenCalledWith('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true);
      expect(dbWrite.callsFor('INSERT:clients')).toHaveLength(0);
    });

    // 🆕 FIX: قبل كده كان بيضيف الموكل من غير ما يربطه بالجلسة اللي اتحفظت
    // لسه (sessionId) — فزرار "🔗 ربط" كان يفضل ظاهر تاني ويسمح بتكرار
    // نفس الموكل. التستات دي بتتأكد إن الجلسة بقت مربوطة فعليًا لما
    // sessionId يكون متاح.
    it('🆕 sessionId متاح (الجلسة اتحفظت أونلاين) → بعد إضافة الموكل، UPDATE:case_sessions بـ client_id، وتوست يوضّح الربط', async () => {
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-linked' } });
      const onSaved = vi.fn();
      const onClientAdded = vi.fn();
      const saved = makeSavedFormData({ plaintiff: 'موكل مربوط' }, { sessionId: 'session-just-saved' });
      const { result } = renderHook(() => useClientLinking(saved, onSaved, onClientAdded));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(dbWrite.callsFor('UPDATE:case_sessions')[0]).toEqual(expect.objectContaining({
        type: 'UPDATE', table: 'case_sessions', id: 'session-just-saved',
        data: expect.objectContaining({ client_id: 'new-client-linked' }),
      }));
      expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الموكل وربطه بالجلسة');
      expect(result.current.clientStep).toBe('done');
      expect(onSaved).toHaveBeenCalled();
      expect(onClientAdded).toHaveBeenCalled();
    });

    it('🆕 sessionId فاضي (الجلسة أوفلاين، لسه من غير id حقيقي) → مفيش أي UPDATE:case_sessions، والرسالة القديمة تفضل زي ما هي', async () => {
      dbWrite.setResult('INSERT:clients', { error: null, offline: false, data: { id: 'new-client-nolink' } });
      const saved = makeSavedFormData({ plaintiff: 'موكل بدون ربط' }, { sessionId: null });
      const { result } = renderHook(() => useClientLinking(saved, vi.fn()));

      await act(async () => { await result.current.handleAddClientOnly(); });

      expect(dbWrite.callsFor('UPDATE:case_sessions')).toHaveLength(0);
      expect(toast).toHaveBeenCalledWith('✅ تمت إضافة الموكل لقائمة الموكلين');
      expect(result.current.clientStep).toBe('done');
    });
  });
});
