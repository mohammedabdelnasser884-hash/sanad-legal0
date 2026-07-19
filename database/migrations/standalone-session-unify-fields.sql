-- ══════════════════════════════════════════════════════
--  Migration: توحيد حقول درجة التقاضي + قاعة سكرتير الجلسة +
--  اسم/موبايل السكرتير بين case_sessions و cases، عشان لما
--  الجلسة المستقلة تتحول لقضية مايحصلش تعارض أو فقدان بيانات.
--
--  case_sessions: كان عندها session_floor/session_hall منفصلين
--  (نفس النمط القديم اللي اتشال من cases قبل كده). من دلوقتي
--  session_hall هو الحقل الموحّد الوحيد (نص واحد "الدور الأول -
--  قاعة 5") زي بالظبط cases.session_hall. session_floor القديم
--  بيتسيب من غير مسح لأي بيانات قديمة محفوظة فيه، بس مش هيتكتب
--  فيه تاني من الفورم.
--
--  secretary_mobile: عمود جديد خالص، مش موجود في أي جدول قبل كده.
--
--  نفّذ هذا الملف في Supabase SQL Editor مرة واحدة فقط
--  الأمر IF NOT EXISTS آمن — لو العمود موجود يتجاهله
-- ══════════════════════════════════════════════════════

ALTER TABLE case_sessions
  ADD COLUMN IF NOT EXISTS court_level      text,
  ADD COLUMN IF NOT EXISTS secretary_hall   text,
  ADD COLUMN IF NOT EXISTS secretary_name   text,
  ADD COLUMN IF NOT EXISTS secretary_mobile text;

ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS secretary_mobile text;
