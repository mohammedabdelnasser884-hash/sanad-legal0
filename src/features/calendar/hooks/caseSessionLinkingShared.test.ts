import { describe, it, expect, vi } from 'vitest';
import {
  makeOfflineTempId, isOfflineTempId, withCaseSelfOfflineSentinel, withFkOfflineSentinel,
  buildCaseInsertData, findMatchingClientByName,
} from './caseSessionLinkingShared';

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
