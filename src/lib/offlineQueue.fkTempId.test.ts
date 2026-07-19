import { describe, it, expect, vi } from 'vitest';
import type { db } from '../supabaseClient';

// ⚠️ offlineQueue.ts بيعمل import مباشر لـ `db` الحقيقي من supabaseClient.ts
// (اللي بينادي createClient() الفعلية) + بيضيف event listeners/setInterval
// على window وقت الاستيراد. زي useCaseActions.test.ts بالظبط، بنعمل mock
// للموديولز دي الثلاثة قبل استيراد offlineQueue.ts عشان الاختبار يفضل معزول
// (resolveOfflineFkRefs بتاخد dbClient كباراميتر أصلاً — الـ mock هنا بس
// عشان الاستيراد نفسه ميفشلش، مش عشان يتستخدم في التست). vi.mock بتتصعّد
// (hoisted) فوق كل الـ imports تلقائيًا من Vitest، فترتيبها هنا مش مهم.
vi.mock('../supabaseClient', () => ({ db: {} }));
vi.mock('../shared/lib/notifications', () => ({
  showOfflineBanner: vi.fn(), hideOfflineBanner: vi.fn(),
  showSyncIndicator: vi.fn(), hideSyncIndicator: vi.fn(), toast: vi.fn(),
}));
vi.mock('../shared/lib/dataAccess', () => ({ logActivity: vi.fn() }));

import { resolveOfflineFkRefs, resolveOfflineSelfId, type OfflineFkTempIdRef, type OfflineQueueItem } from './offlineQueue';

// ══════════════════════════════════════════════════════════════════
// اختبارات المرحلة 1 من "خطة توسيع نظام الأوفلاين" — تغطي بالظبط
// معيار القبول المذكور في خطة التنفيذ:
//   (أ) تمبيد اتحل في نفس الدورة (عن طريق tempIdToRealId)
//   (ب) تمبيد لسه معلّق في الطابور → يرجع retry
//   (ج) fallback بالاسم لما التمبيد يختفي من الذاكرة (تشغيلة جديدة)
// + حالات إضافية (تعدد المراجع، جدول من غير عمود fallback، لا توجد مراجع)
// عشان نغطي منطق المرحلة 3 المستقبلي (تمبيدين غير محلولين في نفس العملية)
// من غير ما نكسر أي حاجة موجودة فعليًا.
//
// بنستخدم `resolveOfflineFkRefs` مباشرة (exported من offlineQueue.ts) بدل
// محاكاة IndexedDB كاملة — الدالة بتاخد `dbClient`/`tempIdToRealId`/`queue`
// كباراميترات (dependency injection)، بنفس نمط `safeUpdate` في
// dataAccess.test.ts، فمحتاجة mock لـ Supabase client بس، صفر IndexedDB.
// ══════════════════════════════════════════════════════════════════

function makeMockDb(opts: { fallbackRow?: { id: string } | null } = {}) {
  const maybeSingle = vi.fn(() => Promise.resolve({
    data: opts.fallbackRow ?? null,
    error: null,
  }));
  const limit = vi.fn(() => ({ maybeSingle }));
  const order = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from, select, eq, order, limit, maybeSingle } as unknown as typeof db & {
    from: typeof from; select: typeof select; eq: typeof eq; order: typeof order; limit: typeof limit; maybeSingle: typeof maybeSingle;
  };
}

function makeOp(data: Record<string, unknown>, table: OfflineQueueItem['table'] = 'case_sessions'): OfflineQueueItem {
  return {
    id: 1,
    type: 'UPDATE',
    table,
    data,
    timestamp: Date.now(),
    status: 'pending',
  };
}

