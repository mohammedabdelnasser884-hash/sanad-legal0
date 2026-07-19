-- ══════════════════════════════════════════════════════
--  Migration 1: بنية سقف استخدام المساعد الذكي لكل مكتب
--  (المرحلة 0 من خطة إعادة هيكلة المساعد الذكي — راجع
--  sanad-ai-assistant-plan-2.md).
--
--  المهمة: جدول لتتبّع عدد رسائل المساعد الذكي لكل مكتب في
--  اليوم + دالة atomic تتحقق من السقف وتزوّد العدّاد في نفس
--  الوقت (عشان تمنع race condition لو المكتب باعت أكتر من
--  طلب في نفس اللحظة).
--
--  ⚠️ الجدول والدالة دول بنية تحتية بس — لسه معندهمش أي تأثير
--  فعلي على المساعد الذكي لحد ما ai-chat/index.ts يتحدّث
--  ليستخدمهم (البند التاني من المرحلة 0، ملف منفصل).
--
--  ترتيب النشر: نفّذ الملف ده الأول، وبعدين حدّث ai-chat.
--  الترتيب مش حرج فعليًا لأن مفيش حد بينده على الدالة دي لحد
--  ما ai-chat يتحدّث.
-- ══════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS ai_usage_daily (
  tenant_id     uuid NOT NULL,
  usage_date    date NOT NULL DEFAULT CURRENT_DATE,
  message_count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, usage_date)
);

-- زي باقي الجداول الحساسة عندك: RLS مفعّل بدون أي policy، يعني
-- مفيش وصول ليه إلا عن طريق service_role (اللي بيتخطى RLS
-- تلقائيًا). الفرونت إند ولا anon ولا authenticated هيقدروا
-- يقروا/يعدّلوا الجدول ده مباشرة.
ALTER TABLE ai_usage_daily ENABLE ROW LEVEL SECURITY;

-- ── الدالة الأساسية: تتحقق من السقف وتزوّد العدّاد في خطوة واحدة atomic ──
-- بترجع true لو الطلب مسموح (وبتزوّد العدّاد فعليًا)، أو false لو
-- المكتب وصل للسقف اليومي (من غير ما تزوّد العدّاد فوق السقف).
CREATE OR REPLACE FUNCTION check_and_increment_ai_usage(
  p_tenant_id uuid,
  p_daily_cap integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_count integer;
BEGIN
  -- FOR UPDATE عشان لو جالك طلبين لنفس المكتب في نفس اللحظة
  -- بالظبط، الصف يتقفل لحد ما الأول يخلّص، فمنعدّش فوق السقف.
  SELECT message_count INTO existing_count
  FROM ai_usage_daily
  WHERE tenant_id = p_tenant_id AND usage_date = CURRENT_DATE
  FOR UPDATE;

  IF existing_count IS NULL THEN
    INSERT INTO ai_usage_daily (tenant_id, usage_date, message_count)
    VALUES (p_tenant_id, CURRENT_DATE, 1);
    RETURN true;
  END IF;

  IF existing_count >= p_daily_cap THEN
    RETURN false;
  END IF;

  UPDATE ai_usage_daily
  SET message_count = message_count + 1
  WHERE tenant_id = p_tenant_id AND usage_date = CURRENT_DATE;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION check_and_increment_ai_usage(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION check_and_increment_ai_usage(uuid, integer) FROM anon;
REVOKE ALL ON FUNCTION check_and_increment_ai_usage(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION check_and_increment_ai_usage(uuid, integer) TO service_role;

-- ── دالة مساعدة اختيارية: معرفة الاستهلاك الحالي (للعرض في الواجهة لاحقًا) ──
-- بترجع عدد الرسائل المستخدمة النهاردة لمكتب معيّن، من غير ما تزوّد
-- أي حاجة. مفيدة لو حبينا نعرض للمستخدم "استخدمت X من Y رسالة النهاردة".
CREATE OR REPLACE FUNCTION get_ai_usage_today(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(message_count, 0)
  FROM ai_usage_daily
  WHERE tenant_id = p_tenant_id AND usage_date = CURRENT_DATE;
$$;

REVOKE ALL ON FUNCTION get_ai_usage_today(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_ai_usage_today(uuid) FROM anon;
REVOKE ALL ON FUNCTION get_ai_usage_today(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION get_ai_usage_today(uuid) TO service_role;
