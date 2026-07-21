-- ══════════════════════════════════════════════════════════════════
--  Migration: إنشاء FK حقيقي لـ case_notes.case_id تجاه cases.id
--  (H-5 — Enterprise-Reliability-Audit-2)
--
--  ⚠️ تصحيح بعد فشل تشغيل النسخة الأولى من هذا الملف: افتراض التقرير
--  الأصلي إن reminders عندها عمود case_id غلط. تم التحقق فعليًا من
--  `src/database.types.ts` (تعريف الجدول الحقيقي المولّد من القاعدة):
--  جدول reminders أعمدته هي id, title, due_date, notes, done,
--  created_at, tenant_id, updated_at, user_id, completed_at —
--  **مفيش عمود case_id خالص**. التذكيرات فى النظام ده مش مرتبطة
--  بقضية معينة، مرتبطة بس بـ tenant_id/user_id (تذكير عام للمحامي/
--  المكتب). فبند H-5 بخصوص "علاقة reminders.case_id" أصلًا مش موجود
--  كمشكلة — العمود نفسه مش موجود، فمفيش حاجة تتصلّح هنا. الملف ده
--  بقى يغطي case_notes.case_id بس (اللي فعلًا موجود ومؤكَّد من غير FK).
--
--  المشكلة (case_notes فقط): تدقيق كل الـ FKs الفعلية على القاعدة
--  الحية (المرحلة 0، البند 0.1 — 37 علاقة اتفحصت بالكامل) أكّد إن
--  case_notes.case_id **معندهوش أي FK constraint خالص** تجاه cases.id
--  — الجدول عنده بس FK على tenant_id. يعني حذف قضية بأي مسار غير
--  handlePermanentDeleteCase الموجود في الكود (مثلًا مباشرة من SQL
--  Editor، أو سكريبت استيراد/تصحيح بيانات مستقبلي) ممكن يسيب ملاحظات
--  يتيمة تشاور لـ case_id غير موجود، بلا أي رفض أو تصفير تلقائي من
--  القاعدة.
--
--  الحل: إضافة FK بسلوك ON DELETE CASCADE، بنفس النمط المطبّق فعليًا
--  على باقي جداول الـ case_id (case_documents, case_events,
--  case_sessions — كلهم CASCADE حسب توثيق الملف 16). يعني حذف قضية
--  هيمسح ملاحظاتها معاها تلقائيًا، بدل ما تفضل يتيمة.
--
--  ⚠️ قبل ما تشغّل الملف ده: لازم تتأكد إن مفيش صفوف حالية في
--  case_notes بتشاور لـ case_id مش موجود فعليًا في cases — استعلام
--  التحقق (0-A) تحت بيكشف كده. لو رجّع أي صفوف، لازم تتصلّح (تتمسح أو
--  الـ case_id يتصفّر) الأول، وإلا ADD CONSTRAINT هيفشل. الملف
--  Idempotent فيما عدا كده — آمن يتشغل أكتر من مرة.
-- ══════════════════════════════════════════════════════════════════

-- ─ 0-A: تحقق مبدئي (SELECT فقط) — لازم يرجع صفر صف ─
SELECT 'case_notes' AS "الجدول", count(*) AS "صفوف_يتيمة"
FROM case_notes cn
WHERE cn.case_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM cases c WHERE c.id = cn.case_id);

-- ─ إنشاء القيد (بس لو مش موجود بالفعل) ─
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_notes_case_id_fkey'
  ) THEN
    ALTER TABLE case_notes
      ADD CONSTRAINT case_notes_case_id_fkey
      FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ─ تحقق نهائي: يفترض يطلع 0 لو القيد موجود فعليًا ─
SELECT count(*) AS "قيود_ناقصة" FROM (
  VALUES ('case_notes_case_id_fkey')
) AS expected(name)
WHERE NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = expected.name);

