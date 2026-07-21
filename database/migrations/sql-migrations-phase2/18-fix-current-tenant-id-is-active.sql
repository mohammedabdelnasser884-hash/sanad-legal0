-- ============================================================
-- FIX (تقرير الموثوقية الشامل — C-1، مرحلة 2): current_tenant_id()
-- كانت بتفحص حالة المكتب (tenants.status) بس، من غير ما تتحقق من
-- profiles.is_active. يعني موظف اتعطل حسابه (استقالة/فصل) بيفضل
-- شايف/يعدّل كل بيانات المكتب طالما جلسته (JWT) لسه سارية.
--
-- التعديل: إضافة شرط p.is_active = true، بنفس نمط "شرط + تعليق
-- شارح" المطبّق بالفعل في نفس الدالة لباقي الشروط.
--
-- ⚠️ هذا الملف بيلمس دالة مركزية يعتمد عليها كل RLS policy تقريبًا.
-- الترتيب الإلزامي قبل أي نشر فعلي:
--   1) شغّل الملف ده على بيئة staging (مش الإنتاج مباشرة).
--   2) شغّل database/tests/phase1-tenant-isolation-test.sql كامل
--      على نفس بيئة الـ staging، وتأكد إن PART G رجعت (cnt = 0)
--      بدل التحذير الحالي، وإن باقي الأجزاء (A-F) لسه عدّية
--      (regression check — التعديل ميكسرش عزل تينانت شغال حاليًا).
--   3) بعد نجاح (2) بالكامل: شغّل نفس الملف ده على القاعدة الحية.
--
-- الملف Idempotent وآمن يتشغل أكتر من مرة (CREATE OR REPLACE).
-- ============================================================

CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.tenant_id
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.user_id = auth.uid()
    -- 🔒 FIX (C-1): مستخدم معطّل (is_active=false) ميشوفش أي بيانات
    -- خالص، بغض النظر عن حالة الـ JWT/الجلسة بتاعته — ده خط الدفاع
    -- على مستوى القاعدة نفسها، مش بس على مستوى الواجهة.
    and p.is_active = true
    -- مكتب من غير status محدد (لسه مبعتش/default) → نعتبره شغال،
    -- عشان منقفلش مكاتب جديدة بالغلط لسه ما اتصنفتش
    and (t.status is null or t.status <> 'suspended')
    -- تجربة منتهية = زي الموقوف بالظبط
    and (t.status is distinct from 'trial' or t.trial_ends_at is null or t.trial_ends_at >= now())
$function$;
