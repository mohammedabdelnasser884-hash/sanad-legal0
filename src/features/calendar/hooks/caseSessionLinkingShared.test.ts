import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  makeOfflineTempId, isOfflineTempId, withCaseSelfOfflineSentinel, withFkOfflineSentinel,
  buildCaseInsertData, findMatchingClientByName,
  fetchSessionClientParties, matchClientsForParties, linkClientToParty,
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

  // ══════════════════════════════════════════════════════════════
  //  clientOfflineInfo (7.2 جزء 2) — الموكل الجديد نفسه لسه تمبيد أوفلاين
  //  وقت الربط. لازم UPDATE:case_parties يحمل _offlineFkTempId بدل ما
  //  يبعت التمبيد حرفيًا كـ client_id من غير sentinel.
  // ══════════════════════════════════════════════════════════════

  it('clientOfflineInfo.isTempClientId=true → UPDATE:case_parties بيحمل _offlineFkTempId بدل client_id تمبيد صريح', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const tempClientId = makeOfflineTempId();
    const result = await linkClientToParty(
      'party-2', tempClientId, false, 'case-1', undefined,
      { isTempClientId: true, tempClientId, fallbackNameValue: 'أحمد محمد' },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{
      type: 'UPDATE',
      table: 'case_parties',
      id: 'party-2',
      data: {
        client_id: tempClientId,
        _offlineFkTempId: [{ field: 'client_id', tempId: tempClientId, table: 'clients', fallbackNameValue: 'أحمد محمد' }],
      },
    }]);
  });

  it('clientOfflineInfo مع طرف أساسي → sentinel على case_parties وcases.client_id بالـ id العادي مع بعض', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const tempClientId = makeOfflineTempId();
    const result = await linkClientToParty(
      'party-1', tempClientId, true, 'case-1', undefined,
      { isTempClientId: true, tempClientId, fallbackNameValue: 'موكل جديد' },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        type: 'UPDATE',
        table: 'case_parties',
        id: 'party-1',
        data: {
          client_id: tempClientId,
          _offlineFkTempId: [{ field: 'client_id', tempId: tempClientId, table: 'clients', fallbackNameValue: 'موكل جديد' }],
        },
      },
      { type: 'UPDATE', table: 'cases', id: 'case-1', data: { client_id: tempClientId } },
    ]);
  });

  it('clientOfflineInfo.isTempClientId=false (الموكل اتقيّد أونلاين فعلًا) → مفيش sentinel، client_id عادي بس', async () => {
    const { fn, calls } = mockDbWrite();
    window.__dbWrite = fn as unknown as typeof window.__dbWrite;
    const result = await linkClientToParty(
      'party-2', 'client-real-1', false, 'case-1', undefined,
      { isTempClientId: false, tempClientId: 'tmp-unused', fallbackNameValue: 'سارة علي' },
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([{ type: 'UPDATE', table: 'case_parties', id: 'party-2', data: { client_id: 'client-real-1' } }]);
  });
});
