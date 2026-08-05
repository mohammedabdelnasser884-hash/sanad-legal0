import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeOfflineTempId, isOfflineTempId, withCaseSelfOfflineSentinel, withFkOfflineSentinel,
  buildCaseInsertData, findMatchingClientByName,
  fetchSessionClientParties, matchClientsForParties, linkClientToParty, unlinkClientFromParty,
  copySessionPartiesToNewSession, linkSessionGroupToCase, retryFailedGroupSessionsLinkToCase, updateCaseSessionsForGroup,
  syncSessionIdentityToGroupSiblings,
} from './caseSessionLinkingShared';
import type { SessionClientParty } from './caseSessionLinkingShared';

// ══════════════════════════════════════════════════════════════════
// تيست وحدة مباشر للمنطق المشترك بين useClientLinking.ts وuseSessionLinking.ts
// (خطوة التوحيد بعد مراجعة الكود — راجع تعليق التوثيق أعلى الملف نفسه).
// الهدف: أي فيكس مستقبلي في المنطق ده يتغطى هنا مرة واحدة، بدل ما يتكرر
// اختباره في تيستات الملفين المستخدمين له.
// ══════════════════════════════════════════════════════════════════

describe('makeOfflineTempId / isOfflineTempId', () => {
  it('بيرجع معرّف يبدأ بـ tmp- ومختلف في كل نداء', () => {
    const a = makeOfflineTempId();
    const b = makeOfflineTempId();
    expect(a).toMatch(/^tmp-/);
    expect(b).toMatch(/^tmp-/);
    expect(a).not.toBe(b);
  });

  it('isOfflineTempId بيميّز المعرّفات المؤقتة عن الحقيقية', () => {
    expect(isOfflineTempId(makeOfflineTempId())).toBe(true);
    expect(isOfflineTempId('real-uuid-123')).toBe(false);
  });
});

describe('withCaseSelfOfflineSentinel', () => {
  it('لو caseId حقيقي، بيرجع data زي ما هي من غير أي تغيير', () => {
    const data = { client_id: 'c-1' };
    expect(withCaseSelfOfflineSentinel('real-case-1', data, 'عنوان')).toEqual({ client_id: 'c-1' });
  });

  it('لو caseId تمبيد، بيضيف _offlineSelfTempId و_offlineSelfFallbackName', () => {
    const tempId = makeOfflineTempId();
    const result = withCaseSelfOfflineSentinel(tempId, { client_id: 'c-1' }, 'قضية أوفلاين');
    expect(result).toEqual({
      client_id: 'c-1',
      _offlineSelfTempId: tempId,
      _offlineSelfFallbackName: 'قضية أوفلاين',
    });
  });
});

describe('withFkOfflineSentinel', () => {
  it('لو مش offline&&queued، بيرجع data زي ما هي', () => {
    expect(withFkOfflineSentinel(false, undefined, 'case_id', 'tmp-x', 'cases', 'عنوان', { case_id: 'real-1' }))
      .toEqual({ case_id: 'real-1' });
    expect(withFkOfflineSentinel(true, false, 'case_id', 'tmp-x', 'cases', 'عنوان', { case_id: 'real-1' }))
      .toEqual({ case_id: 'real-1' });
  });

  it('لو offline&&queued، بيضيف _offlineFkTempId بالشكل الصح', () => {
    const result = withFkOfflineSentinel(true, true, 'client_id', 'tmp-y', 'clients', 'أحمد محمد', { client_id: 'tmp-y' });
    expect(result).toEqual({
      client_id: 'tmp-y',
      _offlineFkTempId: [{ field: 'client_id', tempId: 'tmp-y', table: 'clients', fallbackNameValue: 'أحمد محمد' }],
    });
  });

  it('التركيب مع withCaseSelfOfflineSentinel بيدّي شكل الحالة المزدوجة (الاتنين تمبيد مع بعض)', () => {
    const caseTempId = makeOfflineTempId();
    const clientTempId = makeOfflineTempId();
    const result = withCaseSelfOfflineSentinel(
      caseTempId,
      withFkOfflineSentinel(true, true, 'client_id', clientTempId, 'clients', 'موكل د', { client_id: clientTempId }),
      'قضية أوفلاين د',
    );
    expect(result).toEqual({
      client_id: clientTempId,
      _offlineSelfTempId: caseTempId,
      _offlineSelfFallbackName: 'قضية أوفلاين د',
      _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients', fallbackNameValue: 'موكل د' }],
    });
  });
});

