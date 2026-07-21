import { db } from '../supabaseClient';
import type { Database } from '../database.types';
import { showOfflineBanner, hideOfflineBanner, showSyncIndicator, hideSyncIndicator, toast } from '../shared/lib/notifications';
import { logActivity, recalcNextHearing } from '../shared/lib/dataAccess';

// ══════════════════════════════════════════════════════════
//  Offline Queue (IndexedDB) + __dbWrite — منقول من main.tsx
//  (اتفصل بتاريخ 15 يوليو 2026 كجزء من خطة تخفيف main.tsx)
// ══════════════════════════════════════════════════════════

// ⚠️ الجداول الحقيقية اللي ممكن توصل لـ __dbWrite — اتأكدت من كل نداء فعلي
// في المشروع كله (useCaseActions.ts، useClientActions.ts، useRemindersTab.ts).
// مستخدمة في توقيع __dbWrite نفسه، وكمان في OfflineQueueItem.table تحت (لأن
// __offlineEnqueue بيتنادى حصريًا من جوه __dbWrite بنفس القيم دي بالظبط —
// مفيش أي نداء تاني ليها في المشروع كله).
//
// 🆕 المرحلة 6 (خطة توسيع نظام الأوفلاين — H-3، 21 يوليو): 'reminders' اتضافت
// كأول جدول من الأربعة المتبقية (الأولوية: بساطة، صفر أعمدة FK بتشاور على
// جدول تاني ممكن يكون لسه في الطابور — بعكس case_fees مثلًا).
//
// 🆕 المرحلة 6 (تكملة): 'case_fees' و'fee_payments' اتضافوا تانيًا. ⚠️ قرار
// عمل محسوم مع صاحب المشروع (21 يوليو): تسجيل دفعة أتعاب (`handleAddPayment`،
// بينادي RPC ذرّية `record_fee_payment`) وحذف دفعة (`handleDeletePayment`،
// عمليتين متتاليتين متعتمدتين — حذف + إعادة حساب) **ممنوعين تمامًا أوفلاين**
// (رسالة صريحة "يتطلب اتصال بالإنترنت")، مش مقيّدين في الطابور — عشان منرجعش
// لمشكلة الـ partial-save اللي المرحلة 4 حلّتها أصلاً لو حاولنا نبني نسخة
// أوفلاين من عملية متعددة الخطوات معتمدة على نتيجة السيرفر. عمليات case_fees
// التانية (إضافة سجل جديد من غير دفعة مبدئية، حذف/أرشفة/استرجاع) عمليات
// وحيدة الخطوة، فهي دي اللي فعليًا بتستخدم __dbWrite/الطابور تحت.
//
// 🆕 المرحلة 6 (تكملة ثانية، 21 يوليو): 'case_notes' اتضافت — تحويلات خالصة
// على جدول واحد (INSERT/UPDATE/DELETE)، صفر تفاعل مع Storage، وصفر FK فعلي
// على case_id (مؤكَّد بالقسم 0.1 من التقرير: case_notes مالهاش FK نحو
// cases)، فمفيش داعي لـ _offlineFkTempId هنا أصلاً — وقت ما المستخدم بيضيف
// ملاحظة، القضية نفسها لازم تكون محمّلة ومعروضة على الشاشة بالفعل (يعني
// سجل حقيقي متزامن، مش تمبيد لسه في الطابور).
// ⚠️ 'case_documents' اتفحصت وقُرِّر عمدًا إنها **متتضافش** هنا: كل عملية
// عليها (رفع/حذف) خطوة معتمدة ماديًا على الشبكة (بايتات الملف نفسها لازم
// توصل فعليًا لـ Supabase Storage — مفيش تمثيل ممكن للملف في IndexedDB/
// الطابور زي صف DB عادي)، فمينفعش "نقيّدها" زي باقي الجداول. نفس فلسفة
// قرار case_fees/fee_payments بالظبط — راجع useCaseDocuments.ts للتفصيل.
//
// 🆕 المرحلة 6.5 (تكملة ثالثة، 21 يوليو): `case_sessions` كانت مُدرجة هنا
// من الأول (من التلات جداول الأصلية)، لكن استخدامها كان مقصور فعليًا على
// تدفقات "ربط جلسة مستقلة بقضية" (useSessionLinking.ts/NewStandaloneSessionModal.tsx)
// بس. إضافة/تعديل/حذف جلسة من *صفحة تفاصيل القضية مباشرة* (useCaseSessions.ts)
// كانت لسه بتستخدم db.from()/safeUpdate مباشر. دلوقتي بقت بتستخدم __dbWrite
// زيها زي باقي التدفقات. case_id في السيناريو ده دايمًا حقيقي (القضية
// محمّلة ومعروضة على الشاشة بالفعل، مش تمبيد)، فمفيش داعي لـ
// _offlineFkTempId/_offlineCaseTempId هنا — لكن عشان next_hearing يتحدّث
// صح بعد المزامنة (مش بس أونلاين فورًا)، useCaseSessions.ts بيبعت sentinel
// جديد `_offlineSessionCaseId` (INSERT: case_id نفسه موجود أصلاً كعمود
// حقيقي فمش محتاج سنتينل؛ UPDATE/DELETE: محتاجين السنتينل لأن case_id مش
// جزء من بيانات العملية أصلاً) — شوف caseSessionCaseIdsToRecalc تحت.
export type DbWriteTable = 'clients' | 'cases' | 'case_sessions' | 'reminders' | 'case_fees' | 'fee_payments' | 'case_notes';

// ⚠️ قيد معروف في supabase-js + TypeScript: تسلسل .insert()/.update()/.delete()
// ثم .select()/.eq() على db.from(table) لما `table` يكون Generic (T extends
// DbWriteTable) بدل literal واحد ثابت بيخلي المكتبة تحاول تحل النوع على
// مستوى الـ schema كله (كل الجداول) بدل التلات جداول المسموحة بس، فبترجع
// أخطاء ضخمة (RejectExcessProperties/keyof) وقت البناء — نفس المشكلة ظهرت
// في useAdminBackup.ts مع دالة dynFrom لكن على نطاق أوسع هنا بسبب السلسلة
// الأطول (insert().select().single()، update().eq().select().single()).
// الحل: نأكد لـ TypeScript إن الجدول واحد من التلات المعروفين فعلاً (بنستخدم
// 'cases' كممثل — عنده نفس أعمدة id/updated_at المشتركة بين التلات جداول)
// وقت بناء الـ query builder بس. التحقق الحقيقي من اسم الجدول وقت الكتابة
// لسه قائم عن طريق `table: DbWriteTable` في توقيع الدالة الخارجية — الكاست
// هنا بيأثر بس على شكل الـ builder وقت الـ type-check، مش على اسم الجدول
// أو البيانات الفعلية وقت التشغيل.
function dbFrom(table: DbWriteTable) {
  return db.from(table as 'cases');
}

