-- ══════════════════════════════════════════════════════════════════
--  Migration: session_alerts_log — منع تكرار إشعارات Telegram
--  (H-6 — Enterprise-Reliability-Audit-2، المرحلة 5)
--
--  المشكلة: session-alerts/index.ts بيتنادى من Scheduled Trigger
--  (cron)، ومفيش أي تتبّع لو الإشعار بتاع مكتب معين ونوع معين (صبح/
--  مساء) اتبعت بالفعل النهارده. لو الـ cron اتنادى مرتين لنفس اليوم
--  (retry تلقائي من Supabase، إعادة تشغيل يدوي من الداشبورد، تعارض فى
--  ضبط الجدولة)، كل مكتب هياخد رسائل تيليجرام مكررة بالكامل.
--
--  الحل: جدول تتبّع بسيط + قيد UNIQUE على (tenant_id, alert_type,
--  alert_date). الفانكشن (index.ts، هيتعدّل فى نفس المرحلة) هتحاول
--  "تحجز" الصف ده بـ INSERT ... ON CONFLICT DO NOTHING RETURNING *
--  قبل أي إرسال — لو مفيش صف رجع (يعني الصف موجود بالفعل من نداء
--  سابق)، يبقى الإشعار اتبعت خلاص النهارده وتتخطى المكتب ده بصمت.
--  ده safe حتى لو النداءين حصلوا فى نفس اللحظة بالظبط (race condition)
--  لأن الحجز بيعتمد على قيد UNIQUE على مستوى القاعدة نفسها، مش على
--  فحص SELECT منفصل عن الـ INSERT.
--
--  الملف Idempotent — آمن يتشغل أكتر من مرة.
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_alerts_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  alert_type text NOT NULL,   -- 'morning' | 'evening' (نفس قيمة `type` فى index.ts)
  alert_date date NOT NULL,   -- تاريخ اليوم اللي اتبعت فيه الإشعار (توقيت التشغيل)
  sent_at    timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ ده هو خط الدفاع الفعلي — قيد UNIQUE بيمنع صفين لنفس (مكتب + نوع
-- + يوم)، فمينفعش الفانكشن "تحجز" مرتين لنفس اليوم حتى لو نودي عليها
-- فى نفس اللحظة بالظبط من نداءين متوازيين.
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_alerts_log_dedup
  ON session_alerts_log (tenant_id, alert_type, alert_date);

CREATE INDEX IF NOT EXISTS idx_session_alerts_log_sent_at
  ON session_alerts_log (sent_at DESC);

-- RLS: الجدول ده بيتلمس بس من session-alerts (service_role، بيتخطى RLS
-- تلقائيًا)، مفيش أي مسار فرونت إند بيقرأ أو يكتب فيه — فبنفعّل RLS
-- من غير أي policy (deny افتراضي للجميع ما عدا service_role)، نفس
-- فلسفة "أضيق صلاحية ممكنة" المتبعة فى باقي جداول النظام.
ALTER TABLE session_alerts_log ENABLE ROW LEVEL SECURITY;

-- ── خطوة تأكيد بعد التنفيذ ──
--   SELECT * FROM session_alerts_log ORDER BY sent_at DESC LIMIT 5;
-- المتوقع بعد أول تشغيل ناجح للـ cron: صف واحد لكل مكتب ضابط بوت
-- التذكيرات، لكل نوع (morning/evening) شغّال فعليًا النهارده.