describe('buildCaseInsertData', () => {
  const baseFields = {
    court: 'محكمة الجيزة الابتدائية',
    caseNumber: '123 لسنة 2026',
    caseType: 'مدني',
    plaintiff: 'أحمد محمد',
    plaintiffRole: 'مدعي',
    plaintiffNationalId: '29001010100000',
    plaintiffPoa: '456/2026',
    defendant: 'شركة س',
    defendantRole: 'مدعى عليه',
    defendantNationalId: null,
    circuitNumber: '5',
    sessionHall: 'قاعة 3',
    sessionTime: '10:00',
    courtLevel: 'ابتدائي',
    secretaryHall: 'أمين سر 1',
    secretaryName: 'محمود',
    secretaryMobile: '0100000000',
  };

  it('من غير existingClientId، عمود client_id ميتبعتش خالص (مسار جلسة لسه ما اتحفظتش)', () => {
    const result = buildCaseInsertData(baseFields, 'عنوان القضية', 'tmp-1');
    expect(result).not.toHaveProperty('client_id');
    expect(result).toMatchObject({
      title: 'عنوان القضية',
      court_name: 'محكمة الجيزة الابتدائية',
      case_number_official: '123 لسنة 2026',
      case_number: '123 لسنة 2026',
      court: 'محكمة الجيزة الابتدائية',
      case_type: 'مدني',
      plaintiff: 'أحمد محمد',
      plaintiff_role: 'مدعي',
      plaintiff_national_id: '29001010100000',
      plaintiff_power_of_attorney: '456/2026',
      defendant: 'شركة س',
      defendant_role: 'مدعى عليه',
      defendant_national_id: null,
      circuit_number: '5',
      session_hall: 'قاعة 3',
      session_time: '10:00',
      court_level: 'ابتدائي',
      secretary_hall: 'أمين سر 1',
      secretary_name: 'محمود',
      secretary_mobile: '0100000000',
      status: 'نشطة',
      _offlineTempId: 'tmp-1',
    });
  });

  it('لو existingClientId اتبعت (مسار جلسة محفوظة بالفعل)، عمود client_id بيتبعت حتى لو null', () => {
    const withNull = buildCaseInsertData(baseFields, 'عنوان', 'tmp-2', null);
    expect(withNull).toHaveProperty('client_id', null);

    const withValue = buildCaseInsertData(baseFields, 'عنوان', 'tmp-3', 'client-already-linked');
    expect(withValue).toHaveProperty('client_id', 'client-already-linked');
  });

  it('حقول فاضية بترجع null بدل undefined/فاضي (مطابقة السلوك القديم)', () => {
    const result = buildCaseInsertData({}, 'عنوان بديل', 'tmp-4');
    expect(result.court_name).toBe('عنوان بديل'); // fallback للعنوان لو مفيش محكمة
    expect(result.case_number_official).toBe('عنوان بديل');
    expect(result.case_number).toBeNull();
    expect(result.plaintiff).toBeNull();
  });

  // 🆕 (خطة "المسمى القانوني" — بند مؤجل، 24 يوليو 2026)
  it('plaintiffLegalTitle/defendantLegalTitle بيتكتبوا في plaintiff_legal_title/defendant_legal_title', () => {
    const result = buildCaseInsertData(
      { ...baseFields, plaintiffLegalTitle: 'ورثة المرحوم أحمد علي', defendantLegalTitle: 'الشركاء في شركة كذا' },
      'عنوان القضية', 'tmp-5',
    );
    expect(result.plaintiff_legal_title).toBe('ورثة المرحوم أحمد علي');
    expect(result.defendant_legal_title).toBe('الشركاء في شركة كذا');
  });

  it('من غير plaintiffLegalTitle/defendantLegalTitle (الحالة الغالبة، طرف واحد) → null، صفر تغيير سلوك', () => {
    const result = buildCaseInsertData(baseFields, 'عنوان القضية', 'tmp-6');
    expect(result.plaintiff_legal_title).toBeNull();
    expect(result.defendant_legal_title).toBeNull();
  });
});

