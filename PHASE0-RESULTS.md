# المرحلة 0 — نتائج التحقق المباشر على القاعدة الحية (تم التنفيذ)

استكمالًا لـ `Enterprise-Reliability-Audit-1.md`، قسم "المرحلة 0". الاستعلامات اتشغّلت فعليًا على القاعدة الحية (SELECT فقط، صفر تعديل) والنتائج موثّقة هنا بالكامل قبل الانتقال للمرحلة 2.

---

## 0.1 — تدقيق كل الـ Foreign Keys (خاص بـ H-5)

**النتيجة الكاملة (37 علاقة FK فعلية على القاعدة الحية):**

```
fee_payments.fee_id -> case_fees.id | delete_rule=CASCADE | constraint=fee_payments_fee_id_fkey
case_documents.case_id -> cases.id | delete_rule=CASCADE | constraint=case_documents_case_id_fkey
case_events.case_id -> cases.id | delete_rule=CASCADE | constraint=case_events_case_id_fkey
case_fees.case_id -> cases.id | delete_rule=SET NULL | constraint=case_fees_case_id_fkey
case_sessions.case_id -> cases.id | delete_rule=CASCADE | constraint=case_sessions_case_id_fkey
invoices.case_id -> cases.id | delete_rule=SET NULL | constraint=invoices_case_id_fkey
case_fees.client_id -> clients.id | delete_rule=SET NULL | constraint=case_fees_client_id_fkey
case_sessions.client_id -> clients.id | delete_rule=SET NULL | constraint=case_sessions_client_id_fkey
cases.client_id -> clients.id | delete_rule=SET NULL | constraint=cases_client_id_fkey
client_messages.client_id -> clients.id | delete_rule=CASCADE | constraint=client_messages_client_id_fkey
client_portal_pins.client_id -> clients.id | delete_rule=CASCADE | constraint=client_portal_pins_client_id_fkey
client_portal_sessions.client_id -> clients.id | delete_rule=CASCADE | constraint=client_portal_sessions_client_id_fkey
fee_payments.client_id -> clients.id | delete_rule=SET NULL | constraint=fee_payments_client_id_fkey
invoices.client_id -> clients.id | delete_rule=SET NULL | constraint=invoices_client_id_fkey
invoices.fee_payment_id -> fee_payments.id | delete_rule=SET NULL | constraint=invoices_fee_payment_id_fkey
cases.firm_id -> law_firms.id | delete_rule=CASCADE | constraint=cases_firm_id_fkey
clients.firm_id -> law_firms.id | delete_rule=CASCADE | constraint=clients_firm_id_fkey
law_articles.law_id -> laws.id | delete_rule=CASCADE | constraint=law_articles_law_id_fkey
laws.category_id -> legal_categories.id | delete_rule=NO ACTION | constraint=laws_category_id_fkey
clients.lawyer_id -> profiles.id | delete_rule=NO ACTION | constraint=clients_lawyer_id_fkey
activity_log.tenant_id -> tenants.id | delete_rule=SET NULL | constraint=activity_log_tenant_id_fkey
backups.tenant_id -> tenants.id | delete_rule=SET NULL | constraint=backups_tenant_id_fkey
case_documents.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=case_documents_tenant_id_fkey
case_events.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=case_events_tenant_id_fkey
case_fees.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=case_fees_tenant_id_fkey
case_notes.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=case_notes_tenant_id_fkey
case_sessions.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=case_sessions_tenant_id_fkey
cases.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=cases_tenant_id_fkey
clients.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=clients_tenant_id_fkey
fee_payments.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=fee_payments_tenant_id_fkey
law_firms.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=law_firms_tenant_id_fkey
office_settings.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=office_settings_tenant_id_fkey
platform_audit_logs.tenant_id -> tenants.id | delete_rule=SET NULL | constraint=platform_audit_logs_tenant_id_fkey
profiles.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=profiles_tenant_id_fkey
reminders.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=reminders_tenant_id_fkey
tenant_invoices.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=tenant_invoices_tenant_id_fkey
tenant_usage_stats.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=tenant_usage_stats_tenant_id_fkey
whatsapp_logs.tenant_id -> tenants.id | delete_rule=CASCADE | constraint=whatsapp_logs_tenant_id_fkey
```

**الخلاصة:** `case_notes.case_id -> cases.id` و`reminders.case_id -> cases.id` **مش موجودين خالص** في القايمة. جدول `case_notes` وجدول `reminders` عندهم بس FK على `tenant_id`، ومفيش أي FK على `case_id` خالص.

**تحديث تصنيف H-5:** السيناريو (ب) في التقرير الأصلي هو الصحيح، مش (أ) — العلاقتين دول **معندهمش أي FK constraint على القاعدة الحية أصلًا**، مش مجرد نقص توثيق. حذف قضية بمسار غير `handlePermanentDeleteCase` (SQL Editor مباشرة، أو أي مسار مستقبلي) هيسيب صفوف يتيمة في `case_notes`/`reminders` تشاور لـ `case_id` غير موجود، من غير أي رفض أو CASCADE تلقائي من القاعدة. **يبقى إنشاء FK فعلي مطلوب في المرحلة 3 (3.1)، مش بس توثيق.**

