-- ============================================================
-- توثيق قاعدة: حذف القضية نهائيًا (Hard Delete) ما يمسحش الأتعاب
-- المرتبطة بيها، وبس بيصفّر عمود case_id بتاعها (ON DELETE SET NULL).
-- ============================================================
-- السياق: القاعدة دي كانت اتعملت يدويًا على قاعدة البيانات الحية
-- على Supabase من غير ما تتسجل في أي ملف migration جوه المشروع.
-- يعني لو حد بنى القاعدة من الصفر (staging جديد مثلًا) من ملفات
-- المشروع بس، الـ constraint هيرجع للسلوك الافتراضي (CASCADE أو
-- NO ACTION حسب أول تعريف), وده هيرجّع مشكلة مسح الأتعاب مع القضية.
--
-- هذا الملف Idempotent وآمن يتشغل أكتر من مرة:
-- 1) بيدوّر على اسم الـ FK الفعلي بين case_fees.case_id و cases.id
--    (مهما كان اسمه، لأننا مش عارفين الاسم الأصلي بالظبط).
-- 2) لو لقاه ومش ON DELETE SET NULL -> يمسحه ويعيد إنشاءه صح.
-- 3) لو مالقاش FK خالص -> ينشئ واحد جديد بالسلوك الصح.
-- 4) بيتأكد إن العمود case_id نفسه nullable (شرط أساسي عشان
--    ON DELETE SET NULL يشتغل أصلًا).
-- ============================================================

DO $$
DECLARE
  fk_name text;
BEGIN
  -- تأكيد إن العمود case_id قابل لقيمة NULL
  ALTER TABLE case_fees ALTER COLUMN case_id DROP NOT NULL;

  -- البحث عن اسم الـ FK الحالي (لو موجود) بين case_fees.case_id و cases.id
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
   AND tc.table_schema = ccu.table_schema
  WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_schema = 'public'
    AND tc.table_name = 'case_fees'
    AND kcu.column_name = 'case_id'
    AND ccu.table_name = 'cases'
  LIMIT 1;

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE case_fees DROP CONSTRAINT %I', fk_name);
  END IF;

  -- إعادة إنشاء الـ FK بالسلوك الصحيح المتفق عليه: ON DELETE SET NULL
  ALTER TABLE case_fees
    ADD CONSTRAINT case_fees_case_id_fkey
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL;
END $$;

-- ============================================================
-- استعلام تحقق: شغّله لوحده في Supabase SQL Editor للتأكد إن كل حاجة
-- مضبوطة بعد تشغيل الملف ده.
-- ============================================================
SELECT
  tc.constraint_name,
  rc.delete_rule,
  (SELECT is_nullable FROM information_schema.columns
     WHERE table_name = 'case_fees' AND column_name = 'case_id') AS case_id_nullable
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'case_fees'
  AND tc.constraint_type = 'FOREIGN KEY';

-- النتيجة المتوقعة: delete_rule = 'SET NULL' و case_id_nullable = 'YES'
