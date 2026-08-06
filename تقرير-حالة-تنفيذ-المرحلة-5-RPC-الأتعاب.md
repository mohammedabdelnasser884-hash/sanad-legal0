# تقرير حالة تنفيذ المرحلة 5 — RPC ذرّية لفلو "إنشاء أتعاب جديدة + دفعة مقدّمة"

> امتداد لتقرير حالة تنفيذ خطة توحيد قفل الطرف + فلو الأتعاب (المرحلة 3).
> هنا تنفيذ المرحلة 5 اللي كانت ⏳ في جدول صاحب القرار.

---

## ✅ اتعمل فعليًا

### 1. RPC جديدة: `create_fee_with_advance`

**الملف الجديد:**
- `database/migrations/sql-migrations-phase5/01-create-fee-with-advance-rpc.sql`

نفس نمط `record_fee_payment` (المرحلة 4) بالظبط:
- `SECURITY DEFINER` + `SET search_path = public`
- تحقق صريح إن `case_id` تابع لمكتب المستخدم المستدعي (`tenant_id = current_tenant_id() OR is_super_admin()`) قبل أي كتابة — مهم لأنها `SECURITY DEFINER` بتتخطى RLS
- `REVOKE EXECUTE ... FROM anon, PUBLIC` (مقفولة على `authenticated` بس)
- خطوة تأكيد بعد النشر عن طريق `information_schema.routine_privileges` (نفس الاستعلام المستخدم فى كل RPC سابقة)

**المنطق جوه الدالة:**
1. تتحقق من `case_id` وتجيب `tenant_id` بتاعه
2. تعمل `INSERT` فى `case_fees` بـ `paid_fees=0`
3. لو فيه دفعة مقدّمة (`p_paid_amount > 0`) — نفس شرط `initialPaidAmount>0` فى الكود القديم بالظبط — تعمل `INSERT` فى `fee_payments`، تعيد الجمع من `fee_payments` الفعلي (مش من `p_paid_amount` مباشرة، اتساقًا مع نمط `record_fee_payment`)، وتحدّث `case_fees.paid_fees/status/last_payment_date`
4. كل ده جوه transaction واحدة على مستوى القاعدة — إما تنجح كلها أو ترجع كلها بالكامل (rollback تلقائي)

**المشكلة اللي اتحلّت:** فرع الإنشاء فى `handleSave` كان بينفّذ لحد 4 استعلامات منفصلة من الفرونت إند (insert case_fees → insert fee_payments → select لإعادة الحساب → update case_fees) من غير transaction حقيقية. فشل نت بين الخطوة 1 والخطوة 4 كان بيسيب سجل أتعاب "يتيم" — دفعة مقدّمة متسجلة فى `fee_payments` بينما `case_fees.paid_fees/status` لسه صفر/`open`. نفس فئة مشكلة H-2 اللي اتحلت فى `record_fee_payment` بالمرحلة 4، بس هنا فى مسار "الإنشاء" بدل "تسجيل دفعة على سجل موجود".

### 2. تحديث `handleSave` (فرع الإنشاء فقط) — `useFeesActions.ts`

فرع `editId` (التعديل) **ملهوش أي تعديل** — لسه شغال بـ `safeUpdate` زي ما هو (قفل تفاؤلي، مش محتاج RPC لأنه تحديث سطر واحد موجود بالفعل، مش عملية متعددة الخطوات).

فرع الإنشاء (else) استُبدل: بدل الـ4 استعلامات المتتالية، نداء واحد:
```ts
const { data: inserted, error } = await db.rpc('create_fee_with_advance', {
    p_case_id, p_case_title, p_client_id, p_client_name,
    p_receiver, p_total_fees, p_notes, p_paid_amount, p_payment_date,
});
```
باقي الفلو (توست، `logActivity`, `fetchFees`, `fetchGrandSummary`, `fetchStatusCounts`) زي ما هو من غير تغيير.

### 3. تحديث الاختبارات — `useFeesActions.test.ts`

الاختبارات الثلاثة الخاصة بفرع الإنشاء اتعدّلت لتتحقق من شكل الـ payload المبعوت لـ `db.rpc('create_fee_with_advance', ...)` بدل `insert`/`update` منفصلين، بالإضافة لاختبار جديد لحالة فشل الـRPC (توست خطأ + مفيش `logActivity`). اختبارات الفاليديشن وفرع التعديل (`editId`) متأثرتش خالص.

---

## ⚠️ تنبيه تنفيذي (زي كل مرحلة سابقة)

- التعديلات اتراجعت منطقيًا يدويًا + فحص `tsc --noEmit` معزول لكل من `useFeesActions.ts` و`useFeesActions.test.ts` (بدون حل الـimports، بس فلترة لأخطاء الصياغة الحقيقية `TS1xxx`) — **الملفين طلعوا نضاف من أخطاء صياغة**.
- **`npm test`/`npm run build` الحقيقيين ما اتشغلوش فعليًا** — نفس القيد المعروف (بيئة التنفيذ هنا مقطوعة عن الإنترنت، مفيش `node_modules`). لازم تشغّل `npm run build` و`npm test` عندك للتأكيد النهائي قبل الدمج.
- **قبل الاستخدام:** لازم تشغّل ملف الهجرة `database/migrations/sql-migrations-phase5/01-create-fee-with-advance-rpc.sql` فى Supabase SQL Editor قبل نشر الفرونت إند — لو الدالة مش موجودة فى القاعدة، `handleSave` هيفشل بتوست "فشل حفظ الأتعاب الجديدة" لأي محاولة إنشاء أتعاب جديدة.
- بعد التشغيل، الاستعلام المقترح فى نهاية ملف الهجرة (`information_schema.routine_privileges`) بيأكد إن الصلاحيات مقفولة صح (`authenticated`/`service_role`/`postgres` بس، من غير `anon`).

---

## 🔜 الباقي

| المرحلة | الحالة |
|---|---|
| 5 — RPC الأتعاب | ✅ **اتعمل الآن** (محتاج `npm run build`/`npm test` + تشغيل الـmigration عندك) |
| 6 — تنبيه عند فشل تسجيل الجلسة الأولى | ⏳ |
| بادج `CasesTab.tsx` | 🔓 قرار مفتوح — خارج نطاق الخطة الأساسية |
