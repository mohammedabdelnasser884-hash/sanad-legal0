import { existsSync, readFileSync, unlinkSync } from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// خطوة تنظيف الـCI (تقرير المرحلة 4، "الخطوة الجاية") — الجزء الثاني.
// بيمسح تلقائيًا كل الصفوف اللي أنشأتها تستات E2E بعد كل تشغيل، بدل
// تنظيف يدوي دوري أو تينانت منفصل بيتصفّر بشكل دوري (القرار المعتمد في
// التقرير). بيتصل مباشرة بـSupabase بمفتاح الـservice role (متخطي الـRLS)
// عشان يقدر يمسح بيانات كل التستات مش بس تينانت واحد.
//
// شرطين مع بعض كحماية ضد مسح بيانات حقيقية غلط:
//   (أ) عندها علامة "اختبار E2E" في العنوان/الاسم (نفس الـmarker
//       المستخدم فعليًا في كل ملفات e2e/*.spec.ts الحالية)
//   (ب) اتعملت بعد وقت بداية تشغيل التستات (مسجّل في global-setup.ts)
//
// جداول تاني بتتمسح "كاسكيد" بالربط بـcase_id/session_id/fee_id للصفوف
// اللي عدّت الشرطين دول (case_fees وfee_payments وinvoices وغيرهم مفيهمش
// عمود عنوان/اسم بيحمل الماركر بشكل مباشر) — ترتيب المسح حسب الـFK
// dependencies (الأبناء الأول): invoices → fee_payments → case_fees →
// case_documents/case_notes/case_events → case_parties → case_sessions →
// cases → activity_log → clients.
//
// ⚠️ مهم: مبنمسحش clients بس لإنها اترتبطت بقضية اتمسحت — عميل حقيقي
// موجود قبل كده ولو اترتبط بيه قضية تست، السطر بتاعه في clients ميتمسحش
// إلا لو اسمه هو نفسه فيه الماركر واتعمل بعد بداية التستات.

const MARKER = '%اختبار E2E%';
const START_TIME_FILE = path.join(__dirname, '.e2e-start-time');
const CHUNK_SIZE = 150;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function deleteByIdIn(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ids: string[],
): Promise<number> {
  if (ids.length === 0) return 0;
  let total = 0;
  for (const part of chunk(ids, CHUNK_SIZE)) {
    const { error, count } = await supabase
      .from(table)
      .delete({ count: 'exact' })
      .in(column, part);
    if (error) {
      console.warn(`  ⚠️ فشل حذف من ${table} (${column}):`, error.message);
      continue;
    }
    total += count ?? 0;
  }
  return total;
}

