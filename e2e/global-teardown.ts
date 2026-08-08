import { createClient, SupabaseClient } from '@supabase/supabase-js';

// خطوة تنظيف الـCI (تقرير المرحلة 4، "الخطوة الجاية") — الجزء الثاني.
// بيمسح تلقائيًا كل الصفوف اللي أنشأتها تستات E2E بعد كل تشغيل، بدل
// تنظيف يدوي دوري أو تينانت منفصل بيتصفّر بشكل دوري (القرار المعتمد في
// التقرير). بيتصل مباشرة بـSupabase بمفتاح الـservice role (متخطي الـRLS)
// عشان يقدر يمسح بيانات كل التستات مش بس تينانت واحد.
//
// ⚠️ FIX (تنظيف تام — 8 أغسطس 2026): الشرط اللي كان معتمد على وقت بداية
// التشغيل (startTime من global-setup.ts/.e2e-start-time) كان بيقصر
// التنظيف على صفوف الرن الحالي بس. لو تست فشل في رن قبل كده، صفوفه
// كانت بتفضل عالقة للأبد — لإن أي رن جديد بييجي بـstartTime أحدث من
// وقت إنشاء الصفوف القديمة، فمش بتتلقط. الحل: التنظيف بقى بالماركر
// "اختبار E2E" بس، من غير أي قيد وقت — أي رن (حتى لو جه بعد سلسلة
// فشل) هيمسح كل البقايا المتراكمة، مش بس اللي عمله هو.
//
// شرط واحد كحماية ضد مسح بيانات حقيقية غلط:
//   عندها علامة "اختبار E2E" في العنوان/الاسم (نفس الـmarker
//   المستخدم فعليًا في كل ملفات e2e/*.spec.ts الحالية)
//
// جداول تاني بتتمسح "كاسكيد" بالربط بـcase_id/session_id/fee_id للصفوف
// اللي عدّت الشرط ده (case_fees وfee_payments وinvoices وغيرهم مفيهمش
// عمود عنوان/اسم بيحمل الماركر بشكل مباشر) — ترتيب المسح حسب الـFK
// dependencies (الأبناء الأول): invoices → fee_payments → case_fees →
// case_documents/case_notes/case_events → case_parties → case_sessions →
// cases → activity_log → clients → reminders.
//
// ⚠️ مهم: مبنمسحش clients بس لإنها اترتبطت بقضية اتمسحت — عميل حقيقي
// موجود قبل كده ولو اترتبط بيه قضية تست، السطر بتاعه في clients ميتمسحش
// إلا لو اسمه هو نفسه فيه الماركر.
//
// ⚠️ FIX (تنظيف تام — 8 أغسطس 2026): جدول reminders ("المهام" في
// الواجهة) كان مش متضاف في التنظيف خالص — createReminder() في utils.ts
// بيعمل صفوف بعنوان فيه الماركر ومحدش كان بيمسحها. اتضاف تحت كنظيف
// مستقل بنفس الماركر.
//
// ⚠️ FIX (تنظيف تام — 8 أغسطس 2026): case_documents كان بيتمسح من
// الداتابيز بس، من غير ما يتمسح الملف الفعلي من Supabase Storage
// (bucket 'case-docs', عمود storage_path — نفس المنطق المستخدم في
// useCaseDocuments.ts/handleDeleteDoc). دلوقتي بنجيب storage_path
// لكل صف قبل ما نمسحه من الجدول، وبعدين بنمسح الملفات من الـstorage.

