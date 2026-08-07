-- ============================================================
-- خطة تفكيك legacy columns — F.4 (خطوة 1/2): تحقق قبل الـDROP
-- نسخة مبسّطة — بدون أي وصول لجداول نظام Postgres (pg_proc/
-- pg_depend/pg_class) لأن محرر SQL بتاع Supabase عندك بيرجّع خطأ
-- array_agg غريب عليها (باج معروف مش له علاقة بمنطق الاستعلام).
-- الاستعلام ده كله على جداولك أنت (cases/case_sessions) بس.
-- READ-ONLY بالكامل — صفر خطر من تشغيله.
-- ============================================================

SELECT string_agg(check_name || ' = ' || result, E'\n' ORDER BY check_name) AS summary FROM (
  SELECT 'cases_plaintiff_not_null' AS check_name, count(*)::text AS result FROM cases WHERE plaintiff IS NOT NULL
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
  -- الأهم: صفوف *جديدة* اتعملت بعد إيقاف الكتابة (F.1/F.2/F.3،
  -- 6 أغسطس 2026) ولسه قيمها موجودة في الأعمدة القديمة — لازم 0
  SELECT 'cases_new_rows_with_plaintiff_after_20260806', count(*)::text
    FROM cases WHERE plaintiff IS NOT NULL AND created_at > '2026-08-06'
  UNION ALL
  SELECT 'case_sessions_new_rows_with_plaintiff_after_20260806', count(*)::text
    FROM case_sessions WHERE plaintiff IS NOT NULL AND created_at > '2026-08-06'
) t;

-- ── تفسير النتيجة ──
-- cases_total_rows / case_sessions_total_rows وباقي عدادات not_null:
--   أرقام طبيعية (مش لازم صفر) — دي بيانات قديمة من قبل الخطة
-- cases_new_rows_with_plaintiff_after_20260806 = 0  ← الأهم
-- case_sessions_new_rows_with_plaintiff_after_20260806 = 0  ← الأهم
--   لو الاتنين دول صفر، يبقى مفيش صف جديد اتكتب على الأعمدة القديمة
--   بعد ما وقفنا الكتابة.
--
-- ── فحص views/functions المعتمدة على الأعمدة (بديل يدوي) ──
-- بما إن محرر الـSQL مش قادر يشغّل استعلامات pg_catalog دلوقتي، الفحص
-- ده أضمن تعمله من تبويب Database → Functions و Database → Views في
-- لوحة Supabase نفسها (بحث بصري بكلمة "plaintiff"/"defendant" في أسماء
-- وأكواد الـfunctions/views الموجودة)، بدل الاستعلام النصي. لو مفيش
-- functions/views مخصصة عندك أصلًا (غالبًا كل المنطق في الفرونت إند
-- زي باقي المشروع)، الخطوة دي مش هتلاقي حاجة أصلاً وممكن تتخطاها.