// ⚠️ شكل عنصر واحد في طابور الأوفلاين (IndexedDB) — نفس الحقول اللي
// بيتضافوا فعليًا في __offlineEnqueue (timestamp/status) + الحقول اللي
// بيتبعتوا من __dbWrite (type/table/data/id/knownUpdatedAt). `data` لسه
// Record<string, unknown> عام عن قصد: العملية ممكن تكون لأي جدول من
// جداول التطبيق (نفس التفاوت الموثّق في useAdminBackup.ts — مش سهو).
//
// 🔎 اكتشاف (موثّق سابقًا، اتصلح بعد موافقة صريحة من المستخدم): `id` هنا
// فعليًا بيتخزن فيه قيمتين مختلفتين حسب نوع العملية — مش تسرّب لنوع غلط،
// ده تصميم مقصود من الأول: IndexedDB بيستخدم أي خاصية بنفس اسم الـ
// keyPath ('id') كـ *مفتاح السجل نفسه* لو كانت معرّفة، وبيولّد رقم تلقائي
// بس لو كانت `undefined`. يعني: عمليات INSERT بتتبعت من غير `id` (بيتولّد
// رقم تلقائي `number`)، وعمليات UPDATE/DELETE بتتبعت بالـ id الحقيقي بتاع
// السجل (`string`، من __dbWrite). النوع بقى `number | string` عشان يعكس
// الحالتين الحقيقيتين دول — صفر تغيير سلوك، تصحيح دقة نوع بس.
//
// 🔎 اكتشاف تاني (اتصلح بعد موافقة صريحة من المستخدم): `table` كانت معرّفة
// `string` عام. بحثت في كل المشروع عن كل نداء فعلي بيضيف عنصر للطابور —
// المصدر الوحيد هو __dbWrite (تحت)، اللي بينادي __offlineEnqueue بنفس قيمة
// `table: T` بتاعته (T extends DbWriteTable) وقت الفشل أونلاين. مفيش أي
// نداء تاني لـ __offlineEnqueue في المشروع كله. يعني القيمة الفعلية
// المخزّنة في IndexedDB دايمًا واحدة من التلاتة دول بالظبط — نفس النوع
// المُعرَّف فوق (DbWriteTable)، فاستخدمته هنا بدل `string` العام.
export interface OfflineQueueItem {
  id: number | string;
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: DbWriteTable;
  data?: Record<string, unknown>;
  knownUpdatedAt?: string | null;
  timestamp: number;
  status: string;
  // 🔒 FIX (تتبع "إضافة قضية" — 18 يوليو 2026): عدد مرات فشل المزامنة لنفس
  // العنصر ده. قبل كده، عنصر عالق (مثلاً جلسة مستنية قضية اتعرقلت) كان
  // بيحاول يتزامن كل دقيقة *للأبد* من غير أي سقف أو تنبيه واضح للمستخدم إن
  // فيه حاجة محتاجة تدخل يدوي. `undefined`/غير موجود = عنصر قديم من قبل
  // الفيكس، بنعامله كـ 0.
  retryCount?: number;
}

declare global {
  interface Window {
    __offlineEnqueue: (op: object) => Promise<boolean>;
    __getOfflineQueue: () => Promise<OfflineQueueItem[]>;
    __getOfflineQueueCount: () => Promise<number>;
    __deleteOfflineItem: (id: number | string) => Promise<void>;
    __updateOfflineItem: (item: OfflineQueueItem) => Promise<void>;
    __syncOfflineQueue: () => Promise<void>;
    // ⚠️ `table` بقى Generic (T extends DbWriteTable) بدل `string` — بيتحقق
    // وقت الكتابة إن اسم الجدول حقيقي وموجود في database.types.ts (كان ده
    // أصل الـ `any` القديم، زي نفس نمط dynFrom في useAdminBackup.ts).
    // `data` فضلت Record<string, unknown> عن قصد (مش Insert/Update الحقيقي
    // بتاع الجدول): نداء واحد فعلي (حفظ قضية أوفلاين مع جلستها الأولى في
    // useCaseActions.ts) بيبعت حقل sentinel مؤقت (`_offlineCaseTitle`) مش
    // عمود DB حقيقي — بيتحذف قبل الإدراج الفعلي وقت المزامنة. ربطها بنوع
    // صارم كان هيرفض الحقل ده غلط رغم إنه سلوك مقصود وموجود من الأول.
    // `data` المرجعة بقت `Partial<Row>` (مش `Row` الكامل) لأن مسار
    // UPDATE بيرجّع بس `updated_at` من `.select('updated_at')`، مش الصف
    // كامل — Partial بتغطي الحالتين (INSERT بيرجّع صف كامل، UPDATE بيرجّع
    // عمود واحد بس) من غير ما تدّعي شكل مش حقيقي.
    //
    // 🆕 المرحلة 1: `data` بقى ممكن يحمل كمان `_offlineFkTempId:
    // OfflineFkTempIdRef[]` (شوف تعريفها فوق) — سنتينل عام لأي عملية
    // INSERT/UPDATE محتاجة "تشاور" على سجل لسه في الطابور (مش بس
    // `_offlineCaseTempId` القديمة المقصورة على case_id). زي باقي حقول
    // الـ sentinel، بيتشال قبل أي كتابة حقيقية في القاعدة (أونلاين أو وقت
    // المزامنة) وميوصلش لـ Supabase أبدًا.
    __dbWrite: <T extends DbWriteTable>(op: {
      type: 'INSERT' | 'UPDATE' | 'DELETE';
      table: T;
      data?: Record<string, unknown>;
      id?: string;
      knownUpdatedAt?: string | null;
      returning?: boolean;
    }) => Promise<{
      error: unknown;
      offline?: boolean;
      queued?: boolean;
      data?: Partial<Database['public']['Tables'][T]['Row']> | null;
      conflict?: boolean;
    }>;
  }
}

// ══════════════════════════════════════════════════════════
//  IndexedDB — Offline Queue
// ══════════════════════════════════════════════════════════
const DB_NAME    = 'sanad-offline';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

function openOfflineDB(): Promise<IDBDatabase> {
    return new Promise((resolve: (db: IDBDatabase) => void, reject: (err: unknown) => void) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e: IDBVersionChangeEvent) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        req.onsuccess  = () => resolve(req.result);
        req.onerror    = () => reject(req.error);
    });
}

window.__offlineEnqueue = async (operation: object): Promise<boolean> => {
    try {
        const db    = await openOfflineDB();
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.add({ ...operation, timestamp: Date.now(), status: 'pending' });
        await new Promise<void>((res: () => void, rej: (err: unknown) => void) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    } catch (err) {
        // BUG FIX: ده كان بيفشل بصمت من قبل — والـ caller كان يفتكر إن الحفظ
        // المحلي تم بنجاح وهو فعليًا لسه متضايع. دلوقتي بنرجّع false عشان
        // __dbWrite يقدر يبلّغ المستخدم إن الحفظ فشل فعلاً.
        console.error('[Offline] Failed to enqueue — data NOT saved locally:', err);
        return false;
    }
    // طبقة إضافية: نسجّل Background Sync لو المتصفح بيدعمها (Chrome/Android).
    // ده تحسين فوقي بس — مش الاعتماد الأساسي، لأن Safari/iOS مابيدعمهاش أصلاً.
    // الاعتماد الأساسي هو مستمع 'online' المباشر اللي تحت في نفس الملف.
    try {
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const reg = await navigator.serviceWorker.ready;
            // ⚠️ Background Sync (SyncManager) لسه مش جزء من TS lib.dom القياسية
            // (API تجريبي، Chrome/Android بس) — الكاست هنا محصور في الخاصية
            // دي بس (مش الـ registration كله زي `as any` القديمة).
            await (reg as ServiceWorkerRegistration & { sync: { register(tag: string): Promise<void> } }).sync.register('sync-offline-queue');
        }
    } catch (err) {
        // طبيعي إن ده يفشل على متصفحات مش داعمة — متجاهلين
    }
    return true;
};

window.__getOfflineQueue = async () => {
    try {
        const db    = await openOfflineDB();
        const tx    = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req   = store.getAll();
        return new Promise<OfflineQueueItem[]>((res: (items: OfflineQueueItem[]) => void, rej: (err: unknown) => void) => {
            req.onsuccess = () => res(req.result || []);
            req.onerror   = () => rej(req.error);
        });
    } catch { return []; }
};

window.__getOfflineQueueCount = async () => {
    const q = await window.__getOfflineQueue();
    return q.length;
};

