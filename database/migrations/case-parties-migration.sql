-- ============================================================
-- Migration: case_parties (المرحلة 1 من خطة تعدد الأطراف)
-- التاريخ: 22 يوليو 2026
-- الغرض: إنشاء جدول case_parties فاضي (بدون أي بيانات) — الأطراف
-- المتعددة (مدعين/مدعى عليهم) لكل قضية أو جلسة مستقلة.
-- التصميم موثّق بالكامل في قسم 3 من خطة-تعدد-الأطراف-في-القضية-4-5.md
-- كل الأسماء والأنواع هنا متحقق منها فعليًا من قاعدة البيانات الحقيقية
-- (ملحق أ وملحق ب في نفس التقرير) — صفر افتراضات.
-- ============================================================

CREATE TABLE case_parties (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    case_id                 uuid REFERENCES cases(id) ON DELETE CASCADE,
    session_id              uuid REFERENCES case_sessions(id) ON DELETE CASCADE,
    CONSTRAINT case_parties_one_parent CHECK (
        (case_id IS NOT NULL AND session_id IS NULL) OR
        (case_id IS NULL AND session_id IS NOT NULL)
    ),
    side                    text NOT NULL CHECK (side IN ('plaintiff','defendant')),
    is_client               boolean NOT NULL DEFAULT false,   -- ⭐ هل هو موكل المكتب؟
    name                    text NOT NULL,
    capacity                text NOT NULL,     -- الصفة: مدعي / مدعى عليه / منضم ...
    national_id             text,              -- إجباري بس لو is_client = true (فاليديشن في التطبيق)
    address                 text,
    power_of_attorney       text,
    client_id               uuid REFERENCES clients(id) ON DELETE SET NULL,  -- نفس سلوك cases_client_id_fkey الحقيقي
    sort_order              int NOT NULL DEFAULT 0,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

-- تعبئة tenant_id تلقائيًا لو الفورم مبعتهاش — نفس الدالة الموجودة فعلًا
-- في الداتابيز (public.set_tenant_id_from_profile)، ومؤكَّد (ملحق ب) إنها
-- فعلًا Trigger BEFORE INSERT شغالة على 11 جدول تاني.
CREATE TRIGGER set_case_parties_tenant_id
    BEFORE INSERT ON case_parties
    FOR EACH ROW EXECUTE FUNCTION public.set_tenant_id_from_profile();

CREATE INDEX idx_case_parties_tenant_id ON case_parties(tenant_id);
CREATE INDEX idx_case_parties_case ON case_parties(case_id) WHERE case_id IS NOT NULL;
CREATE INDEX idx_case_parties_session ON case_parties(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX idx_case_parties_client ON case_parties(client_id) WHERE client_id IS NOT NULL;

-- منع تكرار الرقم القومي جوه نفس القضية/الجلسة — نفس نمط
-- idx_clients_tenant_national_id_unique الحقيقي (partial unique index).
-- مؤكَّد آمن (ملحق هـ): صفر تكرار في البيانات الحالية.
CREATE UNIQUE INDEX idx_case_parties_no_dup_national_id
    ON case_parties(COALESCE(case_id, session_id), national_id)
    WHERE national_id IS NOT NULL;

ALTER TABLE case_parties ENABLE ROW LEVEL SECURITY;

-- نفس نص سياسة tenant_scoped_cases/tenant_scoped_clients/tenant_scoped_case_sessions
-- الحقيقي بالظبط — نفس الدالتين current_tenant_id() و is_super_admin().
CREATE POLICY tenant_scoped_case_parties ON case_parties
    FOR ALL
    USING ((tenant_id = current_tenant_id()) OR is_super_admin())
    WITH CHECK ((tenant_id = current_tenant_id()) OR is_super_admin());

-- ============================================================
-- استعلام تحقق (شغّله بعد الـ migration مباشرة، يرجّع صف واحد)
-- ============================================================
SELECT jsonb_build_object(
  'table_created', (SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='case_parties')),
  'row_count', (SELECT count(*) FROM case_parties),
  'rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE relname = 'case_parties'),
  'trigger_exists', (SELECT EXISTS (SELECT 1 FROM information_schema.triggers WHERE trigger_name = 'set_case_parties_tenant_id')),
  'indexes', (SELECT jsonb_agg(indexname) FROM pg_indexes WHERE schemaname='public' AND tablename='case_parties'),
  'policy_exists', (SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='case_parties' AND policyname='tenant_scoped_case_parties'))
) AS phase1_verification;
