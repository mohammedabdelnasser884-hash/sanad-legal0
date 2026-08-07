-- ============================================================
-- خطة تفكيك legacy columns — F.4 (خطوة 1/2): تحقق قبل الـDROP
-- شغّل الملف ده لوحده في Supabase SQL Editor وابعتلي النتيجة.
-- استعلام واحد بس (UNION ALL) عشان يرجع جدول نتايج واحد نضيف —
-- محرر Supabase بيدّي خطأ array_agg لو حاولنا نشغّل كذا SELECT
-- منفصل في نفس الوقت. READ-ONLY بالكامل — صفر خطر من تشغيله.
-- ============================================================

SELECT check_name, result FROM (
  -- 1) views/functions لسه بتعتمد على الأعمدة دي (لازم يرجع 0)
  SELECT
    'dependent_objects_count' AS check_name,
    count(*)::text AS result
  FROM pg_depend dep
  JOIN pg_class cl ON cl.oid = dep.objid
  JOIN pg_attribute attr ON attr.attrelid = dep.refobjid AND attr.attnum = dep.refobjsubid
  WHERE dep.refobjid IN ('public.cases'::regclass, 'public.case_sessions'::regclass)
    AND attr.attname IN (
      'plaintiff','plaintiff_role','plaintiff_national_id','plaintiff_power_of_attorney',
      'plaintiff_address','plaintiff_legal_title',
      'defendant','defendant_role','defendant_national_id','defendant_legal_title'
    )
    AND cl.relname NOT IN ('cases','case_sessions')

  UNION ALL

  -- 2) function bodies بتذكر الأعمدة دي بالاسم (لازم يرجع 0)
  -- ملحوظة: بنستخدم p.prosrc (نص الكود الخام) مش pg_get_functiondef()
  -- لأن الأخيرة جوه WHERE بترجّع باج قديم في Postgres/Supabase Studio
  -- (ERROR 42809 "array_agg is an aggregate function") مش له علاقة
  -- بمنطق الاستعلام نفسه.
  SELECT
    'function_body_matches_count',
    count(*)::text
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosrc ~* '\y(plaintiff|defendant)(_role|_national_id|_power_of_attorney|_address|_legal_title)?\y'

  UNION ALL

  -- 3) حجم البيانات الموجودة فعليًا (معلوماتي بس — مش المفروض صفر،
  --    فيه قضايا/جلسات قديمة من قبل الخطة، وقيمها هتتفقد بعد الـDROP)
  SELECT 'cases_plaintiff_not_null', count(*)::text FROM cases WHERE plaintiff IS NOT NULL
  UNION ALL
  SELECT 'cases_defendant_not_null', count(*)::text FROM cases WHERE defendant IS NOT NULL
  UNION ALL
  SELECT 'cases_total_rows', count(*)::text FROM cases
  UNION ALL
  SELECT 'case_sessions_plaintiff_not_null', count(*)::text FROM case_sessions WHERE plaintiff IS NOT NULL
  UNION ALL
  SELECT 'case_sessions_defendant_not_null', count(*)::text FROM case_sessions WHERE defendant IS NOT NULL
  UNION ALL
  SELECT 'case_sessions_total_rows', count(*)::text FROM case_sessions

  UNION ALL

  -- 4) الأهم: صفوف *جديدة* اتعملت بعد إيقاف الكتابة (F.1/F.2/F.3،
  --    6 أغسطس 2026) ولسه قيمها موجودة في الأعمدة القديمة — لازم 0
  SELECT 'cases_new_rows_with_plaintiff_after_20260806', count(*)::text
    FROM cases WHERE plaintiff IS NOT NULL AND created_at > '2026-08-06'
  UNION ALL
  SELECT 'case_sessions_new_rows_with_plaintiff_after_20260806', count(*)::text
    FROM case_sessions WHERE plaintiff IS NOT NULL AND created_at > '2026-08-06'
) t;

-- ── تفسير النتيجة ──
-- dependent_objects_count = 0  → مفيش views/functions معتمدة مباشرة
-- function_body_matches_count = 0 → مفيش function body بيذكر الأعمدة
--   (لو رجع رقم غير 0، ابعتلي أسماء الـfunctions قبل ما تكمل)
-- cases_total_rows / case_sessions_total_rows وباقي عدادات not_null:
--   أرقام طبيعية (مش لازم صفر) — دي بيانات قديمة من قبل الخطة
-- cases_new_rows_with_plaintiff_after_20260806 = 0  ← الأهم
-- case_sessions_new_rows_with_plaintiff_after_20260806 = 0  ← الأهم
--   لو الاتنين دول صفر، يبقى مفيش صف جديد اتكتب على الأعمدة القديمة
--   بعد ما وقفنا الكتابة، وآمن تكمل لملف 02-drop-legacy-columns.sql.