export default async function globalTeardown(): Promise<void> {
  console.log('\n[global-teardown] بدء تنظيف بيانات E2E...');

  if (!existsSync(START_TIME_FILE)) {
    console.warn('[global-teardown] ملف وقت البداية مش موجود — تخطّي التنظيف.');
    return;
  }
  const startTime = readFileSync(START_TIME_FILE, 'utf-8').trim();
  try {
    unlinkSync(START_TIME_FILE);
  } catch {
    // مش مشكلة لو الملف اتمسح بالفعل أو الحذف فشل — مش حرج للتنظيف نفسه
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      '[global-teardown] SUPABASE_SERVICE_ROLE_KEY أو VITE_SUPABASE_URL مش موجودين — ' +
        'تخطّي التنظيف التلقائي (طبيعي في تشغيل محلي من غير الـsecret ده).',
    );
    return;
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // 1) القضايا المعلَّمة اللي اتعملت بعد بداية التشغيل
    const { data: markedCases, error: casesErr } = await supabase
      .from('cases')
      .select('id')
      .ilike('title', MARKER)
      .gte('created_at', startTime);
    if (casesErr) throw casesErr;
    const caseIds = (markedCases ?? []).map((r) => r.id as string);

    // 2) الجلسات المستقلة المعلَّمة (case_id فاضي) اللي اتعملت بعد بداية التشغيل
    const { data: standaloneSessions, error: standaloneErr } = await supabase
      .from('case_sessions')
      .select('id')
      .is('case_id', null)
      .ilike('title', MARKER)
      .gte('created_at', startTime);
    if (standaloneErr) throw standaloneErr;
    const standaloneSessionIds = (standaloneSessions ?? []).map((r) => r.id as string);

    // 3) جلسات القضايا المعلَّمة (كاسكيد بالـcase_id، من غير شرط ماركر/وقت إضافي)
    let caseSessionIds: string[] = [];
    if (caseIds.length > 0) {
      const { data: caseSessions, error: caseSessErr } = await supabase
        .from('case_sessions')
        .select('id')
        .in('case_id', caseIds);
      if (caseSessErr) throw caseSessErr;
      caseSessionIds = (caseSessions ?? []).map((r) => r.id as string);
    }
    const allSessionIds = [...standaloneSessionIds, ...caseSessionIds];

    // 4) الأتعاب المرتبطة بالقضايا المعلَّمة
    let feeIds: string[] = [];
    if (caseIds.length > 0) {
      const { data: fees, error: feesErr } = await supabase
        .from('case_fees')
        .select('id')
        .in('case_id', caseIds);
      if (feesErr) throw feesErr;
      feeIds = (fees ?? []).map((r) => r.id as string);
    }

    // 5) الدفعات المرتبطة بالأتعاب دي
    let paymentIds: string[] = [];
    if (feeIds.length > 0) {
      const { data: payments, error: paymentsErr } = await supabase
        .from('fee_payments')
        .select('id')
        .in('fee_id', feeIds);
      if (paymentsErr) throw paymentsErr;
      paymentIds = (payments ?? []).map((r) => r.id as string);
    }

    const counts: Record<string, number> = {};

    // الترتيب: الأبناء الأول عشان الـFK dependencies
    counts.invoices_by_payment = await deleteByIdIn(supabase, 'invoices', 'fee_payment_id', paymentIds);
    counts.invoices_by_case = await deleteByIdIn(supabase, 'invoices', 'case_id', caseIds);
    counts.fee_payments = await deleteByIdIn(supabase, 'fee_payments', 'id', paymentIds);
    counts.case_fees = await deleteByIdIn(supabase, 'case_fees', 'id', feeIds);
    counts.case_documents = await deleteByIdIn(supabase, 'case_documents', 'case_id', caseIds);
    counts.case_notes = await deleteByIdIn(supabase, 'case_notes', 'case_id', caseIds);
    counts.case_events = await deleteByIdIn(supabase, 'case_events', 'case_id', caseIds);
    counts.case_parties_by_case = await deleteByIdIn(supabase, 'case_parties', 'case_id', caseIds);
    counts.case_parties_by_session = await deleteByIdIn(supabase, 'case_parties', 'session_id', allSessionIds);
    counts.case_sessions = await deleteByIdIn(supabase, 'case_sessions', 'id', allSessionIds);
    counts.cases = await deleteByIdIn(supabase, 'cases', 'id', caseIds);

    // activity_log: تنظيف مستقل بنفس الشرطين (مفيش FK حقيقية معتمدة عليه)
    const { error: logErr, count: logCount } = await supabase
      .from('activity_log')
      .delete({ count: 'exact' })
      .or(`case_name.ilike.${MARKER},client_name.ilike.${MARKER}`)
      .gte('created_at', startTime);
    if (logErr) console.warn('  ⚠️ فشل حذف من activity_log:', logErr.message);
    counts.activity_log = logCount ?? 0;

    // الموكلين: بس اللي اسمهم فيه الماركر واتعملوا بعد بداية التشغيل —
    // مش أي موكل اترتبط بقضية اتمسحت (ممكن يكون موكل حقيقي)
    const { error: clientsErr, count: clientsCount } = await supabase
      .from('clients')
      .delete({ count: 'exact' })
      .ilike('client_name', MARKER)
      .gte('created_at', startTime);
    if (clientsErr) console.warn('  ⚠️ فشل حذف من clients:', clientsErr.message);
    counts.clients = clientsCount ?? 0;

    console.log('[global-teardown] تم التنظيف:');
    for (const [table, n] of Object.entries(counts)) {
      if (n > 0) console.log(`  - ${table}: ${n}`);
    }
    console.log('[global-teardown] خلص.\n');
  } catch (err) {
    // best-effort: فشل التنظيف مبيسقطش تشغيل التستات نفسه (النتيجة أصلاً
    // اتحسبت قبل ما الـteardown يشتغل) — بس بنسجّل تحذير واضح.
    console.warn('[global-teardown] فشل التنظيف التلقائي:', (err as Error).message);
  }
}