describe('findMatchingClientByName', () => {
  function makeMockDb(rows: Array<{ id: string; full_name: string | null; client_name?: string | null }>) {
    const isSpy = vi.fn();
    const orSpy = vi.fn();
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn((col: string, val: unknown) => {
            isSpy(col, val);
            return {
              or: vi.fn((clause: string) => {
                orSpy(clause);
                return { limit: vi.fn(() => Promise.resolve({ data: rows, error: null })) };
              }),
            };
          }),
        })),
      })),
    };
    return { db, isSpy, orSpy };
  }

  it('اسم فاضي أو مسافات بس → بيرجع null من غير أي استعلام', async () => {
    const { db, isSpy } = makeMockDb([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findMatchingClientByName(db as any, '   ');
    expect(result).toBeNull();
    expect(isSpy).not.toHaveBeenCalled();
  });

  it('مفيش نتائج → بيرجع null، وبيفلتر على deleted_at ويدوّر على full_name وclient_name مع بعض', async () => {
    const { db, isSpy, orSpy } = makeMockDb([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findMatchingClientByName(db as any, 'أحمد محمد');
    expect(result).toBeNull();
    expect(isSpy).toHaveBeenCalledWith('deleted_at', null);
    expect(orSpy).toHaveBeenCalledWith('full_name.ilike.%أحمد محمد%,client_name.ilike.%أحمد محمد%');
  });

  it('تطابق بالظبط في full_name → matchType = exact', async () => {
    const { db } = makeMockDb([{ id: 'c-1', full_name: 'أحمد محمد' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findMatchingClientByName(db as any, 'أحمد محمد');
    expect(result).toEqual({ client: { id: 'c-1', full_name: 'أحمد محمد' }, matchType: 'exact' });
  });

  it('تطابق بالظبط لكن في client_name بس (full_name فاضي) → matchType = exact برضه', async () => {
    const { db } = makeMockDb([{ id: 'c-2', full_name: null, client_name: 'أحمد محمد' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findMatchingClientByName(db as any, 'أحمد محمد');
    expect(result?.matchType).toBe('exact');
  });

  it('تطابق جزئي بس (اسم أطول/أقصر) → matchType = fuzzy', async () => {
    const { db } = makeMockDb([{ id: 'c-3', full_name: 'أحمد محمد علي حسن' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findMatchingClientByName(db as any, 'أحمد محمد');
    expect(result?.matchType).toBe('fuzzy');
  });

  it('التطابق حساس لحالة الأحرف والمسافات الزايدة بس مش لأكتر من كده (case-insensitive + trim)', async () => {
    const { db } = makeMockDb([{ id: 'c-4', full_name: '  Ahmed Mohamed  ' }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await findMatchingClientByName(db as any, 'ahmed mohamed');
    expect(result?.matchType).toBe('exact');
  });
});

// ══════════════════════════════════════════════════════════════════
// خطة تعدد الأطراف — مرحلة 7.2 جزء 1 (23 يوليو 2026): fetchSessionClientParties
// / matchClientsForParties / linkClientToParty.
// ══════════════════════════════════════════════════════════════════

describe('fetchSessionClientParties', () => {
  function makeMockDb(result: { data?: unknown; error?: unknown }) {
    const eqSpy = vi.fn();
    const orderSpy = vi.fn();
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn((col: string, val: unknown) => {
            eqSpy(col, val);
            return {
              eq: vi.fn((col2: string, val2: unknown) => {
                eqSpy(col2, val2);
                return {
                  order: vi.fn((col3: string, opts: unknown) => {
                    orderSpy(col3, opts);
                    return Promise.resolve(result);
                  }),
                };
              }),
            };
          }),
        })),
      })),
    };
    return { db, eqSpy, orderSpy };
  }

  it('بيستعلم بـ session_id وis_client=true مرتبة بـ sort_order تصاعدي', async () => {
    const rows: SessionClientParty[] = [
      { id: 'p-1', side: 'plaintiff', name: 'أحمد محمد', national_id: null, power_of_attorney: null, address: null, sort_order: 0 },
    ];
    const { db, eqSpy, orderSpy } = makeMockDb({ data: rows, error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchSessionClientParties(db as any, 'session-1');
    expect(result).toEqual(rows);
    expect(eqSpy).toHaveBeenCalledWith('session_id', 'session-1');
    expect(eqSpy).toHaveBeenCalledWith('is_client', true);
    expect(orderSpy).toHaveBeenCalledWith('sort_order', { ascending: true });
  });

  it('مفيش صفوف (جلسة قديمة أو مفيش أطراف is_client) → مصفوفة فاضية', async () => {
    const { db } = makeMockDb({ data: [], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchSessionClientParties(db as any, 'session-1');
    expect(result).toEqual([]);
  });

  it('خطأ في الاستعلام → مصفوفة فاضية (مش استثناء)', async () => {
    const { db } = makeMockDb({ data: null, error: new Error('db error') });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchSessionClientParties(db as any, 'session-1');
    expect(result).toEqual([]);
  });
});

// 🆕 (خطة "المسمى القانوني" — بند مؤجل ثانٍ، 24 يوليو 2026): استمرارية
// بيانات الجلسة القادمة عند تحديث نتيجة جلسة مستقلة فيها أكتر من شخص
// تحت أي طرف (SessionUpdateModal.tsx).
describe('copySessionPartiesToNewSession', () => {
  function makeMockDb(selectResult: { data?: unknown; error?: unknown }, insertError: unknown = null) {
    const eqSpy = vi.fn();
    const insertSpy = vi.fn(() => Promise.resolve({ error: insertError }));
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'case_parties') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn((col: string, val: unknown) => {
                eqSpy(col, val);
                return Promise.resolve(selectResult);
              }),
            })),
            insert: insertSpy,
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    };
    return { db, eqSpy, insertSpy };
  }

  const oldRow = {
    side: 'plaintiff', is_client: true, name: 'أحمد محمد', capacity: 'وريث',
    national_id: '29001010100000', address: 'القاهرة', power_of_attorney: '456/2026',
    client_id: 'client-1', sort_order: 0,
  };

  it('بيقرا صفوف الجلسة القديمة وبينسخها (INSERT صفوف جديدة) للجلسة الجديدة', async () => {
    const { db, eqSpy, insertSpy } = makeMockDb({ data: [oldRow], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await copySessionPartiesToNewSession(db as any, 'old-session', 'new-session');
    expect(result).toEqual({ ok: true });
    expect(eqSpy).toHaveBeenCalledWith('session_id', 'old-session');
    expect(insertSpy).toHaveBeenCalledWith([
      { ...oldRow, case_id: null, session_id: 'new-session' },
    ]);
  });

  it('مفيش صفوف أصلاً (طرف واحد بس بالأعمدة القديمة) → ok=true من غير أي INSERT', async () => {
    const { db, insertSpy } = makeMockDb({ data: [], error: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await copySessionPartiesToNewSession(db as any, 'old-session', 'new-session');
    expect(result).toEqual({ ok: true });
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('خطأ في قراءة صفوف الجلسة القديمة → ok=false', async () => {
    const { db } = makeMockDb({ data: null, error: new Error('db error') });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await copySessionPartiesToNewSession(db as any, 'old-session', 'new-session');
    expect(result).toEqual({ ok: false });
  });

  it('خطأ وقت الـINSERT نفسه → ok=false', async () => {
    const { db } = makeMockDb({ data: [oldRow], error: null }, new Error('insert failed'));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await copySessionPartiesToNewSession(db as any, 'old-session', 'new-session');
    expect(result).toEqual({ ok: false });
  });
});

describe('matchClientsForParties', () => {
  function makeParty(overrides: Partial<SessionClientParty> = {}): SessionClientParty {
    return { id: 'p-1', side: 'plaintiff', name: 'أحمد محمد', national_id: null, power_of_attorney: null, address: null, sort_order: 0, ...overrides };
  }

  function makeMockDbForNames(byName: Record<string, Array<{ id: string; full_name: string | null }>>) {
    const db = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          is: vi.fn(() => ({
            or: vi.fn((clause: string) => {
              // نفس اللي findMatchingClientByName بيبنيه: full_name.ilike.%NAME%,client_name.ilike.%NAME%
              const match = /full_name\.ilike\.%(.+)%,/.exec(clause);
              const name = match ? match[1] : '';
              return { limit: vi.fn(() => Promise.resolve({ data: byName[name] || [], error: null })) };
            }),
          })),
        })),
      })),
    };
    return db;
  }

  it('بيرجع تطابق لكل طرف لقاله نتيجة، وبيتجاهل الطرف اللي مالوش (بالترتيب)', async () => {
    const p1 = makeParty({ id: 'p-1', name: 'أحمد محمد' });
    const p2 = makeParty({ id: 'p-2', name: 'محمود علي', side: 'defendant' });
    const db = makeMockDbForNames({
      'أحمد محمد': [{ id: 'c-1', full_name: 'أحمد محمد' }],
      'محمود علي': [],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await matchClientsForParties(db as any, [p1, p2]);
    expect(result).toEqual([{ party: p1, client: { id: 'c-1', full_name: 'أحمد محمد' }, matchType: 'exact' }]);
  });

  it('مصفوفة أطراف فاضية → مصفوفة تطابقات فاضية من غير أي استعلام', async () => {
    const db = { from: vi.fn() };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await matchClientsForParties(db as any, []);
    expect(result).toEqual([]);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe('linkClientToParty', () => {
  type DbWriteOp = { type: string; table: string; id?: string; data?: Record<string, unknown> };
  function mockDbWrite(results: Record<string, { error: unknown }> = {}) {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      return results[`${op.type}:${op.table}`] ?? { error: null };
    });
    return { fn, calls };
  }

  beforeEach(() => {
    window.__dbWrite = undefined as unknown as typeof window.__dbWrite;
  });

  it('طرف مش أساسي (isPrimaryParty=false) → UPDATE واحدة بس على case_parties، مفيش أي لمسة لـ cases', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await linkClientToParty('party-2', 'client-1', false, 'case-1', undefined);
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ type: 'UPDATE', table: 'case_parties', id: 'party-2', data: { client_id: 'client-1' } }]);
  });

  it('الطرف الأساسي (isPrimaryParty=true) → UPDATE على case_parties وUPDATE على cases.client_id مع بعض', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await linkClientToParty('party-1', 'client-1', true, 'case-1', 'عنوان القضية');
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      { type: 'UPDATE', table: 'case_parties', id: 'party-1', data: { client_id: 'client-1' } },
      { type: 'UPDATE', table: 'cases', id: 'case-1', data: { client_id: 'client-1' } },
    ]);
  });

  it('caseId تمبيد أوفلاين + طرف أساسي → UPDATE:cases بيحمل _offlineSelfTempId/_offlineSelfFallbackName', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const tempCaseId = makeOfflineTempId();
    await linkClientToParty('party-1', 'client-1', true, tempCaseId, 'عنوان مؤقت');
    const caseCall = calls.find((c) => c.table === 'cases');
    expect(caseCall?.data).toEqual({
      client_id: 'client-1',
      _offlineSelfTempId: tempCaseId,
      _offlineSelfFallbackName: 'عنوان مؤقت',
    });
  });

  it('فشل UPDATE على case_parties → ok=false حتى لو الطرف مش أساسي', async () => {
    const { fn } = mockDbWrite({ 'UPDATE:case_parties': { error: new Error('fail') } });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await linkClientToParty('party-2', 'client-1', false, 'case-1', undefined);
    expect(result).toEqual({ ok: false });
  });

  it('فشل UPDATE على cases (طرف أساسي) → ok=false حتى لو case_parties نجحت', async () => {
    const { fn } = mockDbWrite({ 'UPDATE:cases': { error: new Error('fail') } });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await linkClientToParty('party-1', 'client-1', true, 'case-1', undefined);
    expect(result).toEqual({ ok: false });
  });
});