window.__deleteOfflineItem = async (id: number | string) => {
    try {
        const db    = await openOfflineDB();
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        return new Promise<void>((res: () => void, rej: (err: unknown) => void) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    } catch (err) {
        console.error('[Offline] Failed to delete item:', err);
    }
};

// 🔒 FIX (تتبع "إضافة قضية" — 18 يوليو 2026): بنحفظ العنصر بالكامل تاني (مع
// retryCount محدَّث) بدل ما نسيبه زي ما هو في الـ IndexedDB — من غيرها،
// العداد كان هيفضل دايمًا 0/undefined وميقدرش نكتشف العناصر العالقة أبدًا.
window.__updateOfflineItem = async (item: OfflineQueueItem) => {
    try {
        const db    = await openOfflineDB();
        const tx    = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(item);
        return new Promise<void>((res: () => void, rej: (err: unknown) => void) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    } catch (err) {
        console.error('[Offline] Failed to update item:', err);
    }
};

// ══════════════════════════════════════════════════════════
//  حقول الـ sentinel المؤقتة (_offlineTempId، _offlineCaseTitle،
//  _offlineCaseTempId) مش أعمدة حقيقية في أي جدول — بيتم إنشاؤها من الكود
//  عشان تستخدم في الربط وقت المزامنة بس (شوف useCaseActions.ts). لازم
//  تتشال قبل أي INSERT حقيقي في القاعدة، أونلاين أو أوفلاين، وإلا Supabase
//  هيرفض العملية بخطأ "column does not exist".
// ══════════════════════════════════════════════════════════
function stripOfflineSentinels<T extends Record<string, unknown> | undefined>(data: T): T {
    if (!data) return data;
    const cleaned: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
        if (!key.startsWith('_offline')) cleaned[key] = (data as Record<string, unknown>)[key];
    }
    return cleaned as T;
}

// ══════════════════════════════════════════════════════════
//  🆕 المرحلة 1 (خطة توسيع نظام الأوفلاين) — آلية تمبيد عامة (FK Temp ID)
//  ═══════════════════════════════════════════════════════════
//  الفرق عن `_offlineCaseTempId`/`_offlineCaseTitle` القديمة (لسه شغالة
//  زي ما هي فوق، من غير أي تعديل — الآلية دي إضافية جنبها، مش بديلة عنها):
//  القديمة مبنية خصيصًا لحالة واحدة (جلسة بتستنى قضية، وحقل `case_id` بس).
//  الجديدة عامة: أي عملية (INSERT أو UPDATE) على أي جدول من DbWriteTable
//  ممكن "تشاور" على أي حقل FK بيشاور على سجل لسه في الطابور (مش بس
//  case_id، ومش بس جدول cases).
//
//  الشكل: `_offlineFkTempId` بيتحط جوه `data` (زي أي sentinel تاني في
//  الملف ده) كمصفوفة من المراجع دي، مرجع واحد لكل حقل FK محتاج حل.
export interface OfflineFkTempIdRef {
    /** اسم العمود الحقيقي في الجدول المستهدف (مثلاً 'case_id', 'client_id') */
    field: string;
    /** المعرّف المؤقت (`_offlineTempId`) بتاع السجل المُشار إليه */
    tempId: string;
    /** الجدول اللي السجل المُشار إليه هيتحط فيه */
    table: DbWriteTable;
    /**
     * قيمة احتياطية (اسم/عنوان) تُستخدم للـ fallback النادر لما التمبيد
     * يختفي من الذاكرة (تشغيلة جديدة عدّت قبل ما يتزامن السجل المرجعي).
     * زي `_offlineCaseTitle` القديمة بس هنا عامة لأي جدول مدعوم.
     */
    fallbackNameValue?: string;
}

// العمود المستخدم في البحث الاحتياطي بالاسم لكل جدول مدعوم — نفس فكرة
// البحث بـ `title` في القضايا القديم، بس معمم. الجداول اللي مش هنا (زي
// case_sessions) مفيهاش معنى لبحث بالاسم أصلاً (مفيش عمود "اسم" فريد
// منطقي للبحث عنه)، فبتفضل تعتمد على تطابق التمبيد في نفس التشغيلة بس.
const FK_FALLBACK_NAME_COLUMN: Partial<Record<DbWriteTable, string>> = {
    cases: 'title',
    clients: 'full_name',
};

// مُصدَّرة (exported) عشان تتغطى باختبارات وحدة مباشرة (`dbClient` بيتحقن
// كباراميتر بدل import مباشر لـ db، بنفس نمط `safeUpdate` في dataAccess.ts)
// من غير الحاجة لمحاكاة IndexedDB كاملة.
//
// بترجع:
//  - `shouldRetry: true` لو فيه مرجع واحد على الأقل لسه مش قابل للحل
//    (لا في tempIdToRealId ولا fallback بالاسم نجح)، سواء كان لسه في
//    الطابور نفسه أو اختفى تمامًا — في الحالتين، الاستدعاء الحالي (Caller)
//    المفروض يعمل bumpRetry ويستنى الدورة الجاية، بنفس منطق INSERT
//    القديم بالظبط.
//  - `data` مُحدَّثة (الحقول اتستبدلت بالـ id الحقيقي) لو كل المراجع اتحلت.
export async function resolveOfflineFkRefs(
    dbClient: typeof db,
    op: OfflineQueueItem,
    tempIdToRealId: Map<string, string>,
    queue: OfflineQueueItem[],
): Promise<{ data: Record<string, unknown>; shouldRetry: boolean }> {
    const refs = (op.data?._offlineFkTempId as OfflineFkTempIdRef[] | undefined) || [];
    if (!refs || refs.length === 0) {
        return { data: op.data || {}, shouldRetry: false };
    }
    const updated: Record<string, unknown> = { ...op.data };
    for (const ref of refs) {
        // (أ) اتحل فعلاً في نفس دورة المزامنة دي
        if (tempIdToRealId.has(ref.tempId)) {
            updated[ref.field] = tempIdToRealId.get(ref.tempId);
            continue;
        }
        // (ب) لسه معلّق في الطابور نفسه — نستنى الدورة الجاية (مفيش داعي
        // نحاول fallback بالاسم أصلاً هنا، لأن السجل المرجعي هيتزامن قريب)
        const stillQueued = queue.some(
            (q) => q.table === ref.table && (q.data as Record<string, unknown> | undefined)?._offlineTempId === ref.tempId
        );
        if (stillQueued) {
            return { data: op.data || {}, shouldRetry: true };
        }
        // (ج) fallback بالاسم — الحالة النادرة (تشغيلة جديدة، التمبيد مش
        // موجود في الذاكرة ولا في الطابور، يبقى غالبًا اتزامن قبل كده)
        const nameColumn = FK_FALLBACK_NAME_COLUMN[ref.table];
        let resolvedByName = false;
        if (nameColumn && ref.fallbackNameValue) {
            // ⚠️ نفس الكاست الموثّق فوق تعريف dbFrom() بالظبط (ref.table هنا
            // Generic من نوع DbWriteTable مش literal ثابت — من غير الكاست ده
            // TypeScript بيحاول يحل النوع على مستوى الـ schema كله فبيرجّع
            // أخطاء بناء ضخمة، مش لأن اسم الجدول غلط فعليًا وقت التشغيل).
            // ⚠️ كاست إضافي هنا (`as any` موثّق ومقصود، بنفس اتفاقية
            // `db.from(table as any)` المقبولة فعليًا في 6 مواضع تانية بالمشروع
            // — راجع ملاحظات Phase 4.5 لتنظيف `any`): عمود البحث (`nameColumn`)
            // بيتحدد ديناميكيًا من FK_FALLBACK_NAME_COLUMN حسب الجدول (مش
            // literal ثابت زي 'title' القديمة)، فـ TypeScript مستحيل يتحقق منه
            // وقت الكتابة مهما كان الكاست على اسم الجدول نفسه. التحقق الحقيقي
            // من صحة اسم العمود بيحصل وقت التشغيل فعليًا (Supabase هيرجّع خطأ
            // واضح لو العمود مش موجود)، وده مغطى بمعالجة الأخطاء العادية في
            // دورة المزامنة (catch + bumpRetry).
            const { data: row } = await (dbClient.from(ref.table as 'cases') as unknown as {
                select: (col: string) => {
                    eq: (col: string, val: string) => {
                        order: (col: string, opts: { ascending: boolean }) => {
                            limit: (n: number) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }> };
                        };
                    };
                };
            })
                .select('id')
                .eq(nameColumn, ref.fallbackNameValue)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
            if (row?.id) {
                updated[ref.field] = row.id;
                resolvedByName = true;
            }
        }
        if (!resolvedByName) {
            // مفيش حل — لا تمبيد في الذاكرة، لا في الطابور، لا fallback نجح
            return { data: op.data || {}, shouldRetry: true };
        }
    }
    delete updated._offlineFkTempId;
    return { data: updated, shouldRetry: false };
}