const MARKER = '%اختبار E2E%';
const CHUNK_SIZE = 150;
const STORAGE_CHUNK_SIZE = 100; // حد storage.remove() في Supabase

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
    // 1) القضايا المعلَّمة (كل الباقي من أي رن، مش بس الرن الحالي)
    const { data: markedCases, error: casesErr } = await supabase
      .from('cases')
      .select('id')
      .ilike('title', MARKER);
    if (casesErr) throw casesErr;
    const caseIds = (markedCases ?? []).map((r) => r.id as string);

    // 2) الجلسات المستقلة المعلَّمة (case_id فاضي)
    const { data: standaloneSessions, error: standaloneErr } = await supabase
      .from('case_sessions')
      .select('id')
      .is('case_id', null)
      .ilike('title', MARKER);
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

    // 5.5) storage_path بتاع كل مستندات القضايا المعلَّمة — لازم نجيبها
    // قبل ما نمسح السطور من case_documents عشان نقدر نمسح الملفات
    // الفعلية من bucket 'case-docs' بعد كده.
    let docStoragePaths: string[] = [];
    if (caseIds.length > 0) {
      const { data: docs, error: docsErr } = await supabase
        .from('case_documents')
        .select('storage_path')
        .in('case_id', caseIds);
      if (docsErr) throw docsErr;
      docStoragePaths = (docs ?? [])
        .map((r) => r.storage_path as string | null)
        .filter((p): p is string => !!p);
    }

    const counts: Record<string, number> = {};

    // الترتيب: الأبناء الأول عشان الـFK dependencies
    counts.invoices_by_payment = await deleteByIdIn(supabase, 'invoices', 'fee_payment_id', paymentIds);
    counts.invoices_by_case = await deleteByIdIn(supabase, 'invoices', 'case_id', caseIds);
    counts.fee_payments = await deleteByIdIn(supabase, 'fee_payments', 'id', paymentIds);
    counts.case_fees = await deleteByIdIn(supabase, 'case_fees', 'id', feeIds);
    counts.case_documents = await deleteByIdIn(supabase, 'case_documents', 'case_id', caseIds);

    // مسح الملفات الفعلية من الـstorage بعد ما السطور اتمسحت من الجدول
    if (docStoragePaths.length > 0) {
      let removedFiles = 0;
      for (const part of chunk(docStoragePaths, STORAGE_CHUNK_SIZE)) {
        const { data: removed, error: storageErr } = await supabase.storage.from('case-docs').remove(part);
        if (storageErr) {
          console.warn('  ⚠️ فشل حذف ملفات من case-docs storage:', storageErr.message);
          continue;
        }
        removedFiles += removed?.length ?? 0;
      }
      counts.case_docs_storage_files = removedFiles;
    }

    counts.case_notes = await deleteByIdIn(supabase, 'case_notes', 'case_id', caseIds);
    counts.case_events = await deleteByIdIn(supabase, 'case_events', 'case_id', caseIds);
    counts.case_parties_by_case = await deleteByIdIn(supabase, 'case_parties', 'case_id', caseIds);
    counts.case_parties_by_session = await deleteByIdIn(supabase, 'case_parties', 'session_id', allSessionIds);
    counts.case_sessions = await deleteByIdIn(supabase, 'case_sessions', 'id', allSessionIds);
    counts.cases = await deleteByIdIn(supabase, 'cases', 'id', caseIds);

    // activity_log: تنظيف مستقل بنفس شرط الماركر (مفيش FK حقيقية معتمدة عليه)
    const { error: logErr, count: logCount } = await supabase
      .from('activity_log')
      .delete({ count: 'exact' })
      .or(`case_name.ilike.${MARKER},client_name.ilike.${MARKER}`);
    if (logErr) console.warn('  ⚠️ فشل حذف من activity_log:', logErr.message);
    counts.activity_log = logCount ?? 0;

    // الموكلين: بس اللي اسمهم فيه الماركر — مش أي موكل اترتبط بقضية
    // اتمسحت (ممكن يكون موكل حقيقي)
    const { error: clientsErr, count: clientsCount } = await supabase
      .from('clients')
      .delete({ count: 'exact' })
      .ilike('client_name', MARKER);
    if (clientsErr) console.warn('  ⚠️ فشل حذف من clients:', clientsErr.message);
    counts.clients = clientsCount ?? 0;

    // المهام (reminders): كانت مش متضافة في التنظيف خالص قبل كده —
    // createReminder() في utils.ts بيعمل صفوف بعنوان فيه الماركر.
    const { error: remindersErr, count: remindersCount } = await supabase
      .from('reminders')
      .delete({ count: 'exact' })
      .ilike('title', MARKER);
    if (remindersErr) console.warn('  ⚠️ فشل حذف من reminders:', remindersErr.message);
    counts.reminders = remindersCount ?? 0;

    // 🔒 NEW (تنظيف تلقائي لجدول backups — 1 أغسطس 2026): admin-backup.spec.ts
    // بيعمل نسخة احتياطية حقيقية (export كامل لكل جداول التينانت) في كل
    // تشغيلة CI، وصفوف backups مالهاش عمود عنوان/اسم بيحمل ماركر "اختبار E2E"
    // زي باقي الجداول فوق — يعني كانت بتتراكم من غير أي تنظيف تلقائي، بتزيد
    // صف واحد على الأقل (أو أكتر) كل رن، لحد ما تصبح مشكلة أداء حقيقية على
    // مدار الوقت. بدل ما نحذف بشرط وقت لوحده (خطر: ممكن يمسح نسخة حقيقية
    // عملها أدمن فعلي بالصدفة في نفس اللحظة)، بنحدد الـtenant_id بتاع
    // حساب E2E_TEST_EMAIL نفسه أولاً عن طريق profiles — فالحذف مقصور
    // على نسخ التينانت التجريبي فقط.
    //
    // ⚠️ FIX (تنظيف تام — 8 أغسطس 2026): شيلنا شرط `startTime` من هنا
    // كمان (نفس سبب باقي الجداول فوق — كان بيمنع تنظيف بقايا رنّات
    // فشلت قبل كده). الحماية دلوقتي مقصورة على tenant_id بتاع E2E بس.
    const e2eEmail = process.env.E2E_TEST_EMAIL;
    if (!e2eEmail) {
      console.warn('  ⚠️ E2E_TEST_EMAIL مش موجود — تخطّي تنظيف backups.');
    } else {
      const { data: e2eProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('email', e2eEmail)
        .maybeSingle();
      if (profileErr || !e2eProfile?.tenant_id) {
        console.warn('  ⚠️ تعذر تحديد tenant_id بتاع حساب E2E — تخطّي تنظيف backups.');
      } else {
        const { error: backupsErr, count: backupsCount } = await supabase
          .from('backups')
          .delete({ count: 'exact' })
          .eq('tenant_id', e2eProfile.tenant_id);
        if (backupsErr) console.warn('  ⚠️ فشل حذف من backups:', backupsErr.message);
        counts.backups = backupsCount ?? 0;
      }
    }

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