describe('unlinkClientFromParty', () => {
  type DbWriteOp = { type: string; table: string; id?: string; data?: Record<string, unknown> };
  function mockDbWrite(results: Record<string, { error: unknown }> = {}) {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      return results[`${op.type}:${op.table}`] ?? { error: null };
    });
    return { fn, calls };
  }

  beforeEach(() => {
    window.__dbWrite = undefined as unknown as typeof window.__dbWrite;
  });

  it('طرف مش أساسي (isPrimaryParty=false) → UPDATE واحدة بس على case_parties (client_id=null)، مفيش أي لمسة لـ cases', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await unlinkClientFromParty('party-2', false, 'case-1');
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ type: 'UPDATE', table: 'case_parties', id: 'party-2', data: { client_id: null } }]);
  });

  it('الطرف الأساسي (isPrimaryParty=true) → UPDATE على case_parties وUPDATE على cases.client_id=null مع بعض', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await unlinkClientFromParty('party-1', true, 'case-1');
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      { type: 'UPDATE', table: 'case_parties', id: 'party-1', data: { client_id: null } },
      { type: 'UPDATE', table: 'cases', id: 'case-1', data: { client_id: null } },
    ]);
  });

  it('فشل UPDATE على case_parties → ok=false حتى لو الطرف مش أساسي', async () => {
    const { fn } = mockDbWrite({ 'UPDATE:case_parties': { error: new Error('fail') } });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await unlinkClientFromParty('party-2', false, 'case-1');
    expect(result).toEqual({ ok: false });
  });

  it('فشل UPDATE على cases (طرف أساسي) → ok=false حتى لو case_parties نجحت', async () => {
    const { fn } = mockDbWrite({ 'UPDATE:cases': { error: new Error('fail') } });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await unlinkClientFromParty('party-1', true, 'case-1');
    expect(result).toEqual({ ok: false });
  });
});

