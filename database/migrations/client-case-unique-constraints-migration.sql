-- ══════════════════════════════════════════════════════
--  Migration: UNIQUE indexes نهائية — منع تكرار الموكل ورقم القضية
--  نفّذ هذا الملف في Supabase SQL Editor
--  (تقرير الموثوقية — نتيجة 3)
--
--  المشكلة قبل هذا الملف:
--  فحوصات التكرار الحالية (checkClientDuplicate / checkCaseNumberDuplicate)
--  كلها SELECT منفصل عن INSERT — من غير transaction، ومن غير أي UNIQUE
--  index في الداتابيز. ده بيسيب نافذة TOCTOU (Time-Of-Check to
--  Time-Of-Use) نظريًا مفتوحة: لو طلبين وصلوا للسيرفر في نفس اللحظة
--  بالظبط، الاتنين ممكن يعملوا SELECT ويشوفوا "مفيش تكرار" قبل ما أي
--  واحد فيهم يعمل INSERT فعلي. وكمان — وده الأهم عمليًا — مسار الكتابة
--  الأوفلاين (offlineQueue.ts) بيتخطى فحص التكرار بالكامل وقت الحفظ
--  المحلي (مفيش نت وقتها أصلاً)، وبيعتمد بس على الفحص اللي حصل في
--  الفورم وقت الإدخال؛ لو المستخدم فتح نفس الفورم في أكتر من تبويب/جهاز
--  أوفلاين، أو حصل أي سيناريو تاني غير متوقع، مفيش حد أخير يمنع التكرار.
--
--  الحل:
--  UNIQUE index جزئي (partial) لكل حالة — بيتجاهل الصفوف المؤرشفة
--  (deleted_at IS NOT NULL) والقيم الفاضية (IS NOT NULL)، وبيقارن
--  case-insensitive (lower()) عشان يطابق نفس منطق الفحص في الكود:
--    1. clients(tenant_id, national_id) — رقم قومي واحد لكل مكتب.
--    2. clients(tenant_id, lower(client_name)) — client_name هو العمود
--       المضمون امتلاؤه دايمًا من كل مسارات إضافة/تعديل الموكل (بعكس
--       full_name اللي كان بيتكتب في مسار واحد بس قبل التوحيد — راجع
--       migration 02-clients-full-name-sync.sql).
--    3. cases(tenant_id, lower(case_number_official), lower(court_level),
--       lower(case_type)) — رقم قيد واحد لكل مكتب، *بشرط* نفس المحكمة ونفس
--       نوع الدعوى مع بعض. تصحيح متعمد (19/20 يوليو 2026): النسخة الأولى من
--       الملف ده كانت بتعتبر رقم القيد لوحده كافي — ده غلط، لأن قضيتين
--       منفصلتين تمامًا (موكلين مختلفين، موضوع مختلف) ممكن يتصادفوا بنفس
--       رقم القيد لو كانوا في محكمة مختلفة أو نوع دعوى مختلف، وده مش تكرار
--       حقيقي خالص. راجع مثال فعلي اتكشف وقت تشغيل استعلامات التحقق (خطوة
--       0 تحت): رقم 4445/2026 مسجل مرتين لقضيتين حقيقيتين مختلفتين (إداري
--       وموكل، ومدني وموكل تاني) — الاتنين أرقامهم صح، والمشكلة كانت في
--       تعريف "التكرار" نفسه مش في البيانات.
--
--  ⚠️ الضمانة دي مكمّلة لفحص الكود، مش بديلة عنه — الفحص في الكود
--  (checkClientDuplicate / checkCaseNumberDuplicate) بيدي المستخدم رسالة
--  واضحة ومباشرة قبل أي محاولة كتابة. الـ index هنا هو خط الدفاع الأخير
--  اللي بيمنع التكرار فعليًا حتى لو فيه ثغرة تانية غير متوقعة في الكود
--  أو في مسار الأوفلاين — الكتابة هترجع خطأ (Postgres error code 23505)
--  بدل ما تنجح بصمت، والكود (useClientActions.ts / useCaseActions.ts)
--  اتحدّث ليمسك الخطأ ده ويعرض نفس رسالة "موجود بالفعل" للمستخدم.
-- ══════════════════════════════════════════════════════

