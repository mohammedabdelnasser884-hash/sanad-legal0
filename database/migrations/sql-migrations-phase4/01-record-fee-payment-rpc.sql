-- ══════════════════════════════════════════════════════════════════
--  Migration: record_fee_payment() — تسجيل دفعة أتعاب كعملية ذرّية
--  (H-2 — Enterprise-Reliability-Audit-2، المرحلة 4)
--
--  المشكلة: handleAddPayment في useFeesActions.ts كان بيعمل 3 استعلامات
--  منفصلة من الفرونت إند (insert فى fee_payments → select لإعادة حساب
--  الإجمالي → update على case_fees.paid_fees) من غير أي transaction
--  حقيقية بينهم. فشل شبكة بين الخطوة 1 والخطوة 3 (شائع جدًا فى استخدام
--  ميداني بالموبايل) كان بيسيب الدفعة متسجلة فعليًا فى fee_payments
--  بينما case_fees.paid_fees/status ما اتحدثوش — partial save موثّق
--  فى الكود نفسه (رسالة "تم تسجيل الدفعة لكن فشل تحديث الإجمالي").
--
--  الحل: الخطوات التلاتة بقت جوه دالة Postgres واحدة (RPC) تتنفذ فى
--  transaction حقيقية على مستوى القاعدة — إما تنجح كلها أو ترجع كلها
--  (rollback تلقائي لو حصل أي خطأ فى أي خطوة).
--
--  ⚠️ قرار عمل H-4 (محسوم 21 يوليو 2026، مطبّق هنا كخط دفاع أخير زي ما
--  طلبت خطة المرحلة 4 — البند 4.2): دفعة أكبر من المتبقي مسموحة
--  ("دفعة زيادة" سلوك عمل مقصود، تحذير بس فى الفرونت إند من غير منع).
--  الدالة هنا **ماتمنعش** تجاوز المتبقي — بتمنع بس مبلغ صفر أو سالب
--  (خطأ إدخال واضح)، اتساقًا مع CHECK constraints المرحلة 3 (3.3) اللي
--  بتمنع القيم السالبة فقط مش paid_fees > total_fees.
--
--  حل تعارض تحديث client_name/client_id: الكود الأصلي فى الفرونت إند
--  كان بيحدّث الحقلين مع بعض بس لو أي واحد فيهم مُدخل (بما فيها حالة
--  الإدخال اليدوي اللي بتفضّل بمقصد client_id = NULL) — نفس المنطق
--  بالظبط اتنقل هنا (CASE WHEN p_client_name IS NOT NULL OR p_client_id
--  IS NOT NULL) بدل COALESCE عشان منغيّرش سلوك حالة "إدخال يدوي".
--
--  الملف Idempotent (CREATE OR REPLACE) — آمن يتشغل أكتر من مرة.
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.record_fee_payment(
  p_fee_id       uuid,
  p_amount       numeric,
  p_payment_date date,
  p_notes        text,
  p_received_by  text,
  p_client_id    uuid,
  p_client_name  text
)
 RETURNS case_fees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_fee   case_fees;
  v_paid  numeric;
  v_status text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'المبلغ يجب أن يكون أكبر من صفر';
  END IF;

  -- ⚠️ تأكد إن سجل الأتعاب ده تابع فعلاً لمكتب المستخدم المستدعي
  -- (أو المستدعي سوبر أدمن) — نفس نمط set_portal_pin، لازم لأن
  -- الدالة SECURITY DEFINER (بتتخطى RLS، فالتحقق لازم يبقى صريح هنا).
  SELECT * INTO v_fee FROM case_fees
    WHERE id = p_fee_id
      AND (tenant_id = current_tenant_id() OR is_super_admin());
  IF NOT FOUND THEN
    RAISE EXCEPTION 'سجل الأتعاب غير موجود أو خارج نطاق مكتبك';
  END IF;

  INSERT INTO fee_payments (fee_id, amount, payment_date, notes, received_by, client_id, client_name, tenant_id)
  VALUES (p_fee_id, p_amount, COALESCE(p_payment_date, CURRENT_DATE), p_notes, p_received_by, p_client_id, p_client_name, v_fee.tenant_id);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM fee_payments WHERE fee_id = p_fee_id;

  v_status := CASE
    WHEN COALESCE(v_fee.total_fees, 0) <= 0 THEN 'open'
    WHEN v_paid >= v_fee.total_fees THEN 'collected'
    ELSE 'deferred'
  END;

  UPDATE case_fees SET
    paid_fees = v_paid,
    status = v_status,
    -- نفس منطق الفرونت إند الأصلي: يتحدّث الاتنين مع بعض بس لو فيه
    -- قيمة جاية من أي منهم (بما فيها NULL مقصودة فى حالة الإدخال اليدوي)
    client_name = CASE WHEN p_client_name IS NOT NULL OR p_client_id IS NOT NULL THEN p_client_name ELSE client_name END,
    client_id   = CASE WHEN p_client_name IS NOT NULL OR p_client_id IS NOT NULL THEN p_client_id   ELSE client_id   END,
    last_payment_date = COALESCE(p_payment_date, last_payment_date),
    updated_at = now()
  WHERE id = p_fee_id
  RETURNING * INTO v_fee;

  RETURN v_fee;
END;
$function$;

-- قفل التنفيذ على authenticated بس (نفس نمط set_portal_pin — شيل anon و PUBLIC)
REVOKE EXECUTE ON FUNCTION public.record_fee_payment(uuid, numeric, date, text, text, uuid, text)
  FROM anon, PUBLIC;

-- ── خطوة تأكيد بعد التنفيذ ──
--   SELECT grantee, privilege_type FROM information_schema.routine_privileges
--   WHERE routine_name = 'record_fee_payment';
-- المتوقع: authenticated و service_role و postgres بس (من غير anon/PUBLIC).
--
-- اختبار محاكاة فشل نصفي (rollback) — لتأكيد السلوك الذرّي فعليًا،
-- مؤجل لمرحلة الاختبارات الشاملة فى الآخر (4.4 من الخطة).