// 🆕 (باج "orphaned historical session" — تحويل جلسة مستقلة لقضية،
// 4 أغسطس 2026): جلسة عضو في سلسلة session_group_id (نتجت عن "⚡ تحديث
// الجلسة" واحدة أو أكتر) كان تحويلها لقضية بيحدّث case_id للصف اللي
// اتدُس عليه بس — باقي أعضاء السلسلة (جلسات تاريخية) كانوا يفضلوا
// "يتيمين" (case_id=NULL) رغم إن التقويم لسه شايفهم متسلسلين مع بعض
// عن طريق نفس session_group_id.
describe('linkSessionGroupToCase', () => {
  type DbWriteOp = { type: string; table: string; id?: string; data?: Record<string, unknown> };
  function mockDbWrite(results: Record<string, { error: unknown }> = {}) {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      return results[`${op.type}:${op.table}`] ?? { error: null };
    });
    return { fn, calls };
  }

  // case_sessions: .select('id').eq('session_group_id', ...) — awaited مباشرة.
  // case_parties: .select('id').eq('session_id', ...) — awaited مباشرة كمان
  // (movePartiesFromSessionToCase الأصلية)، افتراضيًا [] فاضية (مفيش أطراف).
  function makeMockDb(
    groupResult: { data?: unknown; error?: unknown } = { data: [], error: null },
    partiesResult: { data?: unknown; error?: unknown } = { data: [], error: null },
  ) {
    const db = {
      from: vi.fn((table: string) => {
        if (table === 'case_sessions') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(groupResult)) })) };
        }
        if (table === 'case_parties') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(partiesResult)) })) };
        }
        return {};
      }),
    };
    return db;
  }

  beforeEach(() => {
    window.__dbWrite = undefined as unknown as typeof window.__dbWrite;
  });

  it('مفيش session_group_id → صف واحد بس بيتحدّث (نفس السلوك القديم، مفيش استعلام على case_sessions أصلاً)', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb();
    const result = await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: null }, 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result).toEqual({ ok: true, failedIds: [], linkedCount: 1 });
    expect(db.from).not.toHaveBeenCalledWith('case_sessions');
    expect(calls).toEqual([
      { type: 'UPDATE', table: 'case_sessions', id: 'session-1', data: { case_id: 'case-1' } },
    ]);
  });

  it('فيه session_group_id وله إخوات → كل صفوف السلسلة بتتحدّث بنفس case_id', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null });
    const result = await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result.ok).toBe(true);
    expect(result.linkedCount).toBe(2);
    const sessionCalls = calls.filter((c) => c.table === 'case_sessions');
    expect(sessionCalls.map((c) => c.id).sort()).toEqual(['session-1', 'session-old-9']);
    expect(sessionCalls.every((c) => c.data?.case_id === 'case-1')).toBe(true);
  });

  it('الاستعلام عن السلسلة رجّع من غير الجلسة الأصلية (edge case) → الجلسة الأصلية بتتضاف لقايمة التحديث برضه', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'session-old-9' }], error: null });
    const result = await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result.linkedCount).toBe(2);
    const sessionIds = calls.filter((c) => c.table === 'case_sessions').map((c) => c.id).sort();
    expect(sessionIds).toEqual(['session-1', 'session-old-9']);
  });

  it('خطأ في استعلام السلسلة → فولباك لصف واحد بس (نفس السلوك القديم بدل ما يفشل كله)', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: null, error: new Error('query failed') });
    const result = await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result).toEqual({ ok: true, failedIds: [], linkedCount: 1 });
    expect(calls).toEqual([
      { type: 'UPDATE', table: 'case_sessions', id: 'session-1', data: { case_id: 'case-1' } },
    ]);
  });

  it('صف تاريخي فشل تحديث case_id بتاعه → متتحاولش نقل أطرافه (case_parties)، بس الصف التاني (اللي نجح) بينقل أطرافه عادي', async () => {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      if (op.table === 'case_sessions' && op.id === 'session-old-9') return { error: new Error('fail') };
      return { error: null };
    });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    // partiesResult: صف case_parties واحد — لو الكود حاول ينقل أطراف صف فشل
    // تحديث case_id بتاعه، هيبقى فيه أكتر من UPDATE:case_parties واحدة.
    const db = makeMockDb(
      { data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null },
      { data: [{ id: 'party-1' }], error: null },
    );
    const result = await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result.ok).toBe(false);
    expect(result.failedIds).toEqual(['session-old-9']);
    // صف واحد بس (session-1 اللي نجح) هو اللي وصل لمرحلة نقل الأطراف.
    expect(calls.filter((c) => c.table === 'case_parties')).toHaveLength(1);
  });

  it('نقل أطراف صف في السلسلة فشل (case_parties) → ok=false، الصف ده في failedIds حتى لو case_id بتاعه اتحدّث صح', async () => {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      if (op.table === 'case_parties') return { error: new Error('fail') };
      return { error: null };
    });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb(
      { data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null },
      { data: [{ id: 'party-1' }], error: null },
    );
    const result = await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result.ok).toBe(false);
    expect(result.failedIds.sort()).toEqual(['session-1', 'session-old-9']);
  });

  it('caseId تمبيد أوفلاين → كل صفوف السلسلة بتاخد _offlineFkTempId', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null });
    const tempCaseId = makeOfflineTempId();
    await linkSessionGroupToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, tempCaseId, true, true, tempCaseId, 'عنوان مؤقت',
    );
    const sessionCalls = calls.filter((c) => c.table === 'case_sessions');
    expect(sessionCalls).toHaveLength(2);
    for (const c of sessionCalls) {
      expect(c.data?._offlineFkTempId).toEqual([
        { field: 'case_id', tempId: tempCaseId, table: 'cases', fallbackNameValue: 'عنوان مؤقت' },
      ]);
    }
  });
});