---

## 0.2 — التعريف الفعلي لـ `current_tenant_id()` (خاص بـ C-1)

```sql
CREATE OR REPLACE FUNCTION public.current_tenant_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.tenant_id
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id
  where p.user_id = auth.uid()
    -- مكتب من غير status محدد (لسه مبعتش/default) → نعتبره شغال،
    -- عشان منقفلش مكاتب جديدة بالغلط لسه ما اتصنفتش
    and (t.status is null or t.status <> 'suspended')
    -- تجربة منتهية = زي الموقوف بالظبط
    and (t.status is distinct from 'trial' or t.trial_ends_at is null or t.trial_ends_at >= now())
$function$
```

**الخلاصة:** الدالة بتفحص فعليًا حالة **المكتب** (`tenants.status`) — موقوف أو تجربة منتهية — لكن **مش بتفحص `profiles.is_active` للمستخدم نفسه خالص**. C-1 مؤكدة 100% بالتعريف الحرفي الفعلي، مش افتراض.

**ملاحظة مهمة لصياغة إصلاح المرحلة 2:** الدالة بالفعل فيها نمط "فحص حالة + تعليق شارح" لكل شرط (زي `status <> 'suspended'`). التعديل المقترح لازم يتبع نفس النمط بالظبط — إضافة شرط `and p.is_active = true` (مع تعليق مماثل) بدل ما يتكتب بأسلوب مختلف، عشان الدالة تفضل متسقة مع نفسها.

---

## 0.3 — مراجعة خطة توسيع نظام الأوفلاين الموجودة (خاص بـ H-3)

راجعت ملف `خطة-توسيع-نظام-الأوفلاين-2-1.md` الموجود بالفعل في الزيب بالكامل.

**الخلاصة:** الخطة دي (مراحلها الـ 0-5) اتنفذت بالفعل، لكنها بتغطي نطاق مختلف تمامًا عن H-3: تحويل 17 نداء `db.from()` مباشر في تدفقات "ربط قضية/موكل بجلسة مستقلة" (`useClientLinking.ts`, `useSessionLinking.ts`, `NewStandaloneSessionModal.tsx`) ليستخدموا نظام الطابور، مش توسيع `DbWriteTable` (المعرّفة حاليًا `'clients' | 'cases' | 'case_sessions'` بس) لتغطية جداول الأتعاب (`case_fees`/`fee_payments`)، التذكيرات (`reminders`)، المستندات (`case_documents`)، أو ملاحظات القضية (`case_notes`).

**النتيجة:** H-3 لسه قائمة كاملة زي ما هي في التقرير الأصلي — مفيش شغل سابق مطلوب إعادته. المرحلة 6 (توسيع الأوفلاين) هتبدأ من الصفر فعليًا على الجداول الأربعة دي.

---

## 0.4 — تدقيق CHECK constraints الحالية على `case_fees`/`fee_payments` (خاص بـ M-4)

**النتيجة الكاملة:**

```
case_fees | check: (status = ANY (ARRAY['collected'::text, 'deferred'::text, 'open'::text]))
case_fees | check: id IS NOT NULL
case_fees | check: total_fees IS NOT NULL
case_fees | check: paid_fees IS NOT NULL
case_fees | check: created_at IS NOT NULL
case_fees | check: updated_at IS NOT NULL
fee_payments | check: id IS NOT NULL
fee_payments | check: amount IS NOT NULL
```

**الخلاصة:** القيود الوحيدة الموجودة فعليًا هي NOT NULL التلقائية + قيد `status` (business rule صحيح وموجود بالفعل). **مفيش أي قيد على القيم الرقمية خالص** — لا `total_fees >= 0`، لا `paid_fees >= 0`، لا `amount >= 0` على `fee_payments`، ولا `paid_fees <= total_fees`. نطاق M-4 مفتوح بالكامل زي ما كان متوقع بالضبط، وهيتحدد نهائيًا في المرحلة 3 بعد قرارك في H-4 (هل الدفعة الزيادة مسموحة، عشان نقرر شكل قيد `paid_fees <= total_fees` بالظبط).

---

## الخلاصة العامة قبل المرحلة 2

| البند | الحالة بعد التحقق |
|---|---|
| C-1 | **مؤكدة 100%** — تعريف الدالة الفعلي مثبّت فوق، جاهزة للتعديل في المرحلة 2 |
| H-5 | **مؤكدة ومُحدَّثة** — لا يوجد FK خالص (مش مجرد نقص توثيق) — تعديل نطاق 3.1 من "توثيق" إلى "إنشاء" |
| H-3 | **قائمة بالكامل** — لا يوجد تداخل مع خطة الأوفلاين المنفذة سابقًا |
| M-4 | **مؤكدة بالكامل** — صفر قيود رقمية حاليًا |

**الخطوة الجاية:** المرحلة 2 — تعديل `current_tenant_id()` لإضافة `is_active = true`، مع تشغيل `phase1-tenant-isolation-test.sql` على staging قبل أي نشر (2.2/2.3)، زي ما الخطة الأصلية نصّت بالظبط.