// ══════════════════════════════════════════════════════════
//  🆕 المرحلة 3-1 (خطة توسيع نظام الأوفلاين) — تمبيد id السجل نفسه
//  ═══════════════════════════════════════════════════════════
//  🔎 اكتشاف معماري أثناء تنفيذ 3-1: `_offlineFkTempId` فوق بيحل مراجع FK
//  *جوه* `data` بس (مثال: case_sessions.case_id بيشاور على قضية لسه
//  تمبيد). لكن في `handleLinkExistingClient` (useClientLinking.ts /
//  useSessionLinking.ts)، العملية هي UPDATE على جدول `cases` بمعرّف
//  `createdCaseId` اللي ممكن يبقى هو نفسه لسه تمبيد (لو القضية اتقيدت
//  أوفلاين في `handleLinkCase` قبلها ولسه ما اتزامنتش) — يعني هنا الـ id
//  بتاع *السطر نفسه المستهدف بالـ UPDATE* هو التمبيد، مش قيمة حقل جوه
//  `data`. مفيش أي آلية قديمة بتحل `op.id` نفسه — دورة المزامنة كانت
//  بتعمل `.eq('id', op.id as string)` مباشرة من غير أي فحص، فلو `op.id`
//  فضل تمبيد (نص زي 'tmp-...') كان الـ UPDATE هيتنفذ فعليًا ضد Supabase من
//  غير ما يطابق أي صف حقيقي — Supabase بيرجّع نجاح صامت (صفر صفوف
//  متأثرة، من غير error) في الحالة دي، يعني المستخدم كان هيشوف "✅ تم
//  الربط" رغم إن الربط ما حصلش خالص. الدالة دي بتسد الفجوة دي بنفس منطق
//  `resolveOfflineFkRefs` بالظبط (تمبيد اتحل في نفس الدورة → لسه في
//  الطابور → fallback بالاسم) بس مطبّقة على `op.id` نفسه بدل حقل جوه
//  `data`.
//
//  الشكل: بدل sentinel من نوع مصفوفة (زي `_offlineFkTempId`)، هنا مرجع
//  واحد بس ممكن يتحط (السجل نفسه له id واحد بس، مش عدة حقول FK):
//  `data._offlineSelfTempId: string` (نفس التمبيد اللي اتحط في `id`
//  الأصلي وقت النداء) + `data._offlineSelfFallbackName?: string`
//  اختياري للـ fallback بالاسم.
export async function resolveOfflineSelfId(
    dbClient: typeof db,
    op: OfflineQueueItem,
    tempIdToRealId: Map<string, string>,
    queue: OfflineQueueItem[],
): Promise<{ realId: string | null; shouldRetry: boolean }> {
    const tempId = op.data?._offlineSelfTempId as string | undefined;
    if (!tempId) {
        // مفيش sentinel — الـ id الأصلي حقيقي بالفعل من الأول (الحالة
        // العادية لكل عمليات UPDATE اللي كانت شغالة قبل 3-1).
        return { realId: op.id as string, shouldRetry: false };
    }
    // (أ) اتحل فعلاً في نفس دورة المزامنة دي
    if (tempIdToRealId.has(tempId)) {
        return { realId: tempIdToRealId.get(tempId) as string, shouldRetry: false };
    }
    // (ب) لسه معلّق في الطابور نفسه (عملية INSERT القضية لسه ما اتعالجتش
    // أو فشلت) — نستنى الدورة الجاية، بنفس منطق resolveOfflineFkRefs
    const stillQueued = queue.some(
        (q) => q.table === op.table && (q.data as Record<string, unknown> | undefined)?._offlineTempId === tempId
    );
    if (stillQueued) {
        return { realId: null, shouldRetry: true };
    }
    // (جـ) fallback بالاسم — الحالة النادرة (السجل الأصلي اتزامن في
    // تشغيلة سابقة ومعندناش التمبيد في الذاكرة)
    const nameColumn = FK_FALLBACK_NAME_COLUMN[op.table];
    const fallbackNameValue = op.data?._offlineSelfFallbackName as string | undefined;
    if (nameColumn && fallbackNameValue) {
        const { data: row } = await (dbClient.from(op.table as 'cases') as unknown as {
            select: (col: string) => {
                eq: (col: string, val: string) => {
                    order: (col: string, opts: { ascending: boolean }) => {
                        limit: (n: number) => { maybeSingle: () => Promise<{ data: { id: string } | null; error: unknown }> };
                    };
                };
            };
        })
            .select('id')
            .eq(nameColumn, fallbackNameValue)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (row?.id) return { realId: row.id, shouldRetry: false };
    }
    // مفيش حل — لا تمبيد في الذاكرة، لا في الطابور، لا fallback نجح
    return { realId: null, shouldRetry: true };
}

