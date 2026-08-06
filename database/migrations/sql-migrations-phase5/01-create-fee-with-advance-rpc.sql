-- ══════════════════════════════════════════════════════════════════
--  Migration: create_fee_with_advance() — إنشاء سجل أتعاب جديد
--  (+ دفعة مقدّمة اختيارية) كعملية ذرّية واحدة
--  (المرحلة 5 — امتداد لنفس منطق record_fee_payment فى المرحلة 4)
--
--  المشكلة: فرع "إنشاء جديد" فى handleSave (useFeesActions.ts) كان
--  بينفّذ لحد 4 استعلامات منفصلة من الفرونت إند من غير transaction
--  حقيقية بينهم:
--    1) insert فى case_fees (paid_fees=0)
--    2) insert فى fee_payments (لو فيه دفعة مقدّمة > 0)
--    3) select لإعادة حساب paid_fees من مجموع fee_payments
--    4) update على case_fees.paid_fees/status/last_payment_date
--  فشل شبكة بين الخطوة 1 والخطوة 4 (نفس سيناريو H-2 اللي اتحل فى
--  record_fee_payment) كان بيسيب سجل أتعاب متسجل بدفعة مقدّمة فى
--  fee_payments لكن case_fees.paid_fees/status لسه صفر/'open' —
--  partial save مطابق تمامًا للمشكلة اللي اتحلت فى المرحلة 4، بس هنا
--  فى مسار "الإنشاء" بدل "تسجيل دفعة على سجل موجود".
--
--  الحل: نفس النمط بالظبط — الخطوات كلها جوه دالة Postgres واحدة
--  (RPC) بتتنفذ فى transaction حقيقية على مستوى القاعدة. لو مفيش
--  دفعة مقدّمة (p_paid_amount <= 0 أو NULL) الدالة بتنشئ السجل بس
--  من غير أي insert فى fee_payments — نفس سلوك الفرونت إند الأصلي
--  (initialPaidAmount > 0 كان الشرط الوحيد لعمل insert فى fee_payments).
--
--  ⚠️ الفرق عن record_fee_payment: هنا مفيش سجل case_fees موجود
--  نتحقق منه الأول (بنعمله إحنا جوه الدالة)، فالتحقق الأمني بيبقى على
--  case_id (لازم يكون تابع لمكتب المستدعي) بدل fee_id.
--
--  الملف Idempotent (CREATE OR REPLACE) — آمن يتشغل أكتر من مرة.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.create_fee_with_advance(
  p_case_id       uuid,
  p_case_title    text,
  p_client_id     uuid,
  p_client_name   text,
  p_receiver      text,
  p_total_fees    numeric,
  p_notes         text,
  p_paid_amount   numeric,
  p_payment_date  date
)
 RETURNS case_fees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_fee     case_fees;
  v_paid    numeric;
  v_status  text;
  v_tenant  uuid;
BEGIN
  IF p_total_fees IS NULL OR p_total_fees < 0 THEN
    RAISE EXCEPTION 'إجمالي الأتعاب لا يمكن أن يكون سالباً';
  END IF;

  -- ⚠️ تأكد إن القضية دي تابعة فعلاً لمكتب المستخدم المستدعي (أو
  -- المستدعي سوبر أدمن) — نفس نمط record_fee_payment/set_portal_pin،
  -- لازم لأن الدالة SECURITY DEFINER (بتتخطى RLS، فالتحقق لازم يبقى
  -- صريح هنا). بنجيب tenant_id من نفس صف القضية عشان نستخدمه فى
  -- الإدراجات الجاية (بدل الاعتماد على trigger لو مش موجود).
  SELECT tenant_id INTO v_tenant FROM cases
    WHERE id = p_case_id
      AND (tenant_id = current_tenant_id() OR is_super_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'القضية غير موجودة أو خارج نطاق مكتبك';
  END IF;

  v_paid := CASE WHEN p_paid_amount > 0 THEN p_paid_amount ELSE 0 END;
  v_status := CASE
    WHEN COALESCE(p_total_fees, 0) <= 0 THEN 'open'
    WHEN v_paid >= p_total_fees THEN 'collected'
    ELSE 'deferred'
  END;

  INSERT INTO case_fees (
    case_id, case_title, client_id, client_name, receiver,
    total_fees, notes, paid_fees, status, tenant_id
  ) VALUES (
    p_case_id, p_case_title, p_client_id, p_client_name, p_receiver,
    p_total_fees, p_notes, 0, CASE WHEN COALESCE(p_total_fees,0) <= 0 THEN 'open' ELSE 'deferred' END, v_tenant
  ) RETURNING * INTO v_fee;

  -- دفعة مقدّمة اختيارية — نفس شرط الفرونت إند الأصلي (initialPaidAmount > 0)
  IF p_paid_amount IS NOT NULL AND p_paid_amount > 0 THEN
    INSERT INTO fee_payments (fee_id, amount, payment_date, notes, received_by, client_id, client_name, tenant_id)
    VALUES (v_fee.id, p_paid_amount, COALESCE(p_payment_date, CURRENT_DATE), 'مقدم أتعاب', p_receiver, p_client_id, p_client_name, v_tenant);

    -- إعادة حساب من مجموع fee_payments الفعلي (زي record_fee_payment
    -- بالظبط) بدل الاعتماد على p_paid_amount مباشرة — احتياط لو فيه
    -- أي إدراج آخر حصل على نفس fee_id فى نفس اللحظة (سيناريو نظري هنا
    -- لأن السجل جديد، لكن نفس النمط الموحّد فى كل مكان فى المشروع).
    SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM fee_payments WHERE fee_id = v_fee.id;

    v_status := CASE
      WHEN COALESCE(p_total_fees, 0) <= 0 THEN 'open'
      WHEN v_paid >= p_total_fees THEN 'collected'
      ELSE 'deferred'
    END;

    UPDATE case_fees SET
      paid_fees = v_paid,
      status = v_status,
      last_payment_date = COALESCE(p_payment_date, CURRENT_DATE),
      updated_at = now()
    WHERE id = v_fee.id
    RETURNING * INTO v_fee;
  END IF;

  RETURN v_fee;
END;
$function$;

-- قفل التنفيذ على authenticated بس (نفس نمط record_fee_payment — شيل anon و PUBLIC)
REVOKE EXECUTE ON FUNCTION public.create_fee_with_advance(uuid, text, uuid, text, text, numeric, text, numeric, date)
  FROM anon, PUBLIC;

-- ── خطوة تأكيد بعد التنفيذ ──
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'create_fee_with_advance';
-- المتوقع: authenticated و service_role و postgres بس (من غير anon/PUBLIC).
--
-- اختبار محاكاة فشل نصفي (rollback) — لتأكيد السلوك الذرّي فعليًا،
-- مؤجل لمرحلة الاختبارات الشاملة (نفس منهج المرحلة 4).
