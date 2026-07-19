import { describe, it, expect, vi } from 'vitest';
import type { db } from '../supabaseClient';

// ⚠️ نفس نمط offlineQueue.fkTempId.test.ts بالظبط (mock لموديولات
// offlineQueue.ts الثلاثة قبل الاستيراد، عشان الاستيراد نفسه ميفشلش —
// resolveOfflineSelfId/resolveOfflineFkRefs بياخدوا dbClient كباراميتر).
vi.mock('../supabaseClient', () => ({ db: {} }));
vi.mock('../shared/lib/notifications', () => ({
  showOfflineBanner: vi.fn(), hideOfflineBanner: vi.fn(),
  showSyncIndicator: vi.fn(), hideSyncIndicator: vi.fn(), toast: vi.fn(),
}));
vi.mock('../shared/lib/dataAccess', () => ({ logActivity: vi.fn(), recalcNextHearing: vi.fn() }));

import { resolveOfflineFkRefs, resolveOfflineSelfId, type OfflineFkTempIdRef, type OfflineQueueItem } from './offlineQueue';

// ══════════════════════════════════════════════════════════════════
// المرحلة 3-3 من "خطة توسيع نظام الأوفلاين" — اختبار تكامل السلسلة
// كاملة (المراحل 2 + 3-1 + 3-2 مع بعض): "أوفلاين بالكامل من الألف
// للياء" — إنشاء قضية + إضافة عميل جديد + ربطهم، كله والنت مقطوع.
//
// بنحاكي هنا بالظبط الترتيب اللي دورة المزامنة (__syncOfflineQueue في
// offlineQueue.ts) بتنفذه فعليًا لكل عملية UPDATE: resolveOfflineSelfId
// أولاً (حل id السطر نفسه لو تمبيد)، وبعده resolveOfflineFkRefs (حل أي
// حقل FK جوه data). الدالتين بياخدوا dbClient/tempIdToRealId/queue
// كباراميترات (dependency injection)، فمقدر أحاكي التسلسل الكامل من
// غير محاكاة IndexedDB فعلية (نفس القيد الموثّق في المراحل السابقة —
// المشروع مفيهوش fake-indexeddb كـ dependency).
// ══════════════════════════════════════════════════════════════════

function makeOp(data: Record<string, unknown>, table: OfflineQueueItem['table'], id: string | number = 1): OfflineQueueItem {
  return { id, type: 'UPDATE', table, data, timestamp: Date.now(), status: 'pending' };
}

const noopDb = {} as unknown as typeof db; // مش هيتنادى — كل التمبيدات في السيناريو دي بتتحل من الذاكرة (tempIdToRealId)، صفر fallback بالاسم