// 🆕 (زرار "أعد المحاولة" — 5 أغسطس 2026): retryFailedGroupSessionsLinkToCase
// بتاخد قائمة IDs محددة مسبقًا (بدل ما تجيب السلسلة كلها من جديد زي
// linkSessionGroupToCase) وتعيد نفس محاولة الربط لها بس.
describe('retryFailedGroupSessionsLinkToCase', () => {
  type DbWriteOp = { type: string; table: string; id?: string; data?: Record<string, unknown> };

  beforeEach(() => {
    window.__dbWrite = undefined as unknown as typeof window.__dbWrite;
  });

  function makeMockDb(partiesResult: { data?: unknown; error?: unknown } = { data: [], error: null }) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'case_parties') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(partiesResult)) })) };
        }
        return {};
      }),
    };
  }

  it('كل الصفوف الفاشلة بتتربط بنجاح في المحاولة الجديدة → ok=true, failedIds=[]', async () => {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => { calls.push(op); return { error: null }; });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb();
    const result = await retryFailedGroupSessionsLinkToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, ['session-old-9'], 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result).toEqual({ ok: true, failedIds: [] });
    const sessionCalls = calls.filter((c) => c.table === 'case_sessions');
    expect(sessionCalls).toEqual([
      { type: 'UPDATE', table: 'case_sessions', id: 'session-old-9', data: { case_id: 'case-1' } },
    ]);
    // مفيش استعلام على case_sessions.select — بتاخد الـ IDs جاهزة، مش بتجيبها تاني.
    expect(db.from).not.toHaveBeenCalledWith('case_sessions');
  });

  it('صف لسه فاشل بعد إعادة المحاولة → ok=false، بيفضل في failedIds', async () => {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      if (op.table === 'case_sessions' && op.id === 'session-old-9') return { error: new Error('still failing') };
      return { error: null };
    });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb();
    const result = await retryFailedGroupSessionsLinkToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, ['session-old-9', 'session-old-11'], 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result.ok).toBe(false);
    expect(result.failedIds).toEqual(['session-old-9']);
  });

  it('caseId تمبيد أوفلاين → الصفوف بتاخد _offlineFkTempId زي linkSessionGroupToCase بالظبط', async () => {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => { calls.push(op); return { error: null }; });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb();
    const tempCaseId = makeOfflineTempId();
    await retryFailedGroupSessionsLinkToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, ['session-old-9'], tempCaseId, true, true, tempCaseId, 'عنوان مؤقت',
    );
    const sessionCalls = calls.filter((c) => c.table === 'case_sessions');
    expect(sessionCalls[0]?.data?._offlineFkTempId).toEqual([
      { field: 'case_id', tempId: tempCaseId, table: 'cases', fallbackNameValue: 'عنوان مؤقت' },
    ]);
  });

  it('نقل أطراف صف فشل → الصف ده في failedIds حتى لو case_id بتاعه اتحدّث صح', async () => {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      if (op.table === 'case_parties') return { error: new Error('fail') };
      return { error: null };
    });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'party-1' }], error: null });
    const result = await retryFailedGroupSessionsLinkToCase(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, ['session-old-9'], 'case-1', false, false, 'tmp-x', 'عنوان',
    );
    expect(result).toEqual({ ok: false, failedIds: ['session-old-9'] });
  });
});

