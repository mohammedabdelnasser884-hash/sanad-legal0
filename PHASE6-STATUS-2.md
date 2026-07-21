# المرحلة 6 (توسيع نظام الأوفلاين، H-3) — تكملة ثانية: `case_notes` و`case_documents`

**التاريخ:** 21 يوليو 2026
**الحالة:** ✅ الكود مكتمل ومراجَع يدويًا — بانتظار `npm test`/`tsc --noEmit` محليًا (لا اتصال إنترنت في بيئة التنفيذ).

## الخلفية

حسب جدول أولوية المرحلة 6 في التقرير (`Enterprise-Reliability-Audit-2-updated-*.md`، قسم "المرحلة 6"):
`reminders` → `case_fees`/`fee_payments` → `case_documents`/`case_notes`.

أول جدولين خلصوا في تكملة سابقة. الملف ده بيوثّق تكملة الجدولين الأخيرين.

## `case_notes` — ✅ اتضافت للطابور بالكامل

| الدالة | قبل | بعد |
|---|---|---|
| `handleAddNote` (إضافة) | `db.from('case_notes').insert(...)` | `window.__dbWrite({type:'INSERT', table:'case_notes', ...})` |
| `handleDeleteNote` (حذف) | `db.from('case_notes').delete().eq('id',...)` | `window.__dbWrite({type:'DELETE', table:'case_notes', id})` |
| `handleUpdateNote` (تعديل) | `safeUpdate(db, 'case_notes', ...)` | `window.__dbWrite({type:'UPDATE', table:'case_notes', ...})` |

- الملف المتأثر: `src/features/cases/hooks/useCaseDetailActions.ts`
- `'case_notes'` اتضافت لنوع `DbWriteTable` في `src/lib/offlineQueue.ts`
- صفر `_offlineFkTempId`: `case_notes` مالهاش FK فعلي نحو `cases` (مؤكَّد بالقسم 0.1 من التقرير)، والملاحظة دايمًا بتتضاف لقضية محمّلة فعليًا على الشاشة (سجل حقيقي متزامن، مش تمبيد).
- الرسائل الجديدة أوفلاين: "📥 الملاحظة محفوظة محلياً"، "📥 الحذف محفوظ محلياً"، "📥 التعديل محفوظ محلياً" — نفس نمط `useRemindersTab.ts`.
- الاختبارات: `src/features/cases/hooks/useCaseDetailActions.test.ts` اتحدّثت بالكامل — mock لـ `window.__dbWrite` بدل `db.from`/`insertSpy`/`deleteSpy`، مع حالات جديدة: نجاح أونلاين، أوفلاين+queued، تعارض (للتعديل بس)، وفشل صريح — لكل دالة من التلاتة.

## `case_documents` — ✅ قرار استبعاد متعمد (زي case_fees/fee_payments)

**السبب:** رفع وحذف مستند بيلمسوا `Supabase Storage` فعليًا (بايتات ملف حقيقية)، مش صف DB نقي. مفيش تمثيل ممكن للملف في IndexedDB زي باقي عناصر الطابور، فتقييد العملية هيسيب المستخدم يفتكر إن الملف "محفوظ محليًا" وهو مش موجود فعليًا — نفس مشكلة الـ partial-save اللي قرار case_fees/fee_payments في المرحلة 4/6 اتجنّبها بالظبط.

**التنفيذ:** فحص `navigator.onLine` صريح في أول كل من:
- `handleUploadDoc` → لو أوفلاين: توست `⚠️ رفع مستند يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال`، وقف فوري قبل أي `db.storage.upload`.
- `handleDeleteDoc` → لو أوفلاين: توست `⚠️ حذف مستند يتطلب اتصالاً بالإنترنت — أعد المحاولة عند توفر الاتصال`، وقف فوري قبل أي `db.storage.remove`.

- الملف المتأثر: `src/features/cases/hooks/useCaseDocuments.ts`
- `case_documents` **لم تُضَف** لـ `DbWriteTable` (بقرار، موثّق بتعليق في `offlineQueue.ts`).
- الاختبارات: تستان جديدان في `src/features/cases/hooks/useCaseDocuments.test.ts` (منع الرفع أوفلاين، منع الحذف أوفلاين) بنفس نمط `setOnline()` الموجود في `useClientActions.test.ts`.

## اكتشاف جانبي — قرار مفتوح (خارج نطاق الخطوة دي)

`case_sessions` مُدرجة في `DbWriteTable` من التلات جداول الأصلية، لكن `useCaseSessions.ts` (إضافة/حذف جلسة من **صفحة تفاصيل القضية مباشرة**) لسه بتستخدم `db.from(...)` مباشر، مش `__dbWrite`. بعكس تدفقات الربط (`NewStandaloneSessionModal.tsx`/`useSessionLinking.ts`) اللي بالفعل متحوّلة من خطة الأوفلاين القديمة. يعني إضافة جلسة من شاشة تفاصيل القضية بالذات **مش مدعومة أوفلاين فعليًا** رغم إن الجدول "مدرج" في النوع.

**محتاج قرارك:** نضيفها كبند `6.5` إضافي دلوقتي، ولا نأجلها لحد بعد المرحلة 7؟

## المتبقي قبل اعتماد المرحلة 6 نهائيًا

1. تشغيل `npm test` محليًا للتأكد من نجاح كل اختبارات `case_notes`/`case_documents` الجديدة/المحدَّثة — **لسه لم يُنفَّذ**.
2. تشغيل `tsc --noEmit` للتأكد من عدم كسر أي نوع (خصوصًا `DbWriteTable` الموسّعة) — **لسه لم يُنفَّذ**.
3. اختبار يدوي: إضافة/تعديل/حذف ملاحظة وإنت أوفلاين فعليًا (قطع النت من DevTools)، والتأكد من ظهورها في البانر ومزامنتها عند رجوع الاتصال.
4. اختبار يدوي: محاولة رفع/حذف مستند وإنت أوفلاين، والتأكد من ظهور رسالة المنع الصريحة من غير أي محاولة اتصال فاشلة.
5. قرار `case_sessions`/`useCaseSessions.ts` أعلاه.
