-- ============================================================
-- خطة تفكيك legacy columns — F.4 (خطوة 2/2): الحذف الفعلي
-- ============================================================
-- ⚠️ غير قابل للتراجع. شغّل ده بس بعد ما راجعت نتيجة
-- 01-verify-before-drop.sql وكانت النتايج زي المتوقع (بند 1 و2
-- فاضيين، وبند 4 رجع 0 على الجدولين).
--
-- ده مش بديل عن باك أب. لو معندكش نقطة استرجاع (Point-in-Time
-- Recovery) مفعّلة على المشروع في Supabase، خد باك أب يدوي للجدولين
-- الأول:
--   pg_dump --table=cases --table=case_sessions ...
-- أو من لوحة Supabase: Database → Backups.
--
-- الأعمدة بترجع من قراءة src/database.types.ts مباشرة (مش من الذاكرة)
-- تاريخ 6 أغسطس 2026، للتأكد من مطابقة الأعمدة الفعلية في الجدولين.
-- ============================================================

BEGIN;

-- cases (10 أعمدة)
ALTER TABLE public.cases
  DROP COLUMN IF EXISTS plaintiff,
  DROP COLUMN IF EXISTS plaintiff_role,
  DROP COLUMN IF EXISTS plaintiff_national_id,
  DROP COLUMN IF EXISTS plaintiff_power_of_attorney,
  DROP COLUMN IF EXISTS plaintiff_address,
  DROP COLUMN IF EXISTS plaintiff_legal_title,
  DROP COLUMN IF EXISTS defendant,
  DROP COLUMN IF EXISTS defendant_role,
  DROP COLUMN IF EXISTS defendant_national_id,
  DROP COLUMN IF EXISTS defendant_legal_title;

-- case_sessions (9 أعمدة — مفيش plaintiff_address هنا أصلاً)
ALTER TABLE public.case_sessions
  DROP COLUMN IF EXISTS plaintiff,
  DROP COLUMN IF EXISTS plaintiff_role,
  DROP COLUMN IF EXISTS plaintiff_national_id,
  DROP COLUMN IF EXISTS plaintiff_power_of_attorney,
  DROP COLUMN IF EXISTS plaintiff_legal_title,
  DROP COLUMN IF EXISTS defendant,
  DROP COLUMN IF EXISTS defendant_role,
  DROP COLUMN IF EXISTS defendant_national_id,
  DROP COLUMN IF EXISTS defendant_legal_title;

COMMIT;

-- ── تحقق بعد الحذف (شغّله بعد الـCOMMIT فوق) ──
SELECT
  'cases_remaining=' || (
    SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'cases' AND column_name IN (
      'plaintiff','plaintiff_role','plaintiff_national_id','plaintiff_power_of_attorney',
      'plaintiff_address','plaintiff_legal_title','defendant','defendant_role',
      'defendant_national_id','defendant_legal_title'
    )
  )
  || ' || case_sessions_remaining=' || (
    SELECT count(*) FROM information_schema.columns
    WHERE table_name = 'case_sessions' AND column_name IN (
      'plaintiff','plaintiff_role','plaintiff_national_id','plaintiff_power_of_attorney',
      'plaintiff_legal_title','defendant','defendant_role',
      'defendant_national_id','defendant_legal_title'
    )
  ) AS drop_verification;
-- النتيجة المتوقعة: cases_remaining=0 || case_sessions_remaining=0