-- ── خطوة 0 (لازم تتعمل يدويًا الأول): تأكد إنه مفيش تكرار موجود بالفعل ──
-- لو أي كويري من التلاتة دي رجّعت أي صف، لازم تراجع الصفوف دي وتحلها
-- يدويًا (دمج/تعديل/أرشفة) قبل ما تكمل لخطوة إنشاء الـ index — لو فيه
-- تكرار موجود فعلاً وقت التنفيذ، أمر CREATE UNIQUE INDEX هيفشل برسالة
-- خطأ واضحة (duplicate key value)، وده متوقع ومقصود (حماية من كسر
-- الداتابيز على تكرار موجود من غير ما تعرف مكانه).

-- تكرار رقم قومي (نفس المكتب، غير مؤرشف):
SELECT tenant_id, national_id, count(*), array_agg(id) AS client_ids
FROM clients
WHERE national_id IS NOT NULL AND deleted_at IS NULL
GROUP BY tenant_id, national_id
HAVING count(*) > 1;

-- تكرار اسم موكل (نفس المكتب، غير مؤرشف، case-insensitive):
SELECT tenant_id, lower(client_name), count(*), array_agg(id) AS client_ids
FROM clients
WHERE client_name IS NOT NULL AND deleted_at IS NULL
GROUP BY tenant_id, lower(client_name)
HAVING count(*) > 1;

-- تكرار رقم قيد قضية (نفس المكتب، نفس المحكمة، نفس نوع الدعوى، غير مؤرشفة،
-- case-insensitive) — الأربعة مع بعض، مش رقم القيد لوحده (راجع الشرح فوق):
SELECT tenant_id, lower(case_number_official), lower(coalesce(court_level,'')), lower(coalesce(case_type,'')), count(*), array_agg(id) AS case_ids
FROM cases
WHERE case_number_official IS NOT NULL AND deleted_at IS NULL
GROUP BY tenant_id, lower(case_number_official), lower(coalesce(court_level,'')), lower(coalesce(case_type,''))
HAVING count(*) > 1;

-- ── خطوة 1: الـ UNIQUE indexes الفعلية ──
-- ⚠️ متنفذش الجزء ده إلا بعد ما تتأكد إن الكويريهات فوق رجّعت صفوف صفر.

DROP INDEX IF EXISTS idx_clients_tenant_national_id_unique;
CREATE UNIQUE INDEX idx_clients_tenant_national_id_unique
  ON clients(tenant_id, national_id)
  WHERE national_id IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS idx_clients_tenant_client_name_unique;
CREATE UNIQUE INDEX idx_clients_tenant_client_name_unique
  ON clients(tenant_id, lower(client_name))
  WHERE client_name IS NOT NULL AND deleted_at IS NULL;

DROP INDEX IF EXISTS idx_cases_tenant_case_number_unique;
CREATE UNIQUE INDEX idx_cases_tenant_case_number_unique
  ON cases(tenant_id, lower(case_number_official), lower(coalesce(court_level,'')), lower(coalesce(case_type,'')))
  WHERE case_number_official IS NOT NULL AND deleted_at IS NULL;

-- ── ملحوظة عن رقم التوكيل (cr_number) ──
-- فحص تكرار التوكيل في الكود (checkClientDuplicate) بيقارن جزء من النص
-- بس (رقم + حرف + سنة، مع تجاهل مكتب التوثيق) عن طريق تفكيك النص في
-- الكود نفسه (parsePoaString) — مش مطابقة نصية كاملة على العمود. الـ
-- منطق ده معقّد بما يكفي إنه ميترجمش لـ UNIQUE index بسيط على العمود
-- الخام من غير دالة SQL مخصصة تكرر نفس منطق parsePoaString. اتسيب
-- خارج نطاق الـ migration ده — فحص الكود (SELECT قبل الكتابة) هو خط
-- الدفاع الوحيد لتكرار التوكيل حاليًا، ونفس الأمر لتكرار "الاسم أو
-- التوكيل" مجتمعين (OR) — الـ index هنا بيغطي national_id وclient_name
-- كل واحد لوحده بس.