// ══════════════════════════════════════════════════════════
//  Offline Sync Queue — DB Write Wrapper
// ══════════════════════════════════════════════════════════
let __syncQueueRunning = false;
window.__syncOfflineQueue = async function() {
    // BUG FIX: القفل ده كان موجود فقط في __runOfflineSyncIfNeeded، لكن
    // Service Worker بينده على __syncOfflineQueue مباشرة عند Background Sync
    // (في serviceWorkerBootstrap.ts)، فكان ممكن العمليتين تتنفذوا في نفس
    // الوقت وتعمل INSERT مكرر لنفس القضية. دلوقتي القفل بقى جوه الدالة
    // نفسها فيغطي كل المصادر.
    if (__syncQueueRunning) return;
    __syncQueueRunning = true;
    try {
    const queue = await window.__getOfflineQueue?.() || [];
    if (queue.length === 0) return;
    showSyncIndicator(`جاري مزامنة ${queue.length} عملية...`);
    let successCount = 0, failCount = 0;
    // 🔒 FIX (تتبع زر "إضافة قضية" — 18 يوليو 2026): خريطة tempId → id حقيقي،
    // بتتبني أثناء التشغيلة دي بس. كانت الجلسة الأولى لقضية أوفلاين بتتربط
    // بالقضية عن طريق البحث بالعنوان فقط (.eq('title', ...).order(created_at
    // desc).limit(1)) — لو فيه قضيتين اتضافوا أوفلاين بنفس العنوان بالظبط،
    // كان ممكن الجلسة تتربط بالقضية الغلط بصمت. دلوقتي المطابقة الأساسية
    // بقت بالمعرّف المؤقت (فريد لكل عملية إضافة، صفر احتمال تصادم)، والبحث
    // بالعنوان بقى fallback بس للحالة النادرة إن القضية اتزامنت في تشغيلة
    // سابقة قبل ما تتزامن الجلسة (التطابق بالـ tempId ميبقاش متاح وقتها لأن
    // الخريطة دي محلية للتشغيلة الحالية فقط).
    const tempIdToRealId = new Map<string, string>();
    // 🆕 المرحلة 4 (خطة توسيع نظام الأوفلاين): مجموعتين محليتين للتشغيلة دي
    // بس، عشان نعرف بعد الحلقة كلها لأي قضية لازم نعيد حساب next_hearing.
    // `syncedCaseIds`: القضايا اللي اتزامنت (INSERT ناجح) في نفس الدورة دي
    // بالظبط — مش القضايا الموجودة أصلاً من قبل (دول next_hearing بتاعهم
    // محسوب صح فعلاً من مسارات تانية، مش محتاجين إعادة حساب هنا).
    // `casesLinkedThisCycle`: القضايا اللي معاها تحديث case_sessions.case_id
    // اتزامن بنجاح في نفس الدورة — التقاطع بين المجموعتين هو بالظبط سيناريو
    // handleLinkCase (قضية + ربط جلستها الأولى، الاتنين أوفلاين مع بعض)،
    // اللي next_hearing بتاعه كان بيفضل فاضي بعد المزامنة قبل الفيكس ده.
    const syncedCaseIds = new Set<string>();
    const casesLinkedThisCycle = new Set<string>();
    // 🆕 المرحلة 6.5: قضايا (حقيقية بالفعل، مش تمبيد) محتاجة إعادة حساب
    // next_hearing بعد المزامنة بسبب عملية case_sessions (INSERT/UPDATE/
    // DELETE) اتزامنت بنجاح من useCaseSessions.ts — بعكس casesLinkedThisCycle
    // فوق اللي مقصورة على تقاطعها مع syncedCaseIds (سيناريو قضية جديدة
    // بالكامل أوفلاين)، هنا القضية موجودة أصلاً من قبل الدورة دي، فالتحديث
    // مطلوب دايمًا (بلا شرط تقاطع) لأي case_id اتجمّع هنا.
    const caseSessionCaseIdsToRecalc = new Set<string>();
    // 🔒 FIX (تتبع "إضافة قضية" — 18 يوليو 2026): سقف محاولات — عنصر فشل
    // ~15 مرة متتالية (يعني قريب من ربع ساعة بمعدل محاولة كل دقيقة، غير
    // محاولات أحداث 'online'/'load' الإضافية) بيتحسب "عالق" ويتجمع في
    // stuckItems عشان نطلع تنبيه واحد واضح للمستخدم بدل ما يفضل يحاول
    // للأبد بصمت من غير ما حد ياخد باله.
    const RETRY_ALERT_THRESHOLD = 15;
    const stuckItems: OfflineQueueItem[] = [];
    async function bumpRetry(item: OfflineQueueItem) {
        const updated: OfflineQueueItem = { ...item, retryCount: (item.retryCount || 0) + 1 };
        await window.__updateOfflineItem?.(updated);
        if (updated.retryCount === RETRY_ALERT_THRESHOLD) stuckItems.push(updated);
    }
    for (const op of queue) {
        try {
            let error = null;
            let conflict = false;
            // 🆕 المرحلة 4: هيتحدد جوه فرع UPDATE تحت لو العملية دي بتربط
            // جلسة بقضية (case_sessions.case_id) — شوف linksCaseSession
            // واستخدامها في فرع النجاح تحت.
            let linkedCaseIdForRecalc: string | null = null;
            // 🆕 المرحلة 6.5: هيتحدد جوه فرع UPDATE (تعديل جلسة من صفحة
            // تفاصيل القضية) — لازم يتصرّح هنا (مش جوه الفرع نفسه) عشان
            // يفضل متاح لفرع النجاح تحت بعد ما الـ if/else-if كله يخلص.
            let sessionCaseIdForRecalc: string | null = null;

            if (op.type === 'INSERT') {
                // البيانات هنا Record<string, unknown> عام (زي useAdminBackup.ts) —
                // كاست ضيق مربوط باسم الجدول الحقيقي المتحقق منه فعلاً (op.table
                // بقى DbWriteTable مش string)، بنفس نمط __dbWrite تحت بالظبط.
                // BUG-20 FIX: جلسة مرتبطة بقضية أوفلاين — نجيب الـ id الحقيقي أولاً
                if (op.table === 'case_sessions' && (op.data?._offlineCaseTempId || op.data?._offlineCaseTitle)) {
                    const tempId = op.data?._offlineCaseTempId as string | undefined;
                    let realCaseId: string | null = null;

                    if (tempId && tempIdToRealId.has(tempId)) {
                        // القضية اتزامنت فعلاً جوه التشغيلة دي — مطابقة دقيقة
                        realCaseId = tempIdToRealId.get(tempId) || null;
                    } else if (tempId && queue.some((q) => q.table === 'cases' && (q.data as Record<string, unknown> | undefined)?._offlineTempId === tempId)) {
                        // القضية بتاعتها لسه في الطابور (متعالجتش أو فشلت النهاردة) — نستنى الدور الجاي
                        await bumpRetry(op);
                        failCount++;
                        continue;
                    } else if (op.data?._offlineCaseTitle) {
                        // Fallback: القضية غالبًا اتزامنت في تشغيلة سابقة ومعندناش tempId مطابق —
                        // نرجع للبحث بالعنوان كحل احتياطي أخير
                        const { data: caseRow } = await db
                            .from('cases')
                            .select('id')
                            .eq('title', op.data._offlineCaseTitle as string)
                            .order('created_at', { ascending: false })
                            .limit(1)
                            .maybeSingle();
                        realCaseId = caseRow?.id || null;
                    }

                    if (!realCaseId) {
                        // القضية لسه مش اتزامنت أصلاً — نفضل في الـ queue ونكمل
                        await bumpRetry(op);
                        failCount++;
                        continue;
                    }
                    op.data = { ...op.data, case_id: realCaseId };
                    delete op.data._offlineCaseTempId;
                    delete op.data._offlineCaseTitle;
                }
                // 🆕 المرحلة 1: حل مراجع FK العامة (_offlineFkTempId) لو موجودة —
                // بيشتغل جنب الآلية القديمة (_offlineCaseTempId) فوق من غير ما
                // يعارضها؛ الاتنين ممكن يتواجدوا في نفس العملية نظريًا (مش
                // متوقع فعليًا حاليًا لحد ما المرحلة 2 تتنفذ) من غير تعارض لأنهم
                // بيشتغلوا على حقول مختلفة.
                if (op.data?._offlineFkTempId) {
                    const resolved = await resolveOfflineFkRefs(db, op, tempIdToRealId, queue);
                    if (resolved.shouldRetry) {
                        await bumpRetry(op);
                        failCount++;
                        continue;
                    }
                    op.data = resolved.data;
                }
                const insertData = stripOfflineSentinels(op.data);
                // 🆕 المرحلة 1: كان مقصور على `op.table === 'cases'` بس — دلوقتي
                // معمم لأي جدول، عشان أي INSERT (قضية أو عميل) يقدر يسجّل
                // تمبيده في نفس الـ Map المشتركة (tempIdToRealId) ويتستخدم في
                // حل مراجع FK لعمليات تانية بعده في نفس الدورة (شوف
                // resolveOfflineFkRefs فوق). صفر تغيير سلوك للقضايا الموجودة.
                if (op.data?._offlineTempId) {
                    const res = await db.from(op.table).insert([insertData as Database['public']['Tables'][typeof op.table]['Insert']]).select('id').single();
                    error = res.error;
                    if (!error && res.data) {
                        const newId = (res.data as { id: string }).id;
                        tempIdToRealId.set(op.data._offlineTempId as string, newId);
                        // 🆕 المرحلة 4: نسجّل القضايا الجديدة اللي اتزامنت في نفس
                        // الدورة دي فقط — شوف تعريف syncedCaseIds فوق.
                        if (op.table === 'cases') syncedCaseIds.add(newId);
                    }
                } else {
                    ({ error } = await db.from(op.table).insert([insertData as Database['public']['Tables'][typeof op.table]['Insert']]));
                    // 🆕 المرحلة 6.5: إضافة جلسة من صفحة تفاصيل القضية مباشرة
                    // (useCaseSessions.ts) — case_id هنا حقيقي دايمًا (مفيش
                    // _offlineTempId ولا _offlineFkTempId في العملية دي أصلاً)،
                    // موجود كعمود حقيقي في insertData نفسها، فمش محتاجين
                    // sentinel منفصل للـ INSERT (بعكس UPDATE/DELETE تحت).
                    if (!error && op.table === 'case_sessions' && insertData?.case_id) {
                        caseSessionCaseIdsToRecalc.add(insertData.case_id as string);
                    }
                }
            } else if (op.type === 'UPDATE') {
                // 🆕 المرحلة 3-1: لازم نحل تمبيد id السطر نفسه (لو موجود) قبل أي
                // حاجة تانية — لو لسه معلّق أو مش قابل للحل، منعملش أي محاولة
                // update أصلاً (بعكس _offlineFkTempId اللي بيحل حقول *جوه*
                // data، مش هوية السطر المستهدف نفسه).
                let resolvedOpId = op.id as string;
                // 🆕 المرحلة 6.5: sentinel `_offlineSessionCaseId` من
                // useCaseSessions.ts (تعديل جلسة من صفحة تفاصيل القضية
                // مباشرة) — case_id حقيقي دايمًا هنا (مش تمبيد)، بنلقطه هنا
                // قبل أي strip عشان نعرف نعيد حساب next_hearing بعد نجاح
                // الـ UPDATE تحت (شوف caseSessionCaseIdsToRecalc).
                sessionCaseIdForRecalc = op.table === 'case_sessions'
                    ? (op.data?._offlineSessionCaseId as string | undefined) || null
                    : null;
                if (op.data?._offlineSelfTempId) {
                    const selfResolved = await resolveOfflineSelfId(db, op, tempIdToRealId, queue);
                    if (selfResolved.shouldRetry || !selfResolved.realId) {
                        await bumpRetry(op);
                        failCount++;
                        continue;
                    }
                    resolvedOpId = selfResolved.realId;
                }
                // 🆕 المرحلة 1: حل مراجع FK العامة (_offlineFkTempId) لو موجودة —
                // نفس منطق فرع INSERT فوق بالظبط، بس هنا للـ UPDATE (مثال:
                // ربط جلسة حقيقية بقضية لسه في الطابور — case_id تمبيد).
                // 🆕 المرحلة 4: قبل ما نحل المراجع (resolveOfflineFkRefs بتشيل
                // _offlineFkTempId من op.data بعد الحل)، بنسجّل هل العملية دي
                // أصلاً بتربط جلسة بقضية (case_sessions.case_id) — لو آه، بعد
                // نجاح الـ UPDATE فعليًا تحت، هنضيف الـ case_id المُحل
                // (الحقيقي) لـ casesLinkedThisCycle عشان نعرف نعيد حساب
                // next_hearing بعد الحلقة كلها لو القضية دي نفسها اتزامنت
                // (INSERT) في نفس الدورة (شوف syncedCaseIds فوق).
                const linksCaseSession = op.table === 'case_sessions'
                    && ((op.data?._offlineFkTempId as OfflineFkTempIdRef[] | undefined) || []).some((r) => r.field === 'case_id' && r.table === 'cases');
                if (op.data?._offlineFkTempId) {
                    const resolved = await resolveOfflineFkRefs(db, op, tempIdToRealId, queue);
                    if (resolved.shouldRetry) {
                        await bumpRetry(op);
                        failCount++;
                        continue;
                    }
                    op.data = resolved.data;
                    // 🆕 المرحلة 4: بعد الحل، op.data.case_id بقى الـ id الحقيقي
                    // (لو اتحل من tempIdToRealId) — ده اللي محتاجينه لتسجيله
                    // في casesLinkedThisCycle بعد نجاح الـ UPDATE تحت.
                    if (linksCaseSession) linkedCaseIdForRecalc = (op.data?.case_id as string | undefined) || null;
                }
                // op.id هنا هي الـ id الحقيقي (string) بتاع السجل — مش الرقم
                // التلقائي بتاع IndexedDB (ده بس لعمليات INSERT، زي ما موثّق
                // فوق تعريف OfflineQueueItem). كاست `as string` بنفس منطق
                // `id as string` في __dbWrite تحت.
                // Optimistic Locking — نتحقق إن السجل مش اتعدل من حد تاني
                if (op.knownUpdatedAt) {
                    const { data: current, error: fetchErr } = await dbFrom(op.table)
                        .select('updated_at').eq('id', resolvedOpId).single();

                    if (!fetchErr && current && current.updated_at) {
                        const serverTime = new Date(current.updated_at).getTime();
                        const clientTime = new Date(op.knownUpdatedAt).getTime();
                        if (serverTime > clientTime) {
                            // تعارض — مش هنكتب فوق تعديل حد تاني
                            conflict = true;
                        }
                    }
                }
                if (!conflict) {
                    // 🆕 المرحلة 1: stripOfflineSentinels هنا احتياط — resolveOfflineFkRefs
                    // فوق بيشيل `_offlineFkTempId` بنفسه لما يحل كل المراجع، لكن
                    // بنستدعيها تاني هنا زي ما بيحصل مع INSERT، تحسبًا لأي sentinel
                    // تاني يتضاف مستقبلاً لعمليات UPDATE من غير ما ننسى نشيله هنا.
                    // 🆕 المرحلة 3-1: بنستخدم resolvedOpId (مش op.id الخام) —
                    // للعمليات العادية (مفيش _offlineSelfTempId) القيمتين
                    // متطابقتين دايمًا، صفر تغيير سلوك.
                    ({ error } = await db.from(op.table).update(stripOfflineSentinels(op.data) as Database['public']['Tables'][typeof op.table]['Update']).eq('id', resolvedOpId));
                }
            } else if (op.type === 'DELETE') {
                ({ error } = await db.from(op.table).delete().eq('id', op.id as string));
            }

            if (conflict) {
                // نحذف العملية من الـ Queue ونعدّ كـ conflict
                await window.__deleteOfflineItem(op.id);
                failCount++;
            } else if (!error) {
                await window.__deleteOfflineItem(op.id);
                successCount++;
                // 🔒 FIX (تتبع "إضافة قضية" — 18 يوليو 2026): قضية اتضافت وإنت
                // أوفلاين ماكانتش بتتسجل في "سجل النشاط" خالص — لا وقت الإضافة
                // (لسه معندهاش id حقيقي) ولا بعد كده وقت المزامنة (مفيش نداء
                // logActivity أصلاً في المسار ده). النتيجة: أي قضية اتضافت
                // أوفلاين كانت تختفي تمامًا من السجل. بنسجّلها هنا دلوقتي، بعد
                // نجاح الإدراج الحقيقي فعليًا، بنفس شكل نشاط "إضافة قضية" اللي
                // بيتسجل في المسار الأونلاين.
                if (op.type === 'INSERT' && op.table === 'cases') {
                    const newId = tempIdToRealId.get(op.data?._offlineTempId as string) || null;
                    const title = (op.data?.title as string) || null;
                    const caseType = (op.data?.case_type as string) || null;
                    logActivity(db, 'إضافة قضية', {
                        entity_type: 'case',
                        entity_id: newId,
                        details: title ? `${title} (أُضيفت أوفلاين)` : 'أُضيفت أوفلاين',
                        case_name: title,
                        case_type: caseType,
                    });
                }
                // 🆕 المرحلة 4: تسجيل ربط جلسة↔قضية ناجح في نفس الدورة —
                // شوف تعريف casesLinkedThisCycle فوق. بيتحقق فعليًا بعد
                // الحلقة كلها (مش هنا) عشان نضمن إن القضية نفسها خلصت
                // مزامنة (ترتيب العمليات في الطابور مش مضمون قضية قبل
                // جلستها دايمًا لو فيه bumpRetry/إعادة محاولات).
                if (op.type === 'UPDATE' && linkedCaseIdForRecalc) {
                    casesLinkedThisCycle.add(linkedCaseIdForRecalc);
                }
                // 🆕 المرحلة 6.5: تعديل/حذف جلسة من صفحة تفاصيل القضية
                // مباشرة — القضية دي حقيقية وموجودة من قبل الدورة دي (مش
                // محتاجة تقاطع مع syncedCaseIds زي casesLinkedThisCycle فوق).
                if (op.type === 'UPDATE' && sessionCaseIdForRecalc) {
                    caseSessionCaseIdsToRecalc.add(sessionCaseIdForRecalc);
                } else if (op.type === 'DELETE' && op.table === 'case_sessions' && op.data?._offlineSessionCaseId) {
                    caseSessionCaseIdsToRecalc.add(op.data._offlineSessionCaseId as string);
                }
            } else {
                // BUG FIX: كان بيتجاهل تفاصيل الخطأ تمامًا، فمستحيل تعرف ليه
                // عملية معينة فاضلة عالقة في الـ queue ومش بتتزامن أبدًا
                // (مثلاً قيمة مفقودة مطلوبة، أو RLS بترفض الإدراج).
                console.error('[Offline Sync] فشلت عملية', op.type, op.table, '—', error?.message || error);
                await bumpRetry(op);
                failCount++;
            }
        } catch (err) {
            console.error('[Offline Sync] استثناء غير متوقع في عملية', op.type, op.table, '—', err);
            await bumpRetry(op);
            failCount++;
        }
    }
    // ══════════════════════════════════════════════════════════
    //  🆕 المرحلة 4 (خطة توسيع نظام الأوفلاين) — إعادة حساب next_hearing
    //  بعد المزامنة، لأي قضية اتزامنت (INSERT) في نفس الدورة *و* كان معاها
    //  تحديث جلسة (case_id) اتزامن بنجاح في نفس الدورة (التقاطع بين
    //  syncedCaseIds وcasesLinkedThisCycle). قبل الفيكس ده، next_hearing
    //  كان بيفضل فاضي دايمًا للقضايا اللي اتعملت من "تحويل جلسة مستقلة
    //  لقضية" وهي أوفلاين بالكامل (handleLinkCase في
    //  useClientLinking.ts/useSessionLinking.ts) — لأن recalcNextHearing
    //  فيه select على case_sessions لازم يتنفذ بعد وجود القضية فعليًا في
    //  القاعدة (مستحيل يتحول لعملية طابور عادية زي باقي العمليات، نفس
    //  التوثيق في هدف المرحلة دي بالخطة الأصلية). أونلاين، الاستدعاء
    //  المباشر في useClientLinking.ts/useSessionLinking.ts فضل زي ما هو
    //  بالظبط (صفر تغيير هناك) — هنا بس بيغطي المسار الأوفلاين.
    //  كل استدعاء معزول بـ try/catch مستقل: فشل إعادة حساب next_hearing
    //  لقضية واحدة (مثلاً مشكلة شبكة عابرة) لازم ميأثرش على تقرير نجاح/فشل
    //  باقي عمليات المزامنة اللي خلصت فعلاً قبل النقطة دي.
    // ══════════════════════════════════════════════════════════
    for (const caseId of casesLinkedThisCycle) {
        if (!syncedCaseIds.has(caseId)) continue;
        try {
            await recalcNextHearing(db, caseId);
        } catch (err) {
            console.error('[Offline Sync] فشل إعادة حساب next_hearing بعد المزامنة للقضية', caseId, '—', err);
        }
    }
    // 🆕 المرحلة 6.5: نفس فكرة الحلقة فوق، لكن لجلسات اتضافت/اتعدّلت/اتحذفت
    // من صفحة تفاصيل القضية مباشرة (useCaseSessions.ts) وإحنا أوفلاين.
    // بعكس الحلقة فوق، هنا مفيش شرط تقاطع مع syncedCaseIds — القضية دايمًا
    // كانت موجودة وحقيقية من قبل الدورة دي أصلاً (مش قضية جديدة بالكامل
    // اتزامنت في نفس الوقت)، فالتحديث مطلوب لكل عنصر جُمع هنا بلا استثناء.
    for (const caseId of caseSessionCaseIdsToRecalc) {
        try {
            await recalcNextHearing(db, caseId);
        } catch (err) {
            console.error('[Offline Sync] فشل إعادة حساب next_hearing بعد مزامنة جلسة للقضية', caseId, '—', err);
        }
    }
    if (successCount > 0 && failCount === 0) {
        hideSyncIndicator(`✅ تمت المزامنة — ${successCount} عملية`);
        toast(`✅ تمت المزامنة (${successCount} عملية)`);
    } else if (failCount > 0) {
        hideSyncIndicator(`⚠️ تمت جزئياً (${successCount}/${successCount + failCount})`);
    } else { hideSyncIndicator(); }
    // 🔒 FIX (تتبع "إضافة قضية" — 18 يوليو 2026): تنبيه واحد واضح (مش تكرار
    // كل دقيقة) أول ما عنصر يعدّي سقف المحاولات — بدل ما يفضل يحاول للأبد
    // بصمت من غير ما حد ياخد باله إنه محتاج تدخل يدوي (مثلاً بيانات ناقصة،
    // أو قضية مرتبطة فشلت تتزامن نهائيًا).
    if (stuckItems.length > 0) {
        toast(`⚠️ فيه ${stuckItems.length} عملية عالقة من فترة طويلة ومش بتتزامن — راجع اتصالك بالإنترنت، ولو المشكلة استمرت تواصل مع الدعم`, true);
        console.error('[Offline Sync] عناصر عالقة تجاوزت سقف المحاولات:', stuckItems);
    }
    window.dispatchEvent(new CustomEvent('offline-sync-complete'));
    } finally {
        __syncQueueRunning = false;
    }
};

