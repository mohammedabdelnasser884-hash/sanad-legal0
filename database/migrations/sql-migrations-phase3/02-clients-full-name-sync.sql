-- ══════════════════════════════════════════════════════
--  Migration: مزامنة full_name مع client_name تلقائيًا (جدول clients)
--
--  المشكلة: عمود full_name كان بيتكتب في مسار واحد بس من مسارين
--  (useSessionLinking.ts) وماكانش بيتكتب في المسار الأساسي لإضافة/تعديل
--  موكل (useClientActions.ts) — فكان بيفضل NULL لمعظم الموكلين، أو
--  بيفضل بقيمة قديمة (stale) لو الموكل اتعدل اسمه بعد كده من شاشة
--  التعديل العادية. العمود ده بتعتمد عليه client-portal-api (بوابة
--  الموكل) وclientValidation.ts (فحص التكرار)، فكان بيسبب:
--    1) كراش 500 في أول خطوة تسجيل دخول لبوابة الموكل (actionFind →
--       maskName(null).trim()).
--    2) فحص تكرار الاسم بيفشل يلاقي أي تكرار عمليًا.
--    3) اقتراح "موكل مطابق" عند تحويل جلسة مستقلة لقضية مبيلاقيش حد.
--
--  الحل: client_name هو العمود الوحيد المضمون إنه بيتكتب من كل
--  المسارات الحالية (وأي مسار مستقبلي محتمل). فبدل ما نلاحق كل موضع
--  في الكود يقرا العمود الصح، بنخلي full_name مرآة تلقائية لـ
--  client_name على مستوى قاعدة البيانات — أي INSERT أو UPDATE
--  (بيغيّر client_name) هيحدّث full_name معاه تلقائيًا، مهما كان
--  مصدر الكتابة (فرونت إند، edge function، سكريبت استيراد مستقبلي...).
--
--  الخطوة التانية (تصحيح تاريخي لمرة واحدة): تحديث كل الصفوف
--  الموجودة حاليًا عشان full_name يتساوى مع client_name فورًا،
--  بدل ما ننتظر أول تعديل لكل موكل.
--
--  ⚠️ الترايجر ده اتجاهه واحد بس (client_name → full_name). مفيش أي
--  كود بيقرا client_name من full_name، فمفيش خطر loop أو تعارض.
--  التغيير ده على مستوى الداتابيز بس، مفيش أي تأثير على واجهة
--  المستخدم أو سلوك التطبيق الظاهر — الموكلين هيلاقوا بوابتهم شغالة
--  بس، من غير أي إجراء مطلوب منهم.
-- ══════════════════════════════════════════════════════

-- ── 1) الترايجر: full_name = client_name تلقائيًا عند أي INSERT/UPDATE ──
CREATE OR REPLACE FUNCTION sync_client_full_name()
RETURNS trigger AS $$
BEGIN
  NEW.full_name := NEW.client_name;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_client_full_name ON clients;

CREATE TRIGGER trg_sync_client_full_name
  BEFORE INSERT OR UPDATE OF client_name ON clients
  FOR EACH ROW
  EXECUTE FUNCTION sync_client_full_name();

-- ── 2) تصحيح تاريخي لمرة واحدة: الصفوف الموجودة فعلاً ──
-- (الصفوف اللي full_name فيها فاضي، أو مختلف عن client_name بسبب
-- تعديل اسم حصل بعد إضافة الموكل من مسار كان بيكتب full_name).
UPDATE clients
SET full_name = client_name
WHERE full_name IS DISTINCT FROM client_name;

-- ── 3) تحقق (اختياري، للتشغيل اليدوي بعد النشر) ──
-- لازم يرجع 0 صف:
-- SELECT id, client_name, full_name FROM clients
-- WHERE full_name IS DISTINCT FROM client_name;
