-- ══════════════════════════════════════════════════════════════════
--  Migration: CHECK constraints على القيم المالية (M-4 —
--  Enterprise-Reliability-Audit-2)
--
--  المشكلة: تدقيق information_schema.check_constraints (المرحلة 0،
--  البند 0.4) أكّد إن case_fees/fee_payments معندهمش أي قيد على القيم
--  الرقمية غير NOT NULL التلقائية + قيد status. يعني قيمة سالبة في
--  total_fees/paid_fees/amount ممكن تتسجل من أي مسار (كود فيه باج،
--  استيراد بيانات، تعديل مباشر من SQL Editor) من غير أي رفض من القاعدة.
--
--  ⚠️ قرار عمل محسوم (21 يوليو 2026 — يخص H-4 وبيأثر على نطاق القيد
--  ده): مسموح إن paid_fees يتجاوز total_fees ("دفعة زيادة" مقبولة
--  بالسلوك الحالي، تحذير بس من غير منع في الفرونت إند). فبالتالي القيد
--  هنا بيمنع الحالات الشاذة فقط (قيم سالبة) ومش بيمنع paid_fees >
--  total_fees — ده مش خطأ، ده قرار عمل صريح.
--
--  الحل: قيود CHECK بسيطة تمنع القيم السالبة فقط، كخط دفاع أخير على
--  مستوى القاعدة (بنفس فلسفة الـ UNIQUE indexes المطبّقة على
--  clients/cases). الملف Idempotent — آمن يتشغل أكتر من مرة.
-- ══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_fees_total_fees_non_negative'
  ) THEN
    ALTER TABLE case_fees
      ADD CONSTRAINT case_fees_total_fees_non_negative CHECK (total_fees >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_fees_paid_fees_non_negative'
  ) THEN
    ALTER TABLE case_fees
      ADD CONSTRAINT case_fees_paid_fees_non_negative CHECK (paid_fees >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fee_payments_amount_non_negative'
  ) THEN
    ALTER TABLE fee_payments
      ADD CONSTRAINT fee_payments_amount_non_negative CHECK (amount >= 0);
  END IF;
END $$;

-- ══════════════════════════════════════════════════════════════════
-- استعلام تحقق نهائي: يفترض يطلع 0 لو القيود التلاتة موجودة فعليًا.
-- ⚠️ لو رجع أي عدد أكبر من 0 هنا (يعني ADD CONSTRAINT فشل)، الاحتمال
-- الأرجح إن فيه صفوف موجودة بالفعل بقيم سالبة — لازم تتصلّح يدويًا
-- الأول (UPDATE) قبل ما تعيد تشغيل الملف ده.
-- ══════════════════════════════════════════════════════════════════
SELECT count(*) AS "قيود_مالية_ناقصة" FROM (
  VALUES
    ('case_fees_total_fees_non_negative'),
    ('case_fees_paid_fees_non_negative'),
    ('fee_payments_amount_non_negative')
) AS expected(name)
WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.name);