// 🆕 (باج "orphaned historical session" — نسخة عامة، 5 أغسطس 2026):
// نفس فكرة linkSessionGroupToCase فوق بس لتحديثات case_sessions التانية
// (زي ربط موكل مباشرة بجلسة مستقلة) اللي مش عن طريق linkSessionGroupToCase.
describe('updateCaseSessionsForGroup', () => {
  type DbWriteOp = { type: string; table: string; id?: string; data?: Record<string, unknown> };
  function mockDbWrite(perIdError: Record<string, unknown> = {}, perIdResult: Record<string, { offline?: boolean; queued?: boolean }> = {}) {
    const calls: DbWriteOp[] = [];
    const fn = vi.fn(async (op: DbWriteOp) => {
      calls.push(op);
      const extra = op.id ? (perIdResult[op.id] ?? {}) : {};
      return { error: op.id ? (perIdError[op.id] ?? null) : null, ...extra };
    });
    return { fn, calls };
  }

  function makeMockDb(groupResult: { data?: unknown; error?: unknown } = { data: [], error: null }) {
    return {
      from: vi.fn((table: string) => {
        if (table === 'case_sessions') {
          return { select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(groupResult)) })) };
        }
        return {};
      }),
    };
  }

  beforeEach(() => {
    window.__dbWrite = undefined as unknown as typeof window.__dbWrite;
  });

  it('مفيش session_group_id → __dbWrite بيتنادى مرة واحدة بس بنفس الـ data المرسلة', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb();
    const result = await updateCaseSessionsForGroup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: null }, { client_id: 'client-1' },
    );
    expect(result.ok).toBe(true);
    expect(result.linkedCount).toBe(1);
    expect(calls).toEqual([{ type: 'UPDATE', table: 'case_sessions', id: 'session-1', data: { client_id: 'client-1' } }]);
  });

  it('فيه إخوات في السلسلة → نفس الـ data بتتبعت لكل صف', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null });
    const result = await updateCaseSessionsForGroup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, { client_id: 'client-1' },
    );
    expect(result.linkedCount).toBe(2);
    const ids = calls.map((c) => c.id).sort();
    expect(ids).toEqual(['session-1', 'session-old-9']);
    expect(calls.every((c) => c.data?.client_id === 'client-1')).toBe(true);
  });

  it('offline/queued بترجع من نتيجة الجلسة الأصلية (session.id) بالذات', async () => {
    const { fn } = mockDbWrite({}, { 'session-1': { offline: true, queued: true }, 'session-old-9': { offline: false, queued: false } });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null });
    const result = await updateCaseSessionsForGroup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, { client_id: 'client-1' },
    );
    expect(result.offline).toBe(true);
    expect(result.queued).toBe(true);
  });

  it('صف تاريخي فشل تحديثه → ok=false، failedIds فيه الصف ده بس', async () => {
    const { fn } = mockDbWrite({ 'session-old-9': new Error('fail') });
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const db = makeMockDb({ data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null });
    const result = await updateCaseSessionsForGroup(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, { client_id: 'client-1' },
    );
    expect(result.ok).toBe(false);
    expect(result.failedIds).toEqual(['session-old-9']);
  });
});

