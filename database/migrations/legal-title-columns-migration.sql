-- ══════════════════════════════════════════════════════
--  Migration: إضافة "المسمى القانوني" (Legal Title) للطرف
--
--  المرحلة 1 من خطة تطوير أطراف الدعوى — راجع الملف:
--  "مفهوم-تطوير-اطراف-الدعوي-الخطة-الكاملة-v2.md" (بند 6-أ، بند 7)
--
--  السبب: عند وجود أكثر من شخص تحت طرف واحد (كالورثة أو الشركاء)،
--  لا يوجد حاليًا موضع لإثبات المسمى الجامع لهذا الطرف (مثل "ورثة
--  المرحوم أحمد علي"). جدول case_parties يمثل كل صف فيه شخصًا واحدًا،
--  فلا يصلح لتخزين بيانات تخص "الطرف بأكمله" دون تكرار. لذلك يُضاف
--  العمود على مستوى جدولي cases و case_sessions مباشرة، على غرار
--  عمودي plaintiff_role/defendant_role الموجودين فعلًا.
--
--  ⚠️ هذه الهجرة آمنة تمامًا: إضافة أعمدة جديدة قابلة لأن تكون NULL
--  فقط، بدون أي تعديل أو حذف على بيانات قائمة. لا تؤثر على أي قضية
--  أو جلسة موجودة حاليًا، ولا تتطلب أي خطوة تراجع (rollback) معقدة.
--
--  خطوات التنفيذ: انسخ الكود بالكامل وشغّله دفعة واحدة في
--  Supabase SQL Editor (لوحة تحكم Supabase ← SQL Editor ← New query).
-- ══════════════════════════════════════════════════════

-- ── (1) جدول القضايا (cases) ──
ALTER TABLE cases
  ADD COLUMN IF NOT EXISTS plaintiff_legal_title text,
  ADD COLUMN IF NOT EXISTS defendant_legal_title text;

COMMENT ON COLUMN cases.plaintiff_legal_title IS
  'المسمى القانوني الجامع لطرف المدعي عند تعدد الأشخاص تحته (مثل: ورثة المرحوم فلان). فارغ إذا كان الطرف شخصًا واحدًا أو شخصية اعتبارية واحدة.';
COMMENT ON COLUMN cases.defendant_legal_title IS
  'المسمى القانوني الجامع لطرف المدعى عليه عند تعدد الأشخاص تحته. فارغ إذا كان الطرف شخصًا واحدًا أو شخصية اعتبارية واحدة.';

-- ── (2) جدول الجلسات المستقلة (case_sessions) — نفس النمط بالتوازي ──
ALTER TABLE case_sessions
  ADD COLUMN IF NOT EXISTS plaintiff_legal_title text,
  ADD COLUMN IF NOT EXISTS defendant_legal_title text;

COMMENT ON COLUMN case_sessions.plaintiff_legal_title IS
  'المسمى القانوني الجامع لطرف المدعي عند تعدد الأشخاص تحته (جلسة مستقلة). فارغ إذا كان الطرف شخصًا واحدًا.';
COMMENT ON COLUMN case_sessions.defendant_legal_title IS
  'المسمى القانوني الجامع لطرف المدعى عليه عند تعدد الأشخاص تحته (جلسة مستقلة). فارغ إذا كان الطرف شخصًا واحدًا.';

-- ── (3) تحقق سريع بعد التنفيذ — يجب أن يظهر العمودين الجديدين في كل جدول ──
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name IN ('cases', 'case_sessions')
  AND column_name IN ('plaintiff_legal_title', 'defendant_legal_title')
ORDER BY table_name, column_name;
