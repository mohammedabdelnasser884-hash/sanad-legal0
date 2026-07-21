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
 * ما يتزامن. لو أونلاين، بيرجع data زي ما هي. */
export function withFkOfflineSentinel(
  offline: boolean | undefined,
  queued: boolean | undefined,
  field: string,
  tempId: string,
  table: 'cases' | 'clients',
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
    defendant: fields.defendant || null,
    defendant_role: fields.defendantRole || null,
    defendant_national_id: fields.defendantNationalId || null,
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
