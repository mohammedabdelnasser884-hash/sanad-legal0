-- ============================================================
-- تغيير فعلي (مش توثيق بس): profiles.tenant_id من ON DELETE SET NULL
-- إلى ON DELETE CASCADE، عشان تتماشى مع باقي جداول المكتب (tenant)
-- زي cases و clients و case_fees وغيرهم اللي كلهم CASCADE بالفعل.
--
-- السبب: كان قبل كده لو مكتب اتمسح، حساب المحامي (profile) بيفضل
-- موجود في النظام من غير مكتب (tenant_id = NULL) — يعني حساب معلّق
-- يقدر يسجل دخول بيه من غير أي بيانات أو صلاحيات حقيقية. اتفقنا إن
-- ده مش المقصود، والأصح إن حساب المحامي يتمسح مع مكتبه زي باقي
-- بياناته بالظبط.
--
-- ⚠️ الأثر العملي: من دلوقتي، مسح أي tenant هيمسح معاه كل الـ profiles
-- (حسابات المستخدمين) التابعة له تلقائيًا. ده سلوك مقصود ومتفق عليه.
--
-- الملف Idempotent: آمن يتشغل أكتر من مرة.
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_tenant_id_fkey') THEN
    ALTER TABLE profiles DROP CONSTRAINT profiles_tenant_id_fkey;
  END IF;

  ALTER TABLE profiles
    ADD CONSTRAINT profiles_tenant_id_fkey
    FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
END $$;

-- ============================================================
-- استعلام تحقق: المفروض يطلع delete_rule = 'CASCADE'
-- ============================================================
SELECT tc.constraint_name, rc.delete_rule
FROM information_schema.table_constraints tc
JOIN information_schema.referential_constraints rc
  ON tc.constraint_name = rc.constraint_name
WHERE tc.table_name = 'profiles' AND tc.constraint_type = 'FOREIGN KEY';