// 🆕 (تناسق "هوية" السلسلة — 5 أغسطس 2026): بعكس updateCaseSessionsForGroup
// فوق (بتستخدم __dbWrite)، الدالة دي بتستخدم db.update() مباشرة — نفس نمط
// safeUpdate في نداء الحفظ الأساسي بـ StandaloneSessionDetailModal.tsx
// (الشاشة دي لسه مش متحوّلة لطابور الأوفلاين بالكامل).
describe('syncSessionIdentityToGroupSiblings', () => {
  type UpdateCall = { table: string; data: Record<string, unknown>; id: string };

  // db.from('case_sessions').select('id').eq('session_group_id', ...) —
  // fetchSessionGroupIds الداخلية. وdb.from('case_sessions').update(data).eq('id', ...)
  // — الكتابة الفعلية لكل أخ في السلسلة.
  function makeMockDb(
    groupResult: { data?: unknown; error?: unknown } = { data: [], error: null },
    updateErrors: Record<string, unknown> = {},
  ) {
    const updateCalls: UpdateCall[] = [];
    const db = {
      from: vi.fn((table: string) => ({
        select: vi.fn(() => ({ eq: vi.fn(() => Promise.resolve(groupResult)) })),
        update: vi.fn((data: Record<string, unknown>) => ({
          eq: vi.fn((_col: string, id: string) => {
            updateCalls.push({ table, data, id });
            return Promise.resolve({ error: updateErrors[id] ?? null });
          }),
        })),
      })),
    };
    return { db, updateCalls };
  }

  it('مفيش session_group_id → مفيش أي db.update خالص، siblingCount=0', async () => {
    const { db, updateCalls } = makeMockDb();
    const result = await syncSessionIdentityToGroupSiblings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: null }, { court: 'محكمة الجيزة' },
    );
    expect(result).toEqual({ ok: true, failedIds: [], siblingCount: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it('فيه session_group_id بس الجلسة الأصلية هي الوحيدة (مفيش إخوات فعليين) → مفيش db.update، siblingCount=0', async () => {
    const { db, updateCalls } = makeMockDb({ data: [{ id: 'session-1' }], error: null });
    const result = await syncSessionIdentityToGroupSiblings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, { court: 'محكمة الجيزة' },
    );
    expect(result).toEqual({ ok: true, failedIds: [], siblingCount: 0 });
    expect(updateCalls).toHaveLength(0);
  });

  it('فيه إخوات → db.update بيتنادى لكل أخ بنفس الـ data، مش على الجلسة الأصلية نفسها', async () => {
    const { db, updateCalls } = makeMockDb({ data: [{ id: 'session-1' }, { id: 'session-old-9' }, { id: 'session-old-3' }], error: null });
    const identityData = { court: 'محكمة الجيزة', plaintiff: 'أحمد محمد' };
    const result = await syncSessionIdentityToGroupSiblings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, identityData,
    );
    expect(result.ok).toBe(true);
    expect(result.siblingCount).toBe(2);
    const ids = updateCalls.map((c) => c.id).sort();
    expect(ids).toEqual(['session-old-3', 'session-old-9']);
    expect(updateCalls.every((c) => c.data === identityData)).toBe(true);
  });

  it('أخ فشل تحديثه → ok=false، failedIds فيه الأخ ده بس', async () => {
    const { db } = makeMockDb(
      { data: [{ id: 'session-1' }, { id: 'session-old-9' }], error: null },
      { 'session-old-9': new Error('fail') },
    );
    const result = await syncSessionIdentityToGroupSiblings(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db as any, { id: 'session-1', session_group_id: 'group-abc' }, { court: 'محكمة الجيزة' },
    );
    expect(result.ok).toBe(false);
    expect(result.failedIds).toEqual(['session-old-9']);
    expect(result.siblingCount).toBe(2);
  });
});