describe('resolveOfflineFkRefs — المرحلة 1: آلية التمبيد العامة (FK Temp ID)', () => {
  it('لا توجد مراجع _offlineFkTempId → يرجع data زي ما هي وshouldRetry:false', async () => {
    const mockDb = makeMockDb();
    const op = makeOp({ session_date: '2026-08-01' });

    const result = await resolveOfflineFkRefs(mockDb, op, new Map(), []);

    expect(result).toEqual({ data: { session_date: '2026-08-01' }, shouldRetry: false });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('(أ) التمبيد اتحل فعلاً في نفس دورة المزامنة (موجود في tempIdToRealId) → يستبدل الحقل بالـ id الحقيقي', async () => {
    const mockDb = makeMockDb();
    const refs: OfflineFkTempIdRef[] = [{ field: 'case_id', tempId: 'tmp-case-1', table: 'cases' }];
    const op = makeOp({ case_id: null, _offlineFkTempId: refs });
    const tempIdToRealId = new Map([['tmp-case-1', 'real-case-id-123']]);

    const result = await resolveOfflineFkRefs(mockDb, op, tempIdToRealId, []);

    expect(result.shouldRetry).toBe(false);
    expect(result.data.case_id).toBe('real-case-id-123');
    // السنتينل لازم يتشال بعد الحل الكامل عشان ميوصلش لـ Supabase
    expect(result.data._offlineFkTempId).toBeUndefined();
    // اتحل من الذاكرة مباشرة — مفيش داعي أي نداء db
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('(ب) التمبيد لسه معلّق في الطابور نفسه (مفيش تطابق في الذاكرة، بس القضية لسه فيه) → shouldRetry:true وdata من غير تغيير', async () => {
    const mockDb = makeMockDb();
    const refs: OfflineFkTempIdRef[] = [{ field: 'case_id', tempId: 'tmp-case-2', table: 'cases' }];
    const op = makeOp({ case_id: null, _offlineFkTempId: refs });
    const pendingCaseOp = makeOp({ _offlineTempId: 'tmp-case-2', title: 'قضية لسه مش اتزامنت' }, 'cases');
    const queue = [op, pendingCaseOp];

    const result = await resolveOfflineFkRefs(mockDb, op, new Map(), queue);

    expect(result.shouldRetry).toBe(true);
    // البيانات المرجعة زي ما هي (مع السنتينل لسه موجود) عشان bumpRetry يحصل
    // على العملية الأصلية كاملة في الاستدعاء اللي بعده
    expect(result.data).toBe(op.data);
    // لسه معلّق في نفس الطابور — مفيش داعي نحاول fallback بالاسم أصلاً
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('(ج) fallback بالاسم — التمبيد مش في الذاكرة ولا في الطابور (تشغيلة جديدة) لكن fallback نجح', async () => {
    const mockDb = makeMockDb({ fallbackRow: { id: 'real-case-id-from-fallback' } });
    const refs: OfflineFkTempIdRef[] = [
      { field: 'case_id', tempId: 'tmp-case-3', table: 'cases', fallbackNameValue: 'قضية أحمد ضد شركة النور' },
    ];
    const op = makeOp({ case_id: null, _offlineFkTempId: refs });

    const result = await resolveOfflineFkRefs(mockDb, op, new Map(), []);

    expect(result.shouldRetry).toBe(false);
    expect(result.data.case_id).toBe('real-case-id-from-fallback');
    expect(result.data._offlineFkTempId).toBeUndefined();
    expect(mockDb.from).toHaveBeenCalledWith('cases');
    expect(mockDb.eq).toHaveBeenCalledWith('title', 'قضية أحمد ضد شركة النور');
  });

  it('fallback بالاسم فشل (مفيش صف مطابق) → shouldRetry:true', async () => {
    const mockDb = makeMockDb({ fallbackRow: null });
    const refs: OfflineFkTempIdRef[] = [
      { field: 'client_id', tempId: 'tmp-client-1', table: 'clients', fallbackNameValue: 'محمد عبد الناصر' },
    ];
    const op = makeOp({ client_id: null, _offlineFkTempId: refs }, 'cases');

    const result = await resolveOfflineFkRefs(mockDb, op, new Map(), []);

    expect(result.shouldRetry).toBe(true);
    expect(mockDb.eq).toHaveBeenCalledWith('full_name', 'محمد عبد الناصر');
  });

  it('جدول من غير عمود fallback معرَّف (case_sessions) ومفيش fallbackNameValue → shouldRetry:true من غير أي نداء db', async () => {
    const mockDb = makeMockDb();
    const refs: OfflineFkTempIdRef[] = [{ field: 'linked_session_id', tempId: 'tmp-session-1', table: 'case_sessions' }];
    const op = makeOp({ linked_session_id: null, _offlineFkTempId: refs });

    const result = await resolveOfflineFkRefs(mockDb, op, new Map(), []);

    expect(result.shouldRetry).toBe(true);
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('تمبيدين في نفس العملية — واحد اتحل من الذاكرة والتاني لسه معلّق → shouldRetry:true (يمنع تحديث جزئي)', async () => {
    const mockDb = makeMockDb();
    const refs: OfflineFkTempIdRef[] = [
      { field: 'case_id', tempId: 'tmp-case-resolved', table: 'cases' },
      { field: 'client_id', tempId: 'tmp-client-pending', table: 'clients' },
    ];
    const op = makeOp({ case_id: null, client_id: null, _offlineFkTempId: refs }, 'cases');
    const pendingClientOp = makeOp({ _offlineTempId: 'tmp-client-pending', full_name: 'موكل جديد' }, 'clients');
    const tempIdToRealId = new Map([['tmp-case-resolved', 'real-case-id']]);

    const result = await resolveOfflineFkRefs(mockDb, op, tempIdToRealId, [op, pendingClientOp]);

    expect(result.shouldRetry).toBe(true);
    // العملية بالكامل بترجع retry — مفيش تحديث جزئي (case_id لوحده) هيتبعت
    expect(result.data).toBe(op.data);
  });

  it('تمبيدين في نفس العملية — الاتنين اتحلوا (واحد من الذاكرة والتاني fallback) → shouldRetry:false والحقلين اتحدثوا', async () => {
    const mockDb = makeMockDb({ fallbackRow: { id: 'real-client-id-fallback' } });
    const refs: OfflineFkTempIdRef[] = [
      { field: 'case_id', tempId: 'tmp-case-resolved', table: 'cases' },
      { field: 'client_id', tempId: 'tmp-client-old-session', table: 'clients', fallbackNameValue: 'عميل قديم' },
    ];
    const op = makeOp({ case_id: null, client_id: null, _offlineFkTempId: refs }, 'cases');
    const tempIdToRealId = new Map([['tmp-case-resolved', 'real-case-id']]);

    const result = await resolveOfflineFkRefs(mockDb, op, tempIdToRealId, [op]);

    expect(result.shouldRetry).toBe(false);
    expect(result.data.case_id).toBe('real-case-id');
    expect(result.data.client_id).toBe('real-client-id-fallback');
    expect(result.data._offlineFkTempId).toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════
// اختبارات المرحلة 3-1 — resolveOfflineSelfId (تمبيد id السطر نفسه، مش
// حقل FK جوه data). اكتشاف معماري أثناء تنفيذ handleLinkExistingClient:
// لو القضية اتقيدت أوفلاين في handleLinkCase، createdCaseId بيفضل تمبيد،
// وUPDATE cases بعد كده لازم يحل التمبيد ده *قبل* تنفيذ .eq('id', ...)
// وإلا هيتنفذ ضد صف مش موجود من غير أي error (نجاح صامت مضلل).
// ══════════════════════════════════════════════════════════════════
describe('resolveOfflineSelfId — المرحلة 3-1: تمبيد id السطر المستهدف بالـ UPDATE', () => {
  it('مفيش _offlineSelfTempId → يرجع op.id زي ما هو (السلوك العادي لكل UPDATE موجودة قبل 3-1)', async () => {
    const mockDb = makeMockDb();
    const op: OfflineQueueItem = { id: 'real-case-id-999', type: 'UPDATE', table: 'cases', data: { client_id: 'c-1' }, timestamp: Date.now(), status: 'pending' };

    const result = await resolveOfflineSelfId(mockDb, op, new Map(), []);

    expect(result).toEqual({ realId: 'real-case-id-999', shouldRetry: false });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('(أ) التمبيد اتحل فعلاً في نفس دورة المزامنة → يرجع الـ id الحقيقي من tempIdToRealId', async () => {
    const mockDb = makeMockDb();
    const op: OfflineQueueItem = { id: 'tmp-case-1', type: 'UPDATE', table: 'cases', data: { client_id: 'c-1', _offlineSelfTempId: 'tmp-case-1' }, timestamp: Date.now(), status: 'pending' };
    const tempIdToRealId = new Map([['tmp-case-1', 'real-case-id-abc']]);

    const result = await resolveOfflineSelfId(mockDb, op, tempIdToRealId, []);

    expect(result).toEqual({ realId: 'real-case-id-abc', shouldRetry: false });
  });

  it('(ب) التمبيد لسه معلّق في نفس الطابور (INSERT القضية لسه ما اتعالجش) → shouldRetry:true', async () => {
    const mockDb = makeMockDb();
    const op: OfflineQueueItem = { id: 'tmp-case-1', type: 'UPDATE', table: 'cases', data: { client_id: 'c-1', _offlineSelfTempId: 'tmp-case-1' }, timestamp: Date.now(), status: 'pending' };
    const pendingCaseInsert: OfflineQueueItem = { id: 1, type: 'INSERT', table: 'cases', data: { _offlineTempId: 'tmp-case-1', title: 'قضية جديدة' }, timestamp: Date.now(), status: 'pending' };

    const result = await resolveOfflineSelfId(mockDb, op, new Map(), [pendingCaseInsert, op]);

    expect(result).toEqual({ realId: null, shouldRetry: true });
    expect(mockDb.from).not.toHaveBeenCalled();
  });

  it('(جـ) fallback بالاسم نجح (القضية اتزامنت في تشغيلة سابقة، التمبيد مش في الذاكرة ولا الطابور) → يرجع الـ id الحقيقي', async () => {
    const mockDb = makeMockDb({ fallbackRow: { id: 'real-case-id-from-title' } });
    const op: OfflineQueueItem = {
      id: 'tmp-case-old', type: 'UPDATE', table: 'cases',
      data: { client_id: 'c-1', _offlineSelfTempId: 'tmp-case-old', _offlineSelfFallbackName: 'قضية من جلسة مستقلة' },
      timestamp: Date.now(), status: 'pending',
    };

    const result = await resolveOfflineSelfId(mockDb, op, new Map(), []);

    expect(result).toEqual({ realId: 'real-case-id-from-title', shouldRetry: false });
    expect(mockDb.eq).toHaveBeenCalledWith('title', 'قضية من جلسة مستقلة');
  });

  it('fallback بالاسم فشل (مفيش صف مطابق) → shouldRetry:true', async () => {
    const mockDb = makeMockDb({ fallbackRow: null });
    const op: OfflineQueueItem = {
      id: 'tmp-case-old', type: 'UPDATE', table: 'cases',
      data: { client_id: 'c-1', _offlineSelfTempId: 'tmp-case-old', _offlineSelfFallbackName: 'قضية اتمسحت' },
      timestamp: Date.now(), status: 'pending',
    };

    const result = await resolveOfflineSelfId(mockDb, op, new Map(), []);

    expect(result).toEqual({ realId: null, shouldRetry: true });
  });

  it('مفيش fallbackNameValue خالص (ولا في الذاكرة ولا الطابور) → shouldRetry:true من غير أي نداء db', async () => {
    const mockDb = makeMockDb();
    const op: OfflineQueueItem = { id: 'tmp-case-x', type: 'UPDATE', table: 'cases', data: { client_id: 'c-1', _offlineSelfTempId: 'tmp-case-x' }, timestamp: Date.now(), status: 'pending' };

    const result = await resolveOfflineSelfId(mockDb, op, new Map(), []);

    expect(result).toEqual({ realId: null, shouldRetry: true });
    expect(mockDb.from).not.toHaveBeenCalled();
  });
});
