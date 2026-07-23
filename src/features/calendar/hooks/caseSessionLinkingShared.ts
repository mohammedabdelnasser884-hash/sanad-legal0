// ══════════════════════════════════════════════════════════════
//  caseSessionLinkingShared — منطق مشترك بين useClientLinking.ts
//  (مسار NewStandaloneSessionModal — جلسة لسه بيانات form ما اتحفظتش)
//  وuseSessionLinking.ts (مسار StandaloneSessionDetailModal — جلسة
//  محفوظة بالفعل في القاعدة).
//
//  الملفين التلاتة (فيديو المراجعة الأصلي) كان فيهم منطق شبه متطابق
//  منسوخ يدويًا في كل ملف على حدة، وده اللي سبب الباگين اللي اتصلحوا:
//   - فلتر deleted_at اتضاف في نسخة وانتسي في التانية
//   - منطق إخفاء زرار "إضافة موكل جديد" عند تطابق مؤكد اتعمل في نسخة
//     ومكانش موجود في التانية
//  الهدف من الملف ده: أي فيكس مستقبلي في المنطق ده يتعمل *مرة واحدة*
//  هنا، والملفين التانيين يستخدموه بدل ما يكرروه.
//
//  ⚠️ الملفين مش هما نفس الحاجة بالظبط معماريًا — useClientLinking.ts
//  بيفوّض إضافة موكل جديد لموديل NewClientModal الموحّد (خطة توحيد
//  إنشاء الموكل)، بينما useSessionLinking.ts لسه بيعمل INSERT مباشر.
//  الفرق ده مقصود ومش "تكرار" المفروض نوحّده — الملف ده بيركّز بس على
//  الأجزاء اللي كانت فعلاً نسخة طبق الأصل من بعض.
// ══════════════════════════════════════════════════════════════

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';

/** معرّف مؤقت client-side لأي سطر بيتبعت للطابور الأوفلاين قبل ما ياخد
 * id حقيقي من القاعدة — نفس الصيغة المستخدمة في كل مكان تاني بالتطبيق
 * (useCaseActions.ts وغيره). */