// ══════════════════════════════════════════════════════════
//  المزامنة الفعلية — الاعتماد الأساسي (يشتغل في كل المتصفحات)
//  Background Sync فوق (لو الجهاز بيدعمها) ميغطّيش Safari/iOS أبدًا،
//  فمحتاجين آلية تشتغل أونلاين مباشرة كل وقت ما التطبيق مفتوح.
// ══════════════════════════════════════════════════════════
let __syncInFlight = false;
async function __runOfflineSyncIfNeeded() {
    if (__syncInFlight) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    try {
        const count = await window.__getOfflineQueueCount?.() || 0;
        if (count === 0) return;
        __syncInFlight = true;
        await window.__syncOfflineQueue?.();
    } catch (err) {
        console.error('[Offline] Sync attempt failed:', err);
    } finally {
        __syncInFlight = false;
    }
}

// 1) أول ما ترجع أونلاين — جرّب تزامن فورًا
window.addEventListener('online', () => { __runOfflineSyncIfNeeded(); });

// 2) أول ما يفتح التطبيق (لو كانت فيه عمليات معلّقة من قبل ما يتقفل المتصفح) وإنت أصلاً أونلاين
window.addEventListener('load', () => { __runOfflineSyncIfNeeded(); });

// 3) شبكة أمان إضافية — فحص دوري كل دقيقة لو فيه عمليات معلّقة ومتصل بالنت
//    (يغطي حالات نادرة زي رجوع النت من غير ما يطلق حدث 'online' بشكل موثوق)
setInterval(() => { __runOfflineSyncIfNeeded(); }, 60000);