describe('المرحلة 3-3 — تكامل: قضية + عميل جديد + ربط، الكل أوفلاين', () => {
  it('السيناريو الكامل: القضية والعميل اتزامنوا في نفس الدورة → ربط الجلسة وربط القضية بالعميل بيتحلوا صح مع بعض', async () => {
    // ترتيب دورة المزامنة الحقيقي: القضية والعميل (INSERT) بيتعالجوا الأول
    // (زي ما هما مرتبين في الطابور من وقت الإدراج)، فـ tempIdToRealId
    // بتبقى فيها الاتنين قبل ما نوصل لعمليات UPDATE اللي بتشاور عليهم.
    const tempIdToRealId = new Map<string, string>([
      ['tmp-case-1', 'real-case-1'],
      ['tmp-client-1', 'real-client-1'],
    ]);
    const queue: OfflineQueueItem[] = []; // مفيش حاجة لسه معلّقة في الطابور

    // 1) ربط الجلسة الأصلية بالقضية (من handleLinkCase) — UPDATE على
    //    case_sessions، case_id بيشاور على تمبيد القضية.
    const sessionLinkRefs: OfflineFkTempIdRef[] = [
      { field: 'case_id', tempId: 'tmp-case-1', table: 'cases', fallbackNameValue: 'قضية من جلسة مستقلة' },
    ];
    const sessionLinkOp = makeOp({ case_id: null, _offlineFkTempId: sessionLinkRefs }, 'case_sessions', 'real-session-1');
    const sessionLinkResolved = await resolveOfflineFkRefs(noopDb, sessionLinkOp, tempIdToRealId, queue);
    expect(sessionLinkResolved.shouldRetry).toBe(false);
    expect(sessionLinkResolved.data.case_id).toBe('real-case-1');
    expect(sessionLinkResolved.data._offlineFkTempId).toBeUndefined();

    // 2) ربط القضية بالعميل الجديد (من handleAddAndLinkClient، سيناريو "د" —
    //    الاتنين تمبيد مع بعض) — UPDATE على cases، بمعرّف السطر نفسه
    //    (createdCaseId) تمبيد، وحقل client_id جوه data تمبيد كمان.
    const caseClientLinkOp = makeOp(
      {
        client_id: null,
        _offlineSelfTempId: 'tmp-case-1',
        _offlineSelfFallbackName: 'قضية من جلسة مستقلة',
        _offlineFkTempId: [{ field: 'client_id', tempId: 'tmp-client-1', table: 'clients', fallbackNameValue: 'أحمد محمد' }] as OfflineFkTempIdRef[],
      },
      'cases',
      'tmp-case-1', // op.id نفسه لسه تمبيد وقت القيد
    );

    // نفس ترتيب __syncOfflineQueue بالظبط: resolveOfflineSelfId أولاً
    const selfResolved = await resolveOfflineSelfId(noopDb, caseClientLinkOp, tempIdToRealId, queue);
    expect(selfResolved.shouldRetry).toBe(false);
    expect(selfResolved.realId).toBe('real-case-1');

    // وبعده resolveOfflineFkRefs على نفس العملية (لسه فيها data.client_id)
    const fkResolved = await resolveOfflineFkRefs(noopDb, caseClientLinkOp, tempIdToRealId, queue);
    expect(fkResolved.shouldRetry).toBe(false);
    expect(fkResolved.data.client_id).toBe('real-client-1');
    expect(fkResolved.data._offlineFkTempId).toBeUndefined();
    // _offlineSelfTempId مش من مسؤولية resolveOfflineFkRefs إنها تشيله —
    // بيتشال فعليًا في دورة المزامنة عن طريق stripOfflineSentinels العام
    // قبل الإرسال الفعلي لـ Supabase (نفس أي حقل _offline* تاني)، مش هنا.
    expect(fkResolved.data._offlineSelfTempId).toBe('tmp-case-1');

    // النتيجة النهائية: لو استخدمنا resolvedOpId من (1) كـ .eq('id', ...)
    // وfkResolved.data كـ payload الـ UPDATE، العملية هتحدّث الصف الحقيقي
    // الصح (real-case-1) بـ client_id الصح (real-client-1) — بالظبط
    // السلوك المتوقع من السلسلة كاملة.
  });

  it('القضية اتزامنت لكن العميل لسه معلّق في نفس الطابور → shouldRetry:true، منعملش UPDATE جزئي', async () => {
    const tempIdToRealId = new Map<string, string>([['tmp-case-2', 'real-case-2']]);
    const pendingClientOp = makeOp({ _offlineTempId: 'tmp-client-2', full_name: 'سارة علي' }, 'clients', 5);
    const queue: OfflineQueueItem[] = [pendingClientOp];

    const op = makeOp(
      {
        client_id: null,
        _offlineSelfTempId: 'tmp-case-2',
        _offlineFkTempId: [{ field: 'client_id', tempId: 'tmp-client-2', table: 'clients' }] as OfflineFkTempIdRef[],
      },
      'cases',
      'tmp-case-2',
    );

    const selfResolved = await resolveOfflineSelfId(noopDb, op, tempIdToRealId, queue);
    expect(selfResolved.shouldRetry).toBe(false);
    expect(selfResolved.realId).toBe('real-case-2');

    // العميل لسه في الطابور — العملية كلها لازم تستنى الدورة الجاية،
    // مش نعمل UPDATE جزئي (client_id يفضل null بدل قيمة غلط أو ناقصة).
    const fkResolved = await resolveOfflineFkRefs(noopDb, op, tempIdToRealId, queue);
    expect(fkResolved.shouldRetry).toBe(true);
  });

  it('ترتيب الحل معكوس (القضية نفسها لسه تمبيد ومعلّقة) → resolveOfflineSelfId بيوقف السلسلة الأول، مفيش داعي نوصل لـ resolveOfflineFkRefs', async () => {
    const tempIdToRealId = new Map<string, string>([['tmp-client-3', 'real-client-3']]);
    const pendingCaseOp = makeOp({ _offlineTempId: 'tmp-case-3', title: 'قضية لسه معلّقة' }, 'cases', 9);
    const queue: OfflineQueueItem[] = [pendingCaseOp];

    const op = makeOp(
      {
        client_id: null,
        _offlineSelfTempId: 'tmp-case-3',
        _offlineFkTempId: [{ field: 'client_id', tempId: 'tmp-client-3', table: 'clients' }] as OfflineFkTempIdRef[],
      },
      'cases',
      'tmp-case-3',
    );

    const selfResolved = await resolveOfflineSelfId(noopDb, op, tempIdToRealId, queue);
    expect(selfResolved.shouldRetry).toBe(true);
    expect(selfResolved.realId).toBeNull();
    // نفس منطق __syncOfflineQueue الفعلي: لو selfResolved.shouldRetry،
    // بنعمل bumpRetry ونكمل للعملية الجاية من غير ما ننادي
    // resolveOfflineFkRefs خالص — العميل ممكن يكون جاهز فعلاً، بس مفيش
    // فايدة نحله لو السطر المستهدف نفسه (القضية) لسه مش موجود في القاعدة.
  });
});
