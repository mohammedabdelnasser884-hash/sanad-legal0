# تقرير حالة تنفيذ المرحلة 3 — Badges/UI (إغلاق خطة توحيد قفل الطرف)

> امتداد لـ`تقرير-حالة-تنفيذ-خطة-توحيد-قفل-الطرف.md`. المرحلة دي كانت
> ⏳ التالية في جدول صاحب القرار — هنا توثيق إنها اتعملت فعليًا +
> الفجوة الوحيدة اللي اتلقّت (تغطية اختبار) واتقفلت.

---

## ✅ اتأكد من الكود إنه منفّذ بالفعل

الكود الفعلي في المشروع (بتاريخ 6 أغسطس) طلع فيه المرحلة 3 كاملة —
من غير ما يكون فيه تقرير حالة يوثّقها، فمكنش واضح في التسلسل. راجعت
كل بند وطابقته بالكود:

### 1. الشارة الملوّنة (🟢🔵🟠🟣)
- `getPartyStateBadge()` في `partyDomainService.ts` — تُرجع `null`
  لـ`MANUAL`، وشارة (emoji + label + Tailwind className) لكل حالة
  تانية. `ORPHAN` و`ORPHAN_PARTY` بنفس النص ("موكل محذوف") لكن بلون
  مختلف (🟠 كهرماني / 🟣 بنفسجي) — تفرقة بصرية بين "الموكل الأساسي
  اتحذف" و"موكل طرف ثانوي اتحذف".
- متعروضة في `PartyFields.tsx` (كارت الشخص المفرد، جنب العنوان
  الترتيبي) و`PartySideCard.tsx` (الكارت المطوي — بتاخد أسوأ حالة بين
  كل أشخاص الجهة: orphan لو فيه واحد orphan، وإلا linked لو فيه واحد
  linked).

### 2. نص سبب القفل
- `getPartyStateMessage()` (موجودة من قبل من المرحلة 1) متوصّلة فعليًا
  دلوقتي في `EditCaseModal.tsx` و`StandaloneSessionDetailModal.tsx` —
  بتتعرض كتحذير أصفر تحت كارت الطرف مباشرة.

### 3. Preview قبل فك الربط
- زرار "🔓 فك الربط" في الفورمين بقى بيمر بخطوة تأكيد وسيطة
  (`confirmingUnlink` state) قبل التنفيذ الفعلي، بدل تنفيذ مباشر من
  أول ضغطة.

### 4. فجوة 5.3 — مؤشر orphan في هيدر `CaseDetailView.tsx`
- `orphanedPartiesCount` (عدّاد أطراف orphan محسوب بنفس منطق
  `linkedClients`) + شارة "🟣 N موكل محذوف" (`data-testid`:
  `case-detail-orphaned-clients-badge`) جنب أسماء الموكلين المرتبطين
  فعليًا في الهيدر.

### 5. فجوة 5.4 — `client_id` في استعلام `sessionParties`
- `StandaloneSessionDetailModal.tsx`: الاستعلام بقى `select('side,
  name, capacity, client_id')` بدل `select('side,name,capacity')` —
  البيانات الكافية لعرض الشارة في العرض القرائي متاحة دلوقتي.

**ملحوظة:** `NewCaseModal.tsx`/`NewStandaloneSessionModal.tsx` (فورمات
الإنشاء) عن قصد **مش بيبعتوا** `getPartyState` لـ`PartyFieldsGroup` —
الأطراف فيهم دايمًا `MANUAL` وقت الإنشاء (مفيش سياق ربط لسه)، فمفيش
داعي للشارة هناك أصلًا. نفس القرار الموثّق كتعليق في `PartyFields.tsx`.

---

## 🔧 الفجوة الوحيدة اللي اتلقّت واتقفلت

`getPartyStateBadge()` كانت الدالة الوحيدة في `partyDomainService.ts`
من غير أي تغطية اختبار — كل الدوال التانية (`getPartyState`,
`canUnlinkParty`, `getPartyStateMessage`, إلخ) متغطاة، هي بس كانت
ناقصة.

**الملف المعدّل:** `src/shared/parties/partyDomainService.test.ts`

6 اختبارات جديدة في `describe('getPartyStateBadge — المرحلة 3،
Badges/UI')`:
- `null` لـ`MANUAL`
- الشارة الصحيحة (emoji + label) لكل من `PRIMARY_CLIENT`/`LINKED`/
  `ORPHAN`/`ORPHAN_PARTY`
- تأكيد إن `ORPHAN` و`ORPHAN_PARTY` عندهم `className` مختلف رغم نفس
  الـ`label`
- تأكيد إن كل الحالات غير `MANUAL` بترجع `className` فيه ألوان
  Tailwind (نمط `text-*bg-*border-*`)

باقي الاختبارات الموجودة في الملف (`getPartyState`, `canUnlinkParty`،
إلخ) اتراجعت ومتأثرتش.

**لسه مفيش component tests** لـ`PartyFields.tsx`/`PartySideCard.tsx`/
`PartySubform.tsx`/`PartyFieldsGroup.tsx` — لكن ده متسق مع نمط
المشروع الحالي (المودالات مش بتتغطى بـunit tests، التغطية بتبقى على
مستوى e2e). لو عايز تغطية إضافية هنا، محتاج قرار صريح لأنه خارج نطاق
الفجوة اللي اتلقّت.

---

## ⚠️ تنبيه تنفيذي

- الاختبارات الجديدة اتراجعت منطقيًا يدويًا + فحص صياغة معزول
  (`transpileModule`) للملف المعدّل — **نضيف من أخطاء صياغة**.
- **`npm test`/`npm run build` الحقيقيين ما اتشغلوش فعليًا** — نفس
  القيد المعروف (بيئة التنفيذ هنا مقطوعة عن الإنترنت، مفيش
  `node_modules`). لازم تشغّل `npm test -- partyDomainService` عندك
  للتأكيد النهائي.
- **مفيش أي migration مطلوبة** — تعديل الاختبار فقط، مفيش تغيير في
  الكود التطبيقي نفسه (كان بالفعل منفّذ).

---

## 🔜 الخلاصة — خطة توحيد قفل الطرف + فلو الأتعاب

| المرحلة | الحالة |
|---|---|
| 0.5 + 0.6 (تحقيق) | ✅ |
| 1 — `PartyDomainService` | ✅ |
| 2 — توصيل السيرفس بالفورمات (باگ 5.1 + 5.5) | ✅ |
| 3 — Badges/UI + فجوتي 5.3/5.4 | ✅ **اتأكد ومتوثّق دلوقتي** (محتاج `npm test` عندك) |
| 5 — RPC الأتعاب | ✅ (محتاج `npm test`/`npm run build` + تشغيل migration) |
| 6 — تنبيه فشل الجلسة الأولى (إنشاء + تعديل) | ✅ (محتاج `npm test`/`npm run build`) |
| 4 — Legacy columns | 🔒 خارج التسلسل — قرار منفصل، لسه مفتوح |

**الخطة الأساسية بكل مسارتيها (الطرف + الأتعاب) بقت مكتملة على مستوى
الكود.** الباقي كله تأكيدات محلية عندك (`npm test`/`npm run build` +
migration المرحلة 5)، وبعدها قرار مفتوح واحد بس فاضل: بادج
`CasesTab.tsx` (خارج نطاق الخطة الأساسية من الأول).
