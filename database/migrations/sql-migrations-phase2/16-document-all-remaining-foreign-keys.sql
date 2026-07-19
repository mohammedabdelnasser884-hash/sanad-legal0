-- ============================================================
-- توثيق شامل لكل قواعد الـ Foreign Key اللي كانت شغالة فعليًا على
-- قاعدة البيانات الحية على Supabase، لكن معمولة يدويًا ومش مسجلة في
-- أي ملف داخل المشروع. النتيجة دي طلعت من تشغيل الملف رقم 15
-- (استعلام تشخيصي بس) وتم تأكيدها يدويًا من صاحب المشروع بتاريخ
-- تشغيل هذا الملف.
--
-- هذا الملف "توثيق فقط" ولا يغيّر أي سلوك فعلي: كل قاعدة هنا موجودة
-- بالفعل بنفس الاسم ونفس السلوك على القاعدة الحية. الملف Idempotent
-- وآمن يتشغل أكتر من مرة — بيتأكد فقط إن كل قاعدة موجودة، ولو مش
-- موجودة (مثلًا على بيئة staging جديدة اتبنت من الملفات) بينشئها
-- بنفس السلوك المسجل هنا بالظبط.
--
-- ⚠️ ملحوظتين لسه محتاجين تأكيد قصد صاحب المشروع، اتسجلوا هنا "زي
-- ما هما" بدون تغيير:
--   1) laws.category_id و clients.lawyer_id سلوكهم NO ACTION، يعني
--      محاولة حذف تصنيف قانون له مواد، أو حذف محامي (profile) له
--      موكلين مسندة له، هترفض بالكامل (error) بدل ما تتصفّر/تتمسح.
--   2) profiles.tenant_id و platform_audit_logs.tenant_id سلوكهم
--      SET NULL، بعكس باقي جداول المكتب (tenant) اللي كلها CASCADE.
--      يعني لو مكتب اتمسح، حساب المحامي (profile) بيفضل موجود من
--      غير مكتب بدل ما يتمسح معاه.
-- ============================================================

DO $$
DECLARE
  fk record;
  fks text[][] := ARRAY[
    -- [الجدول, العمود, الجدول المرجعي, سلوك الحذف, اسم القاعدة]
    ARRAY['case_documents','case_id','cases','CASCADE','case_documents_case_id_fkey'],
    ARRAY['case_events','case_id','cases','CASCADE','case_events_case_id_fkey'],
    ARRAY['case_sessions','case_id','cases','CASCADE','case_sessions_case_id_fkey'],
    ARRAY['case_fees','client_id','clients','SET NULL','case_fees_client_id_fkey'],
    ARRAY['case_sessions','client_id','clients','SET NULL','case_sessions_client_id_fkey'],
    ARRAY['cases','client_id','clients','SET NULL','cases_client_id_fkey'],
    ARRAY['client_messages','client_id','clients','CASCADE','client_messages_client_id_fkey'],
    ARRAY['client_portal_sessions','client_id','clients','CASCADE','client_portal_sessions_client_id_fkey'],
    ARRAY['fee_payments','client_id','clients','SET NULL','fee_payments_client_id_fkey'],
    ARRAY['fee_payments','fee_id','case_fees','CASCADE','fee_payments_fee_id_fkey'],
    ARRAY['cases','firm_id','law_firms','CASCADE','cases_firm_id_fkey'],
    ARRAY['clients','firm_id','law_firms','CASCADE','clients_firm_id_fkey'],
    ARRAY['law_articles','law_id','laws','CASCADE','law_articles_law_id_fkey'],
    ARRAY['laws','category_id','legal_categories','NO ACTION','laws_category_id_fkey'],
    ARRAY['clients','lawyer_id','profiles','NO ACTION','clients_lawyer_id_fkey'],
    ARRAY['case_notes','tenant_id','tenants','CASCADE','case_notes_tenant_id_fkey'],
    ARRAY['case_documents','tenant_id','tenants','CASCADE','case_documents_tenant_id_fkey'],
    ARRAY['case_events','tenant_id','tenants','CASCADE','case_events_tenant_id_fkey'],
    ARRAY['case_fees','tenant_id','tenants','CASCADE','case_fees_tenant_id_fkey'],
    ARRAY['case_sessions','tenant_id','tenants','CASCADE','case_sessions_tenant_id_fkey'],
    ARRAY['cases','tenant_id','tenants','CASCADE','cases_tenant_id_fkey'],
    ARRAY['clients','tenant_id','tenants','CASCADE','clients_tenant_id_fkey'],
    ARRAY['fee_payments','tenant_id','tenants','CASCADE','fee_payments_tenant_id_fkey'],
    ARRAY['law_firms','tenant_id','tenants','CASCADE','law_firms_tenant_id_fkey'],
    ARRAY['platform_audit_logs','tenant_id','tenants','SET NULL','platform_audit_logs_tenant_id_fkey'],
    ARRAY['profiles','tenant_id','tenants','SET NULL','profiles_tenant_id_fkey'],
    ARRAY['reminders','tenant_id','tenants','CASCADE','reminders_tenant_id_fkey'],
    ARRAY['tenant_invoices','tenant_id','tenants','CASCADE','tenant_invoices_tenant_id_fkey'],
    ARRAY['tenant_usage_stats','tenant_id','tenants','CASCADE','tenant_usage_stats_tenant_id_fkey'],
    ARRAY['whatsapp_logs','tenant_id','tenants','CASCADE','whatsapp_logs_tenant_id_fkey']
  ];
  row_ text[];
BEGIN
  FOREACH row_ SLICE 1 IN ARRAY fks LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = row_[5]
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id) ON DELETE %s',
        row_[1], row_[5], row_[2], row_[3], row_[4]
      );
      RAISE NOTICE 'تم إنشاء القاعدة الناقصة: %', row_[5];
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- استعلام تحقق نهائي: يفترض يطلع 0 لو كل القواعد الـ 30 موجودة فعلًا
-- (يعني الملف كان توثيق بس ومفيش حاجة اتغيرت فعليًا).
-- ============================================================
SELECT count(*) AS "قواعد_متبقية_ناقصة" FROM (
  VALUES
    ('case_documents_case_id_fkey'), ('case_events_case_id_fkey'), ('case_sessions_case_id_fkey'),
    ('case_fees_client_id_fkey'), ('case_sessions_client_id_fkey'), ('cases_client_id_fkey'),
    ('client_messages_client_id_fkey'), ('client_portal_sessions_client_id_fkey'),
    ('fee_payments_client_id_fkey'), ('fee_payments_fee_id_fkey'),
    ('cases_firm_id_fkey'), ('clients_firm_id_fkey'), ('law_articles_law_id_fkey'),
    ('laws_category_id_fkey'), ('clients_lawyer_id_fkey'),
    ('case_notes_tenant_id_fkey'), ('case_documents_tenant_id_fkey'), ('case_events_tenant_id_fkey'),
    ('case_fees_tenant_id_fkey'), ('case_sessions_tenant_id_fkey'), ('cases_tenant_id_fkey'),
    ('clients_tenant_id_fkey'), ('fee_payments_tenant_id_fkey'), ('law_firms_tenant_id_fkey'),
    ('platform_audit_logs_tenant_id_fkey'), ('profiles_tenant_id_fkey'), ('reminders_tenant_id_fkey'),
    ('tenant_invoices_tenant_id_fkey'), ('tenant_usage_stats_tenant_id_fkey'), ('whatsapp_logs_tenant_id_fkey')
) AS expected(name)
WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.name);
