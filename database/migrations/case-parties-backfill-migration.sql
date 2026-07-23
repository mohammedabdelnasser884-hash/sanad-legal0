-- ============================================================
-- Migration: Backfill case_parties (المرحلة 2 من خطة تعدد الأطراف)
-- التاريخ: 22 يوليو 2026
-- الغرض: نقل بيانات plaintiff/defendant الحالية من cases و case_sessions
-- كصفين (مدعي + مدعى عليه) لكل قضية/جلسة موجودة فعلاً إلى case_parties.
--
-- القرار المتفق عليه (خيار أ، قسم 10 من التقرير — كل البيانات الحالية
-- تجريبية 100%): المدعي دايمًا is_client=true تلقائيًا في كل صفوف الـ
-- backfill القديمة. هذا القرار مبني على إن البيانات الحالية تجريبية بالكامل
-- — مش قرار عام صالح لأي backfill حقيقي مستقبلي (راجع الملاحظة في قسم 10).
--
-- capacity الافتراضية لو role الأصلي فاضي: "مدعي"/"مدعى عليه" (نفس side
-- كنص افتراضي)، بناءً على نتيجة ملحق (هـ) (336/331 قضية، 7/7 جلسات فاضية).
--
-- ⚠️ صفوف بدون اسم (plaintiff/defendant فاضي أو NULL) بيتم تجاهلها تلقائيًا
-- (name NOT NULL على case_parties) — مفيش صف فاضي هيتسجل.
--
-- ⚠️ ملاحظة غير مذكورة صراحة في التقرير الأصلي: cases.tenant_id/
-- case_sessions.tenant_id Nullable فعليًا (موثّق في قسم 3). لو فيه صفوف
-- بـ tenant_id = NULL، الـ INSERT هيتجاهلها (WHERE tenant_id IS NOT NULL)
-- عشان محدش يخالف NOT NULL على case_parties.tenant_id — التريجر
-- set_tenant_id_from_profile() بيعتمد على بروفايل المستخدم الحالي وقت
-- auth، ومش هيلاقي حد وهو شغال جوه SQL Editor كـ postgres، فمينفعش
-- نعتمد عليه هنا كبديل. لو الاستعلام تحت رجّع عدد أكبر من صفر، محتاجين
-- قرار صريح منك قبل ما نكمل (بيانات هتتفقد من الـ backfill).
-- ============================================================

-- تحقق أولًا: هل فيه صفوف tenant_id فاضي هتتجاهل من الـ backfill؟
SELECT
    (SELECT count(*) FROM cases WHERE deleted_at IS NULL AND tenant_id IS NULL) AS cases_null_tenant,
    (SELECT count(*) FROM case_sessions WHERE tenant_id IS NULL) AS sessions_null_tenant;

-- ============================================================
-- 1) cases — صف المدعي (plaintiff)
-- ============================================================
INSERT INTO case_parties (tenant_id, case_id, side, is_client, name, capacity, national_id, address, power_of_attorney, sort_order)
SELECT
    c.tenant_id,
    c.id,
    'plaintiff',
    true,
    btrim(c.plaintiff),
    COALESCE(NULLIF(btrim(c.plaintiff_role), ''), 'مدعي'),
    NULLIF(btrim(c.plaintiff_national_id), ''),
    NULLIF(btrim(c.plaintiff_address), ''),
    NULLIF(btrim(c.plaintiff_power_of_attorney), ''),
    0
FROM cases c
WHERE c.deleted_at IS NULL
  AND c.tenant_id IS NOT NULL
  AND c.plaintiff IS NOT NULL
  AND btrim(c.plaintiff) <> '';

-- ============================================================
-- 2) cases — صف المدعى عليه (defendant)
-- ============================================================
INSERT INTO case_parties (tenant_id, case_id, side, is_client, name, capacity, national_id, address, power_of_attorney, sort_order)
SELECT
    c.tenant_id,
    c.id,
    'defendant',
    false,
    btrim(c.defendant),
    COALESCE(NULLIF(btrim(c.defendant_role), ''), 'مدعى عليه'),
    NULLIF(btrim(c.defendant_national_id), ''),
    NULL,   -- defendant_address مش موجود أصلًا في السكيمة القديمة (قسم 3)
    NULL,   -- defendant_power_of_attorney مش موجود أصلًا في السكيمة القديمة
    1
FROM cases c
WHERE c.deleted_at IS NULL
  AND c.tenant_id IS NOT NULL
  AND c.defendant IS NOT NULL
  AND btrim(c.defendant) <> '';

-- ============================================================
-- 3) case_sessions — صف المدعي (plaintiff)
-- ============================================================
INSERT INTO case_parties (tenant_id, session_id, side, is_client, name, capacity, national_id, address, power_of_attorney, sort_order)
SELECT
    s.tenant_id,
    s.id,
    'plaintiff',
    true,
    btrim(s.plaintiff),
    COALESCE(NULLIF(btrim(s.plaintiff_role), ''), 'مدعي'),
    NULLIF(btrim(s.plaintiff_national_id), ''),
    NULL,   -- case_sessions أصلًا مفيهاش عمود plaintiff_address (قسم 3)
    NULLIF(btrim(s.plaintiff_power_of_attorney), ''),
    0
FROM case_sessions s
WHERE s.tenant_id IS NOT NULL
  AND s.plaintiff IS NOT NULL
  AND btrim(s.plaintiff) <> '';

-- ============================================================
-- 4) case_sessions — صف المدعى عليه (defendant)
-- ============================================================
INSERT INTO case_parties (tenant_id, session_id, side, is_client, name, capacity, national_id, address, power_of_attorney, sort_order)
SELECT
    s.tenant_id,
    s.id,
    'defendant',
    false,
    btrim(s.defendant),
    COALESCE(NULLIF(btrim(s.defendant_role), ''), 'مدعى عليه'),
    NULLIF(btrim(s.defendant_national_id), ''),
    NULL,
    NULL,
    1
FROM case_sessions s
WHERE s.tenant_id IS NOT NULL
  AND s.defendant IS NOT NULL
  AND btrim(s.defendant) <> '';

-- ============================================================
-- 5) استعلام تحقق نهائي بعد التنفيذ
-- ============================================================
SELECT
    (SELECT count(*) FROM case_parties WHERE case_id IS NOT NULL) AS case_party_rows,
    (SELECT count(*) FROM case_parties WHERE session_id IS NOT NULL) AS session_party_rows,
    (SELECT count(*) FROM case_parties) AS total_party_rows;
