-- خطة تسلسل الجلسة المستقلة — 3 أغسطس 2026
-- عمود جديد على case_sessions لتجميع سلسلة الجلسات الناتجة عن جلسة
-- مستقلة واحدة (عبر ضغطات "⚡ تحديث الجلسة" المتتالية). نفس معرّف
-- ثابت (وليس مرجعًا رجوعيًا) يتشارك فيه كل أعضاء السلسلة — أول جلسة
-- تتحدّث تحصل عليه، والباقي بينسخه من غير أي تغيير.
--
-- ما ينفذ بالكامل: عمود nullable + index جزئي للاستعلام السريع.
-- ما لا يحتاج backfill: الجلسات المستقلة الحالية (قبل هذا الفيكس)
-- تبقى session_group_id = NULL، وسجل التسلسل يبدأ يظهر من أول
-- "تحديث" جديد بعد نشر هذا الكود — لا يمكن إعادة بناء التسلسل
-- التاريخي المفقود قبل الفيكس لأن الرابط بين الجلسات القديمة والجديدة
-- لم يكن مُسجَّلًا في القاعدة أصلًا.

ALTER TABLE case_sessions
  ADD COLUMN IF NOT EXISTS session_group_id uuid NULL;

CREATE INDEX IF NOT EXISTS idx_case_sessions_group_id
  ON case_sessions (session_group_id)
  WHERE session_group_id IS NOT NULL;

-- استعلام تأكيد (تشغّله بعد النشر في SQL Editor بتاع Supabase):
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_name = 'case_sessions' AND column_name = 'session_group_id';