window.__dbWrite = async function <T extends DbWriteTable>({ type, table, data, id, knownUpdatedAt, returning }: {
    type: 'INSERT' | 'UPDATE' | 'DELETE';
    table: T;
    data?: Record<string, unknown>;
    id?: string;
    knownUpdatedAt?: string | null;
    returning?: boolean;
}) {
    // 🆕 المرحلة 3-1: لو العملية معاها `_offlineSelfTempId` (يعني الـ id
    // المستهدف بالـ UPDATE هو نفسه لسه تمبيد — مثال: `handleLinkExistingClient`
    // بيحاول يربط موكل بقضية اتعملت في `handleLinkCase` قبلها وهي أوفلاين)،
    // لازم نقيّد العملية في الطابور دايمًا حتى لو `navigator.onLine === true`
    // فعليًا دلوقتي. السبب: القضية نفسها ممكن تكون لسه معلّقة في الطابور
    // (رجع النت بس دورة المزامنة التلقائية لسه ما اشتغلتش)، فلو حاولنا
    // نبعت UPDATE مباشر أونلاين بـ `.eq('id', tempId)`، Supabase هيرجّع
    // نجاح صامت (صفر صفوف متأثرة، من غير error) لأن مفيش صف حقيقي بالـ id
    // ده — يعني المستخدم هيشوف "تم الربط" رغم إن الربط ما حصلش خالص. القيد
    // الإجباري هنا بيضمن إن العملية تتحل صح وقت المزامنة (نفس الدورة أو
    // اللي بعدها) عن طريق resolveOfflineSelfId فوق.
    const forceQueueForSelfTempId = type === 'UPDATE' && !!data?._offlineSelfTempId;
    if (navigator.onLine && !forceQueueForSelfTempId) {
        try {
            let error = null;
            let insertedRow: Partial<Database['public']['Tables'][T]['Row']> | null = null;
            let updatedRow: Partial<Database['public']['Tables'][T]['Row']> | null = null;
            if (type === 'INSERT') {
                // 🔒 FIX: `data` ممكن يحمل حقول sentinel مؤقتة (_offlineTempId...)
                // متبعتة دايمًا من useCaseActions.ts بغض النظر عن أونلاين/أوفلاين
                // (عشان لو الاتصال قطع فجأة أثناء المحاولة، يبقى معاها بيانات
                // كافية للربط وقت المزامنة اللاحقة). مش أعمدة حقيقية، فلازم
                // تتشال هنا قبل أي INSERT حقيقي أونلاين وإلا Supabase هيرفض
                // العملية بخطأ "column does not exist".
                const cleanData = stripOfflineSentinels(data);
                if (returning) {
                    // بنرجّع الصف المُدرج فعليًا (بدل ما نسيب الكولر يخمّن الـ id
                    // بإعادة استعلام بالعنوان/التاريخ — ده كان بيسبب ربط غلط
                    // في حالات نادرة زي إدخال قضيتين بنفس العنوان في نفس اللحظة)
                    const res = await dbFrom(table).insert([cleanData as Database['public']['Tables']['cases']['Insert']]).select().single();
                    error = res.error;
                    insertedRow = res.data as unknown as Partial<Database['public']['Tables'][T]['Row']> | null;
                } else {
                    ({ error } = await dbFrom(table).insert([cleanData as Database['public']['Tables']['cases']['Insert']]));
                }
            } else if (type === 'UPDATE') {
                // Optimistic Locking — online
                if (knownUpdatedAt) {
                    const { data: current, error: fetchErr } = await dbFrom(table).select('updated_at').eq('id', id as string).single();

                    if (!fetchErr && current && current.updated_at) {
                        const serverTime = new Date(current.updated_at).getTime();
                        const clientTime = new Date(knownUpdatedAt).getTime();
                        if (serverTime > clientTime) {
                            return { error: { message: 'conflict' }, conflict: true, offline: false };
                        }
                    }
                }
                // FIX: بنرجّع updated_at الجديد بعد التحديث (بدل ما نسيب الكولر
                // فاكر updated_at القديم اللي جابها هو). من غير ده، أي تعديل
                // تاني على نفس السجل بعد التعديل الأول مباشرة كان هيتكشف غلط
                // كـ"تعارض" مع نفسه (لأن آخر updated_at محفوظة عنده محليًا
                // هتفضل أقدم من اللي فعليًا في السيرفر بعد أول تعديل ناجح).
                // 🆕 المرحلة 1: بنشيل أي حقل sentinel (_offline...) قبل الإرسال
                // الفعلي هنا — كانت من غير تنظيف قبل كده (بعكس مسار INSERT فوق
                // اللي عنده stripOfflineSentinels من الأول). ما كانش ده بيسبب
                // مشكلة فعلية لحد دلوقتي لأن مفيش caller بيبعت sentinel مع
                // UPDATE وهو أونلاين، لكن مع _offlineFkTempId الجديدة (المفروض
                // تتبعت بغض النظر عن حالة الاتصال، زي _offlineCaseTempId)، لازم
                // تتشال هنا كمان وإلا Supabase هيرفض العملية.
                const cleanUpdateData = stripOfflineSentinels(data);
                const res = await dbFrom(table).update(cleanUpdateData as Database['public']['Tables']['cases']['Update']).eq('id', id as string).select('updated_at').single();
                error = res.error;
                updatedRow = res.data as unknown as Partial<Database['public']['Tables'][T]['Row']> | null;
            } else if (type === 'DELETE') {
                ({ error } = await dbFrom(table).delete().eq('id', id as string));
            }
            return { error, offline: false, data: insertedRow || updatedRow };
        } catch {
            // الشبكة بتقول أونلاين بس الطلب فشل فعليًا — نحاول نحفظ محليًا
            const saved = await window.__offlineEnqueue({ type, table, data, id, knownUpdatedAt });
            if (!saved) {
                // BUG FIX: قبل كان بيرجع queued:true دايمًا حتى لو فشل الحفظ في
                // IndexedDB، فالمستخدم يشوف "محفوظة محلياً" والبيانات ضايعة فعليًا.
                return { error: { message: 'فشل الاتصال بالسيرفر، وفشل الحفظ المحلي أيضاً — يرجى المحاولة مرة أخرى' }, offline: true, queued: false };
            }
            return { error: null, offline: true, queued: true };
        }
    } else {
        // نحفظ knownUpdatedAt في الـ Queue عشان نستخدمه وقت المزامنة
        const saved = await window.__offlineEnqueue({ type, table, data, id, knownUpdatedAt });
        if (!saved) {
            // BUG FIX: نفس المشكلة — هنا كانت أوضح، لأن المستخدم فعليًا offline
            // وملوش طريقة تانية يحفظ بيها، فلو IndexedDB فشلت (مساحة تخزين ممتلئة،
            // متصفح Private/Incognito، أو خطأ غير متوقع) كانت البيانات تتفقد بصمت
            // والمستخدم يفتكر إنها "محفوظة محلياً" زي ما الرسالة كانت بتقوله.
            return { error: { message: 'فشل الحفظ محلياً — تأكد من توفر مساحة تخزين كافية في المتصفح، أو إنك مش في وضع التصفح الخفي (Private/Incognito)' }, offline: true, queued: false };
        }
        // 🆕 المرحلة 3-1: لو الوصول للفرع ده كان بسبب forceQueueForSelfTempId
        // (يعني إحنا أونلاين فعليًا، بس مضطرين نقيّد لحد ما القضية تتزامن)،
        // منعرضش بانر "أوفلاين" المضلل (المستخدم مش أوفلاين فعليًا)، وبدل ما
        // نستنى دورة المزامنة الدورية (كل دقيقة) أو حدث 'online' (مش هيتفعّل
        // لأننا already أونلاين)، بنحاول مزامنة فورية دلوقتي (best-effort،
        // fire-and-forget) — لو القضية اتزامنت خلاص من دورة سابقة، العملية
        // دي هتتحل وتتنفذ في نفس اللحظة تقريبًا بدل ما تستنى لحد 60 ثانية.
        if (navigator.onLine && forceQueueForSelfTempId) {
            window.__syncOfflineQueue?.();
        } else {
            const count = await window.__getOfflineQueueCount?.() || 0;
            showOfflineBanner(count);
        }
        return { error: null, offline: true, queued: true };
    }
};

// ══════════════════════════════════════════════════════════
//  إشعارات حالة الشبكة (أونلاين/أوفلاين) — بانر + مؤشر مزامنة
// ══════════════════════════════════════════════════════════
window.addEventListener('network-offline', async () => {
    const count = await window.__getOfflineQueueCount?.() || 0;
    showOfflineBanner(count);
});
window.addEventListener('network-online', () => {
    hideOfflineBanner();
    showSyncIndicator('جاري المزامنة...');
});
(async () => {
    if (!navigator.onLine) {
        const count = await window.__getOfflineQueueCount?.() || 0;
        showOfflineBanner(count);
    }
})();