export function makeOfflineTempId(): string {
  return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function isOfflineTempId(id: string): boolean {
  return id.startsWith('tmp-');
}

/** لو caseId لسه تمبيد (القضية نفسها اتقيدت أوفلاين ولسه ما اتزامنتش)،
 * بيضيف sentinel الحل الذاتي (_offlineSelfTempId + _offlineSelfFallbackName)
 * عشان دورة المزامنة تقدر تحل الـ id الحقيقي قبل تنفيذ الـ UPDATE ده —
 * راجع resolveOfflineSelfId في offlineQueue.ts. لو id حقيقي بالفعل، بيرجع
 * data زي ما هي من غير أي تغيير (نفس شكل الناتج القديم بالظبط). */
export function withCaseSelfOfflineSentinel(
  caseId: string,
  data: Record<string, unknown>,
  fallbackTitle: string | undefined,
): Record<string, unknown> {
  if (!isOfflineTempId(caseId)) return data;
  return { ...data, _offlineSelfTempId: caseId, _offlineSelfFallbackName: fallbackTitle };
}

/** لو العملية رجعت queued (أوفلاين)، بيضيف sentinel حل الـ FK
 * (_offlineFkTempId) عشان دورة المزامنة تربط السطر بـ id الحقيقي بعد
 * ما يتزامن. لو أونلاين، بيرجع data زي ما هي.
 * ⚡ NEW (مرحلة 6.2 — خطة تعدد الأطراف، 23 يوليو 2026): `table` بقى
 * بيقبل `'case_sessions'` كمان (مش بس `'cases'|'clients'`) — لدعم
 * FK صفوف `case_parties` بتاعة جلسة مستقلة (`session_id`) لسه في
 * الطابور. `resolveOfflineFkRefs`/`OfflineFkTempIdRef.table` في
 * offlineQueue.ts أصلاً عام (`DbWriteTable`) ومكانش محتاج أي تعديل؛
 * `FK_FALLBACK_NAME_COLUMN` مقصود إنها معملهاش entry لـ `case_sessions`
 * (مفيش عمود "اسم" فريد منطقي يتبحث بيه — تعليق موجود بالفعل في
 * offlineQueue.ts) فالحل هيعتمد بس على تطابق التمبيد في نفس دورة
 * المزامنة، بالظبط زي أي جدول تاني برا القايمة دي. */
export function withFkOfflineSentinel(
  offline: boolean | undefined,
  queued: boolean | undefined,
  field: string,
  tempId: string,
  table: 'cases' | 'clients' | 'case_sessions',
  fallbackNameValue: string | null | undefined,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (!(offline && queued)) return data;
  return { ...data, _offlineFkTempId: [{ field, tempId, table, fallbackNameValue }] };
}

/** الحقول المشتركة اللازمة لبناء صف INSERT في جدول cases عند تحويل جلسة
 * مستقلة (سواء لسه بيانات form أو جلسة محفوظة بالفعل) لملف قضية —
 * أسماء generic (مش أسماء أعمدة الجدول) عشان تتغذى من Form أو
 * CaseSessionRow بنفس الدالة. */
export interface CaseInsertSourceFields {
  court?: string | null;
  caseNumber?: string | null;
  caseType?: string | null;
  plaintiff?: string | null;
  plaintiffRole?: string | null;
  plaintiffNationalId?: string | null;
  plaintiffPoa?: string | null;
  // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 5): عنوان الموكل — مفقود من
  // هنا قبل كده رغم إن جدول cases فيه عمود plaintiff_address فعليًا؛
  // case_sessions مفيهاش العمود ده أصلاً، فبييجي بس لو فيه linkedClient
  // وقت تحويل جلسة مستقلة مربوطة لقضية (شوف useSessionLinking.ts).
  plaintiffAddress?: string | null;
  defendant?: string | null;
  defendantRole?: string | null;
  defendantNationalId?: string | null;
  circuitNumber?: string | null;
  sessionHall?: string | null;
  sessionTime?: string | null;
  courtLevel?: string | null;
  secretaryHall?: string | null;
  secretaryName?: string | null;
  secretaryMobile?: string | null;
  // 🆕 (خطة "المسمى القانوني" — بند مؤجل، راجع "بنود مؤجلة للمراجعة" في
  // التقرير): المسمى الجامع للطرف (لو أكتر من شخص) — كان مفقود هنا قبل
  // كده، فمكنش بيتنقل للقضية الجديدة وقت تحويل جلسة مستقلة رغم إن كل
  // الأشخاص أنفسهم (case_parties) كانوا بينتقلوا صح عبر
  // movePartiesFromSessionToCase تحت.
  plaintiffLegalTitle?: string | null;
  defendantLegalTitle?: string | null;
}

/** بناء بيانات INSERT لجدول cases عند تحويل جلسة مستقلة لملف قضية —
 * منطق واحد بدل نسختين منفصلتين (كانوا متطابقين حرفيًا في useClientLinking.ts
 * وuseSessionLinking.ts، غير مصدر البيانات نفسه).
 * @param existingClientId مرّرها بس لو المصدر جلسة محفوظة بالفعل ممكن
 *   تكون اتربطت بموكل قبل التحويل (session.client_id) — لو undefined،
 *   عمود client_id مش بيتبعت خالص في الـ INSERT (زي مسار الفورم اللي
 *   لسه ما اتحفظش، مفيش فيه مفهوم "موكل مربوط قبل كده" أصلاً). */
export function buildCaseInsertData(
  fields: CaseInsertSourceFields,
  caseTitle: string,
  offlineTempId: string,
  existingClientId?: string | null,
): Record<string, unknown> {
  return {
    title: caseTitle,
    court_name: fields.court || caseTitle,
    case_number_official: fields.caseNumber || caseTitle,
    case_number: fields.caseNumber || null,
    court: fields.court || null,
    case_type: fields.caseType || null,
    plaintiff: fields.plaintiff || null,
    plaintiff_role: fields.plaintiffRole || null,
    plaintiff_national_id: fields.plaintiffNationalId || null,
    plaintiff_power_of_attorney: fields.plaintiffPoa || null,
    plaintiff_address: fields.plaintiffAddress || null,
    defendant: fields.defendant || null,
    defendant_role: fields.defendantRole || null,
    defendant_national_id: fields.defendantNationalId || null,
    // 🆕 (خطة "المسمى القانوني" — بند مؤجل من التقرير): إضافي بالكامل —
    // القضايا اللي مالهاش مسمى قانوني أصلاً (الحالة الغالبة، طرف واحد)
    // بتفضل زي ما هي بالظبط (null)، صفر تغيير سلوك.
    plaintiff_legal_title: fields.plaintiffLegalTitle || null,
    defendant_legal_title: fields.defendantLegalTitle || null,
    circuit_number: fields.circuitNumber || null,
    session_hall: fields.sessionHall || null,
    session_time: fields.sessionTime || null,
    court_level: fields.courtLevel || null,
    secretary_hall: fields.secretaryHall || null,
    secretary_name: fields.secretaryName || null,
    secretary_mobile: fields.secretaryMobile || null,
    status: 'نشطة',
    ...(existingClientId !== undefined ? { client_id: existingClientId || null } : {}),
    _offlineTempId: offlineTempId,
  };
}

// ══════════════════════════════════════════════════════════════
//  خطة تعدد الأطراف — مرحلة 7.1 (23 يوليو 2026): نقل صفوف case_parties
//  عند تحويل جلسة مستقلة لقضية. قبل كده، تحويل الجلسة لقضية كان بياخد
//  بس "الطرف الأساسي" في كل جهة (عبر buildCaseInsertData فوق، اللي بيكتب
//  للأعمدة القديمة plaintiff/defendant بس) — أي طرف إضافي (مدعي تاني،
//  مدعى عليه تاني) كان بيضيع تمامًا وقت التحويل رغم إنه كان موجود فعليًا
//  في case_parties بتاعة الجلسة. الدالة دي بتقفل الفجوة دي.
// ══════════════════════════════════════════════════════════════

export type MovePartiesResult = { ok: true } | { ok: false };

/**
 * بتنقل كل صفوف case_parties المسجّلة بجلسة مستقلة (session_id) للقضية
 * الجديدة اللي اتعملت من بيانات الجلسة دي (case_id) — UPDATE في مكانه
 * لكل صف (نفس id، نفس علامة ⭐، نفس ترتيب) بدل حذف/إعادة إدراج، عشان أي
 * ربط لاحق بموكل من النظام (client_id) على الطرف ده يفضل زي ما هو.
 * لازم تتنادى بعد نجاح إنشاء القضية وربط الجلسة بيها (case_sessions.case_id).
 *
 * بترجع {ok:true} كمان لو مفيش صفوف أصلاً (جلسة قديمة قبل مرحلة 6 لسه
 * بتاعة الأعمدة القديمة بس، أو وضع "existing" اللي مفيهوش أطراف خاصة
 * بالجلسة نفسها) — مش خطأ حقيقي، الطرف الأساسي أصلاً اتكتب في القضية عبر
 * buildCaseInsertData.
 *
 * caseId ممكن يكون تمبيد أوفلاين (لو إنشاء القضية نفسه اتقيّد أوفلاين) —
 * caseOffline/caseQueued/caseTempId/caseFallbackTitle بينفعوا withFkOfflineSentinel
 * عشان دورة المزامنة تحل case_id الحقيقي بعدين، نفس نمط أي FK تاني في
 * الملف ده.
 */
export async function movePartiesFromSessionToCase(
  db: SupabaseClient<Database>,
  sessionId: string,
  caseId: string,
  caseOffline: boolean | undefined,
  caseQueued: boolean | undefined,
  caseTempId: string,
  caseFallbackTitle: string | undefined,
): Promise<MovePartiesResult> {
  // ⚠️ case_parties بقت مضافة في database.types.ts (خطة تعدد الأطراف،
  // مرحلة 1) — مفيش داعي لكاست 'as cases' هنا تاني (كان قبل كده بديل
  // مؤقت لحد إضافة الجدول للـ types المولّدة).
  const { data, error } = await db.from('case_parties')
    .select('id')
    .eq('session_id', sessionId);
  if (error || !data || data.length === 0) return { ok: true };

  let allOk = true;
  for (const row of data as unknown as { id: string }[]) {
    const result = await window.__dbWrite({
      type: 'UPDATE',
      table: 'case_parties',
      id: row.id,
      data: withFkOfflineSentinel(
        caseOffline, caseQueued, 'case_id', caseTempId, 'cases', caseFallbackTitle,
        { case_id: caseId, session_id: null },
      ),
    });
    if (result.error) allOk = false;
  }
  return allOk ? { ok: true } : { ok: false };
}

// ══════════════════════════════════════════════════════════════
//  خطة "المسمى القانوني" — بند مؤجل ثانٍ (استمرارية بيانات الجلسة القادمة،
//  24 يوليو 2026): لما جلسة مستقلة فيها أكتر من شخص تحت أي طرف (ورثة/
//  شركاء) بتتحدّث نتيجتها (SessionUpdateModal.tsx)، الجلسة الجديدة كانت
//  بتاخد نسخة من الأعمدة القديمة بس (plaintiff/defendant/...)، من غير
//  المسمى القانوني ولا صفوف case_parties الكاملة — فترجع "شخص واحد بس".
//  الدالة دي بتقفل نص المشكلة (نسخ الأطراف)، والنص التاني (المسمى
//  القانوني) بيتصلح مباشرة في SessionUpdateModal.tsx نفسها (عمودين على
//  صف الجلسة، مفيش داعي لدالة منفصلة).
// ══════════════════════════════════════════════════════════════

/**
 * بتنسخ (INSERT صفوف جديدة، مش UPDATE في مكانها زي movePartiesFromSessionToCase
 * فوق) كل صفوف case_parties بتاعة جلسة مستقلة (oldSessionId) لجلسة جديدة
 * (newSessionId) اتولدت منها تلقائيًا — الجلسة القديمة لازم تفضل محتفظة
 * بصفوفها الأصلية كسجل تاريخي لما حصل فيها، فده نسخ لا نقل.
 *
 * idx_case_parties_no_dup_national_id (UNIQUE على COALESCE(case_id,
 * session_id) + national_id) مش بيتعارض هنا: session_id الجديد مختلف عن
 * القديم، فنفس الرقم القومي مسموح يتكرر عبر جلستين مختلفتين بلا مشكلة.
 *
 * بترجع {ok:true} كمان لو مفيش صفوف أصلاً (جلسة قديمة معندهاش case_parties
 * بعد، أو طرف واحد بس اتسجل بالأعمدة القديمة فقط) — مش خطأ حقيقي.
 */
export async function copySessionPartiesToNewSession(
  db: SupabaseClient<Database>,
  oldSessionId: string,
  newSessionId: string,
): Promise<{ ok: boolean }> {
  const { data, error } = await db.from('case_parties')
    .select('side,is_client,name,capacity,national_id,address,power_of_attorney,client_id,sort_order')
    .eq('session_id', oldSessionId);
  if (error) return { ok: false };
  if (!data || data.length === 0) return { ok: true };

  const rows = (data as unknown as {
    side: string; is_client: boolean; name: string; capacity: string;
    national_id: string | null; address: string | null; power_of_attorney: string | null;
    client_id: string | null; sort_order: number;
  }[]).map((p) => ({
    case_id: null,
    session_id: newSessionId,
    side: p.side,
    is_client: p.is_client,
    name: p.name,
    capacity: p.capacity,
    national_id: p.national_id,
    address: p.address,
    power_of_attorney: p.power_of_attorney,
    client_id: p.client_id,
    sort_order: p.sort_order,
  }));

  const { error: insertErr } = await db.from('case_parties').insert(rows);
  return { ok: !insertErr };
}

export interface MatchedClient {
  id: string;
  full_name: string | null;
  client_name?: string | null;
}
export type ClientMatchType = 'exact' | 'fuzzy';

/**
 * البحث عن موكل مطابق بالاسم (تخمين ilike على full_name/client_name
 * مع بعض — full_name مش مضمون امتلاؤه لكل الموكلين قبل migration
 * 02-clients-full-name-sync.sql، فبندوّر على الاتنين)، مستبعدين
 * الموكلين المؤرشفين (deleted_at). بيرجع matchType:
 *  - 'exact': الاسم متطابق بالظبط (case-insensitive بعد trim) — الواجهة
 *    المفروض تخفي زرار "إضافة موكل جديد" في الحالة دي (checkClientDuplicate
 *    هيرفضه بنفس السبب لو المستخدم حاول).
 *  - 'fuzzy': مجرد احتواء جزئي (تخمين)، زرار "إضافة موكل جديد" آمن يفضل ظاهر.
 * منطق واحد بدل نسختين كانت إحداهما ناقصة فلتر deleted_at.
 */
export async function findMatchingClientByName(
  db: SupabaseClient<Database>,
  plaintiffName: string | null | undefined,
): Promise<{ client: MatchedClient; matchType: ClientMatchType } | null> {
  const name = (plaintiffName || '').trim();
  if (!name) return null;

  const { data: clients } = await db.from('clients').select('id,full_name,client_name')
    .is('deleted_at', null)
    .or(`full_name.ilike.%${name}%,client_name.ilike.%${name}%`)
    .limit(3);

  if (!clients || clients.length === 0) return null;

  const c = clients[0] as MatchedClient;
  const normalized = name.toLowerCase();
  const isExact = (c.full_name || '').trim().toLowerCase() === normalized
    || (c.client_name || '').trim().toLowerCase() === normalized;
  return { client: c, matchType: isExact ? 'exact' : 'fuzzy' };
}

// ══════════════════════════════════════════════════════════════
//  خطة تعدد الأطراف — مرحلة 7.2 جزء 1 (23 يوليو 2026): طبقة المنطق
//  لاكتشاف *كل* أطراف الجلسة اللي is_client=true (مش بس session.plaintiff/
//  f.plaintiff كنص واحد زي قبل كده) والبحث عن موكل مطابق لكل واحد فيهم
//  على حدة، + دوال الربط الفعلي (كل طرف بياخد client_id بتاعه في
//  case_parties، والطرف الأساسي فقط — أول واحد is_client=true بترتيب
//  sort_order — بيحدّث cases.client_id القديم كمان، بنفس السلوك الحالي
//  تمامًا قبل التغيير ده، عشان صفر كسر سلوك).
//  ⚠️ الجزء ده (منطق بس) — التوصيل الفعلي بواجهة useSessionLinking.ts/
//  useClientLinking.ts + شاشات StandaloneSessionDetailModal.tsx/
//  NewStandaloneSessionModal.tsx (عرض أكتر من "لقينا موكل مطابق" في نفس
//  الوقت) هو جزء 2 التالي — الدوال هنا مستقلة وقابلة للاختبار لوحدها.
// ══════════════════════════════════════════════════════════════

/** طرف واحد is_client=true تابع لجلسة مستقلة — الاستعلام بيقرا بـ
 * session_id عمدًا (مش case_id) عشان يشتغل *قبل* نقل الأطراف عبر
 * movePartiesFromSessionToCase ومن غير أي اعتماد على caseId يكون id
 * حقيقي (لو إنشاء القضية نفسه أوفلاين، caseId هيفضل تمبيد لحد المزامنة —
 * الاستعلام بـ case_id كان هيرجع فاضي في الحالة دي). session_id دايمًا
 * حقيقي في المسارين اللي بينادوا الدالة دي، نفس افتراض
 * movePartiesFromSessionToCase بالظبط. */
export interface SessionClientParty {
  id: string;
  side: 'plaintiff' | 'defendant';
  name: string;
  national_id: string | null;
  power_of_attorney: string | null;
  address: string | null;
  sort_order: number;
}

/**
 * بتجيب كل صفوف case_parties بـ session_id = sessionId وis_client = true،
 * مرتبة بـ sort_order — أول صف في المصفوفة الراجعة هو "الطرف الأساسي"
 * لأغراض توافق cases.client_id (شوف linkClientToParty تحت). بترجع
 * مصفوفة فاضية لو مفيش صفوف (جلسة قديمة قبل مرحلة 6، أو مفيش أي طرف
 * is_client=true أصلاً) — الاستدعاء المفروض يعتبرها fallback لمسار
 * findMatchingClientByName القديم (اسم واحد بس)، مش خطأ.
 */
export async function fetchSessionClientParties(
  db: SupabaseClient<Database>,
  sessionId: string,
): Promise<SessionClientParty[]> {
  // ⚠️ case_parties بقت مضافة في database.types.ts (خطة تعدد الأطراف،
  // مرحلة 1) — مفيش داعي لكاست 'as cases' تاني هنا.
  const { data, error } = await db.from('case_parties')
    .select('id,side,name,national_id,power_of_attorney,address,sort_order')
    .eq('session_id', sessionId)
    .eq('is_client', true)
    .order('sort_order', { ascending: true });
  if (error || !data) return [];
  return data as unknown as SessionClientParty[];
}

export interface PartyClientMatch {
  party: SessionClientParty;
  client: MatchedClient;
  matchType: ClientMatchType;
}

/**
 * بتدوّر على موكل مطابق (findMatchingClientByName) لكل طرف في المصفوفة
 * المدخلة، بالترتيب. الطرف اللي مالوش تطابق مش بيتضاف للمصفوفة الراجعة
 * (الواجهة بتعرف "مفيش تطابق" لطرف معيّن بمقارنة parties الأصلية بمصفوفة
 * matches الراجعة — نفس فكرة clientStep === 'notfound' القديمة لكن لكل
 * طرف لوحده).
 */
export async function matchClientsForParties(
  db: SupabaseClient<Database>,
  parties: SessionClientParty[],
): Promise<PartyClientMatch[]> {
  const matches: PartyClientMatch[] = [];
  for (const party of parties) {
    const found = await findMatchingClientByName(db, party.name);
    if (found) matches.push({ party, client: found.client, matchType: found.matchType });
  }
  return matches;
}

/**
 * بتربط موكل (clientId) بطرف معيّن — case_parties.client_id بتاع الطرف
 * ده بس (id حقيقي دايمًا، الطرف أصلاً صف موجود في القاعدة من قبل إنشاء
 * القضية). لو isPrimaryParty=true (الطرف ده هو أول عنصر في
 * fetchSessionClientParties)، بتحدّث cases.client_id القديم كمان — بنفس
 * السلوك بالظبط اللي كان موجود قبل مرحلة 7.2 (لما كان في موكل واحد بس
 * بيتفحص وبيتربط بـ cases.client_id مباشرة). caseId ممكن يكون لسه تمبيد
 * أوفلاين (withCaseSelfOfflineSentinel)، caseTitle بيتستخدم كـ fallback
 * بالاسم في الحالة دي بس.
 *
 * ⚡ NEW (7.2 جزء 2، 23 يوليو 2026): باراميتر سادس اختياري `clientOfflineInfo`
 * — لما clientId نفسه لسه تمبيد أوفلاين (سيناريو "إضافة موكل جديد" لطرف
 * إضافي غير الأساسي، أونلاين إنشاء الموكل ممكن يتقيّد أوفلاين زي أي INSERT
 * تاني). من غيره، الـ UPDATE على case_parties كان هيبعت التمبيد نفسه كـ
 * client_id حرفيًا من غير أي sentinel يوضح لدورة المزامنة إنه محتاج حل —
 * فجوة كانت موجودة في نسخة جزء 1 من الدالة دي (لسه ما كانتش مستخدمة إلا
 * لموكلين مطابقين من findMatchingClientByName اللي id بتاعهم حقيقي دايمًا).
 * لو الباراميتر مش متبعت (زي كل الاستدعاءات القديمة)، السلوك زي ما هو
 * بالظبط — نفس شكل الناتج القديم حرفيًا.
 */
export async function linkClientToParty(
  partyId: string,
  clientId: string,
  isPrimaryParty: boolean,
  caseId: string,
  caseTitle: string | undefined,
  clientOfflineInfo?: { isTempClientId: boolean; tempClientId: string; fallbackNameValue: string | null },
): Promise<{ ok: boolean }> {
  const partyUpdateData = clientOfflineInfo
    ? withFkOfflineSentinel(
        clientOfflineInfo.isTempClientId, true, 'client_id', clientOfflineInfo.tempClientId, 'clients',
        clientOfflineInfo.fallbackNameValue, { client_id: clientId },
      )
    : { client_id: clientId };
  const partyResult = await window.__dbWrite({
    type: 'UPDATE',
    table: 'case_parties',
    id: partyId,
    data: partyUpdateData,
  });
  let caseOk = true;
  if (isPrimaryParty) {
    const caseResult = await window.__dbWrite({
      type: 'UPDATE',
      table: 'cases',
      id: caseId,
      data: withCaseSelfOfflineSentinel(caseId, { client_id: clientId }, caseTitle),
    });
    caseOk = !caseResult.error;
  }
  return { ok: !partyResult.error && caseOk };
}

// ══════════════════════════════════════════════════════════════
//  خطة تعدد الأطراف — مرحلة 13 جزء 2 (23 يوليو 2026): نسخة من
//  linkClientToParty فوق، بس لطرف تابع لجلسة مستقلة *لسه ما اتحوّلتش
//  لقضية* (زرار "إضافة الموكل لقائمة الموكلين فقط" في NewStandaloneSessionModal —
//  مفيش case_id أصلًا في اللحظة دي، الطرف لسه عنده session_id بس). نفس
//  فلسفة linkClientToParty بالحرف (case_parties.client_id للطرف ده بس +
//  تحديث "الأساسي" لو ده الطرف الأساسي)، غير إن المزامنة القديمة بتروح
//  لـ case_sessions.client_id بدل cases.client_id (مفيش cases.client_id
//  أصلًا من غير قضية) — نفس عمود case_sessions.client_id اللي كان بيتحدّث
//  قبل مرحلة 13 عن طريق linkTarget نوعه 'session' (مسار الموكل الواحد
//  القديم في useClientActions.ts)، صفر تغيير في العمود المستهدف نفسه.
// ══════════════════════════════════════════════════════════════

export async function linkClientToSessionParty(
  partyId: string,
  clientId: string,
  isPrimaryParty: boolean,
  sessionId: string,
  clientOfflineInfo?: { isTempClientId: boolean; tempClientId: string; fallbackNameValue: string | null },
): Promise<{ ok: boolean }> {
  const partyUpdateData = clientOfflineInfo
    ? withFkOfflineSentinel(
        clientOfflineInfo.isTempClientId, true, 'client_id', clientOfflineInfo.tempClientId, 'clients',
        clientOfflineInfo.fallbackNameValue, { client_id: clientId },
      )
    : { client_id: clientId };
  const partyResult = await window.__dbWrite({
    type: 'UPDATE',
    table: 'case_parties',
    id: partyId,
    data: partyUpdateData,
  });
  let sessionOk = true;
  if (isPrimaryParty) {
    // ⚠️ مفيش withCaseSelfOfflineSentinel هنا عمدًا — sessionId هنا لازم
    // يكون id حقيقي دايمًا (الطرف بيتفتح ليه زرار بس لو savedFormData.sessionId
    // موجود، وده بس بيتحدد لو الجلسة اتحفظت أونلاين بنجاح — راجع الشرط
    // في NewStandaloneSessionModal.tsx). لو الجلسة نفسها أوفلاين، الزرار
    // مبيظهرش أصلًا (نفس سلوك مسار 'session' القديم في handleAddClientOnly).
    const sessionResult = await window.__dbWrite({
      type: 'UPDATE',
      table: 'case_sessions',
      id: sessionId,
      data: { client_id: clientId },
    });
    sessionOk = !sessionResult.error;
  }
  return { ok: !partyResult.error && sessionOk };
}

// ══════════════════════════════════════════════════════════════
//  خطة توحيد مصدر بيانات الموكل — المرحلة السادسة (تنبيه عند الربط
//  اللاحق): لما قضية/جلسة مستقلة عندها بيانات حرة (plaintiff_*) اتربطت
//  لاحقًا (بعد الإنشاء) بموكل من النظام، بنقارن القيم الحرة المكتوبة
//  بقيم ملف الموكل الحقيقي. لو فيه تعارض حقيقي (القيمتين موجودتين
//  ومختلفتين — مش مجرد حقل فاضي هيتملى)، بترجع أسماء الحقول المتعارضة
//  عشان الواجهة تعرض تنبيه تأكيد بدل ما تستبدل صامت.
// ══════════════════════════════════════════════════════════════

export interface FreeTextPartyFields {
  plaintiff?: string | null;
  plaintiff_national_id?: string | null;
  plaintiff_power_of_attorney?: string | null;
  /** case_sessions مفيهاش العمود ده أصلاً (شوف فاز 3) — سيبها undefined
   * لو المصدر جلسة، هتتجاهل تلقائيًا في المقارنة. */
  plaintiff_address?: string | null;
}

export interface ClientPartyFields {
  full_name?: string | null;
  client_name?: string | null;
  national_id?: string | null;
  cr_number?: string | null;
  address?: string | null;
}

export interface FieldMismatch {
  field: 'name' | 'national_id' | 'poa' | 'address';
  label: string;
  freeTextValue: string;
  clientValue: string;
}

/**
 * بترجع مصفوفة الحقول اللي فيها تعارض فعلي — القيمة الحرة موجودة، وقيمة
 * الموكل موجودة، والاتنين مختلفين بعد trim. حقل فاضي في أي ناحية (لسه
 * ما اتكتبش، أو ملف الموكل ناقصه) مش تعارض، هيتملى عادي من غير تنبيه.
 */
export function findClientDataMismatches(
  freeText: FreeTextPartyFields,
  client: ClientPartyFields,
): FieldMismatch[] {
  const mismatches: FieldMismatch[] = [];
  const clientName = (client.full_name || client.client_name || '').trim();
  const freeName = (freeText.plaintiff || '').trim();
  if (freeName && clientName && freeName !== clientName) {
    mismatches.push({ field: 'name', label: 'الاسم', freeTextValue: freeName, clientValue: clientName });
  }
  const freeNid = (freeText.plaintiff_national_id || '').trim();
  const clientNid = (client.national_id || '').trim();
  if (freeNid && clientNid && freeNid !== clientNid) {
    mismatches.push({ field: 'national_id', label: 'الرقم القومي', freeTextValue: freeNid, clientValue: clientNid });
  }
  const freePoa = (freeText.plaintiff_power_of_attorney || '').trim();
  const clientPoa = (client.cr_number || '').trim();
  if (freePoa && clientPoa && freePoa !== clientPoa) {
    mismatches.push({ field: 'poa', label: 'رقم التوكيل', freeTextValue: freePoa, clientValue: clientPoa });
  }
  if (freeText.plaintiff_address !== undefined) {
    const freeAddr = (freeText.plaintiff_address || '').trim();
    const clientAddr = (client.address || '').trim();
    if (freeAddr && clientAddr && freeAddr !== clientAddr) {
      mismatches.push({ field: 'address', label: 'العنوان', freeTextValue: freeAddr, clientValue: clientAddr });
    }
  }
  return mismatches;
}
