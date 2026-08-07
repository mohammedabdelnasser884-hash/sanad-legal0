# مراجعة شاملة: خطة تفكيك الأعمدة القديمة (Legacy Columns) — تحديث 12

> امتداد لتحديث 11. F.1 (مسار القضية) كانت خلصت. هنا **F.2 (مسار الجلسة
> المستقلة) خلصت كمان**.

---

## قرار مهم: ترتيب F اتغيّر عمليًا

F الأصلية كانت "التفكيك الفعلي" (DROP COLUMN) كخطوة واحدة. بعد الفحص
الفعلي للكود، طلع إن **طبقة الكتابة (Layer A) أوسع بكتير مما كان موثّق** —
مش بس المصادر التلاتة+واحد المذكورين في تحديث 6-10
(`NewCaseModal.tsx`, `NewStandaloneSessionModal.tsx`, `useCaseActions.ts`,
`SessionUpdateModal.tsx`)، لكن كمان: `EditCaseModal.tsx`،
`handleLinkClient` (مزامنة أعمدة قديمة عند ربط قضية بموكل)،
`StandaloneSessionDetailModal.tsx`، `caseSessionLinkingShared.ts`،
`useClientLinking.ts`، `useSessionLinking.ts` — كلهم بيكتبوا فعليًا على
plaintiff/defendant وتوابعهم. **مينفعش نعمل DROP COLUMN من غير ما نوقف
كل المصادر دي أولاً**، فـF بقت مقسّمة:

| السب-فيز | المحتوى | الحالة |
|---|---|---|
| **F.1** | مسار إنشاء/تعديل/ربط القضية (`NewCaseModal.tsx`, `EditCaseModal.tsx`, `useCaseActions.ts`) | ✅ **مكتملة (6 أغسطس 2026)** |
| **F.2** | مسار الجلسة المستقلة (`NewStandaloneSessionModal.tsx`, `StandaloneSessionDetailModal.tsx`, `SessionUpdateModal.tsx`) | ✅ **مكتملة (6 أغسطس 2026)** |
| F.3 | مسارات الربط/تحويل (`caseSessionLinkingShared.ts`, `useClientLinking.ts`, `useSessionLinking.ts`) | ⏳ الجاية |
| F.4 | تأكيد نهائي (grep شامل + build حقيقي) + migration الـ`DROP COLUMN` نفسها | ⏳ آخر خطوة — **تتنفذ بس بعد ما تأكد المستخدم من نافذة المراقبة الحية (E)، لأنها غير قابلة للتراجع** |

---

## المرحلة F.1 — مسار القضية (إنشاء/تعديل/ربط) ✅ **مكتملة (6 أغسطس 2026)**

### الفكرة
كل الأماكن التلاتة كانت بتعمل "مزامنة" لعمود واحد قديم من الطرف الأساسي
(أولوية لمن عليه ⭐) كنسخة احتياطية جنب `case_parties` الحقيقي. دلوقتي —
بعد ما كل شاشات العرض (B.1-B.4) بقت بتقرا من `case_parties` بس — المزامنة
دي بقت ميتة (مفيش حد بيقراها)، فوقّفناها خالص.

### الملفات المعدّلة
| الملف | التغيير |
|---|---|
| `NewCaseModal.tsx` | زرار الحفظ بقى مابيبعتش `plaintiff/plaintiff_role/plaintiff_national_id/plaintiff_power_of_attorney/plaintiff_address/defendant/defendant_role/defendant_national_id` خالص. `plaintiff_legal_title/defendant_legal_title` لسه بيتبعتوا (مطلوبين كمدخل لفاليديشن `validateParties` في `useCaseActions.ts` — مش لكتابتهم على عمود). `client_id` و`parties` (الأطراف الكاملة) زي ما هما. |
| `EditCaseModal.tsx` | نفس التعديل بالحرف. |
| `useCaseActions.ts` — `handleSaveCase` (INSERT) | الـ`payload` بقى مابيحطش أي عمود من الأعمدة القديمة خالص — بس `client_id` + الأعمدة الحقيقية التانية (`court_level`, `circuit_number`, `next_hearing`...). |
| `useCaseActions.ts` — `handleUpdateCase` (UPDATE) | نفس تعديل `handleSaveCase` بالحرف. |
| `useCaseActions.ts` — رسالة تيليجرام "قضية جديدة" | كانت بتقرا `form.plaintiff/form.defendant` (بقوا مش بيتبعتوا من الفورم أصلاً بعد التعديل فوق). دلوقتي بتشتق أول طرف في كل جهة مباشرة من `form.parties` (نفس مصدر `case_parties` الحقيقي) — **صفر فقدان معلومة في رسالة التيليجرام**. |
| `useCaseActions.ts` — `handleLinkClient` (ربط قضية موجودة بموكل) | كان بيزامن `plaintiff/plaintiff_national_id/plaintiff_power_of_attorney/plaintiff_address` من ملف الموكل مع كل عملية ربط (خطة "توحيد مصدر بيانات الموكل" سابقة) — مصدر كتابة خامس مكتشف. دلوقتي بيحدّث `client_id` بس. |

### ليه الأمان هنا مضمون
- **مفيش أي قراءة اتبنت على الأعمدة دي بعد اليوم** — كل شاشات العرض (كالندر/
  داشبورد/بحث/AI/تيليجرام Edge Function) بقت كلها بتقرا من `case_parties`
  أو `MappedCase.parties` (مراحل B.1-D، كلها مؤكدة قبل كده).
- القضايا/الجلسات القديمة اللي لسه معتمدة فعليًا على الأعمدة دي (92 قضية،
  رقم المرحلة A) **مالهاش علاقة بالتعديل ده** — التعديل بيوقف الكتابة
  المستقبلية بس، البيانات القديمة المخزّنة فعلاً في الأعمدة لسه موجودة
  زي ما هي لحد ما F.4 (الـDROP الفعلي) يحصل.
- `plaintiff_legal_title`/`defendant_legal_title` **لسه بيتحركوا في الكود**
  (فورم → `validateParties`) لكن **مبقوش بيتكتبوا على أي عمود** — استخدامهم
  دلوقتي فاليديشن-فقط، مش تخزين.

### تحقق كود ثابت (بدون تشغيل build كامل — بيئة بدون `node_modules`)
اتشغّل `tsc` على الملفات التلاتة المعدّلة. الأخطاء الوحيدة: "cannot find
module" المتوقعة (react، مسارات `@/...`) + أخطاء `__dbWrite`/`ImportMeta.env`
الموجودة أصلًا من كل مرحلة سابقة (غير متعلقة بالتعديل). **صفر أخطاء متعلقة
فعليًا بالتعديل نفسه** — لا في الحقول اللي اتشالت، ولا في رسالة التيليجرام
الجديدة، ولا في `handleLinkClient`. التوصية زي كل مرحلة سابقة: شغّل
`npm run type-check` و`npm test` محليًا قبل الدمج.

### ملاحظة عن الاختبارات (Unit/E2E)
مفيش تعديل على أي ملف `.test.ts` في F.1 — الاختبارات الحالية اللي بتتحقق
من `plaintiff`/`defendant` في الـ`payload` المُرسل لـ`__dbWrite` (لو موجودة)
محتاجة مراجعة بعد أول تشغيل CI حقيقي، لأنها ممكن تفشل دلوقتي (الحقول
مبقتش موجودة في الـpayload خالص، مش بس فاضية). ده بند لازم يتفحص في أول
تشغيل CI بعد F.1 — مش حاجة اتأكدت أوفلاين من غير build حقيقي.

---

## المرحلة F.2 — مسار الجلسة المستقلة ✅ **مكتملة (6 أغسطس 2026)**

### الفكرة
نفس فكرة F.1 بالحرف بس لمسار الجلسة المستقلة: التلات ملفات كانوا بيزامنوا
نسخة من "الطرف الأساسي" على أعمدة `case_sessions.plaintiff/defendant/...`
جنب `case_parties` الحقيقي. دلوقتي وقّفنا المزامنة الميتة دي — مع مراعاة
إن `SessionUpdateModal.tsx` (المصدر الرابع الأصلي، تصحيح تحديث 6) لسه بيعتمد
على `copySessionPartiesToNewSession` (نسخ `case_parties` الحقيقي، موجود من
قبل) عشان الجلسة الجديدة تاخد كل الأطراف صح — مش على الأعمدة القديمة أبدًا.

### الملفات المعدّلة
| الملف | التغيير |
|---|---|
| `NewStandaloneSessionModal.tsx` | INSERT الجلسة الجديدة بقى مابيبعتش `plaintiff/plaintiff_role/plaintiff_national_id/plaintiff_power_of_attorney/defendant/defendant_role/defendant_national_id/plaintiff_legal_title/defendant_legal_title`. `primaryPlaintiff/primaryDefendant` لسه محسوبين ومستخدمين في رسالة تيليجرام + `formForLinking` (لسه لازمين لمسار التحويل/الربط في `caseSessionLinkingShared.ts`/`useClientLinking.ts` — F.3 الجاية هي اللي هتوقفهم من هناك). |
| `SessionUpdateModal.tsx` | INSERT الجلسة القادمة (المصدر الرابع) بقى مابيبعتش نفس الأعمدة دي خالص — `copySessionPartiesToNewSession` (موجودة من قبل) هي اللي بتنسخ كل أطراف الجلسة الحقيقيين لـ`case_parties` الجلسة الجديدة. برمتر `linkedClient` بقى مش مستخدم جوه الملف (كان بيتاخد منه بيانات الموكل للمزامنة القديمة) — سايبينه في التوقيع من غير ما نلمس الـcaller (`noUnusedParameters=false`، مفيش خطر build). |
| `StandaloneSessionDetailModal.tsx` | UPDATE بيانات الجلسة عند التعديل بقى مابيبعتش نفس الأعمدة. مزامنة "هوية القضية" لباقي جلسات نفس السلسلة (`syncSessionIdentityToGroupSiblings`) بقت برضه مابتبعتش بيانات الأطراف — الدالة المشتركة نفسها في `caseSessionLinkingShared.ts` متلمستش (باراميتر `identityData: Record<string, unknown>` عام، الـcaller هو اللي بيحدد المحتوى). |

### ليه الأمان هنا مضمون
- نفس منطق F.1: **مفيش أي قراءة اتبنت على الأعمدة دي في `case_sessions`
  بعد مراحل B.1-B.4** — كل العرض بيقرا من `case_parties`/`derivePartiesDisplay`.
- `SessionUpdateModal.tsx` تحديدًا كان أخطر ملف (كان بيكتب بيانات **جديدة**
  فعليًا لجلسة جديدة، مش مجرد مزامنة قضية موجودة) — دلوقتي بيعتمد 100%
  على نسخ `case_parties` الحقيقي، صفر اعتماد على الأعمدة القديمة.
- `formForLinking`/`primaryPlaintiff`/`primaryDefendant` في
  `NewStandaloneSessionModal.tsx` **لسه موجودين عمدًا** — مش جزء من F.2،
  لسه بيتغذّي بيهم مسار التحويل/الربط (F.3) لحد ما هو نفسه يتنضّف.

### تحقق كود ثابت (بدون تشغيل build كامل — بيئة بدون `node_modules`)
اتشغّل `tsc` على التلات ملفات. نفس نمط كل مرحلة سابقة: الأخطاء الوحيدة
"cannot find module"/`__dbWrite`/`ImportMeta.env` المتوقعة، **صفر أخطاء
متعلقة فعليًا بالتعديلات نفسها**. التوصية زي كل مرحلة: `npm run type-check`
و`npm test` محليًا قبل الدمج — خصوصًا هنا لازم تتأكد إن أي اختبار E2E
بيتحقق من الجلسة القادمة (`SessionUpdateModal`) بيشوف الأطراف من
`case_parties` مش من الأعمدة القديمة.
---

## المراحل الباقية

- **F.3 — مسارات الربط/التحويل:** `caseSessionLinkingShared.ts` (المشترك
  خلف تحويل جلسة مستقلة لقضية + ربط موكل)، `useClientLinking.ts`،
  `useSessionLinking.ts` — دول بيزامنوا الأعمدة القديمة في سياقات ربط
  أعقد (تحتاج فحص كل حالة استخدام لوحدها قبل الحذف). دي آخر مصادر
  الكتابة المتبقية.
- **F.4 — التأكيد النهائي + الـDROP الفعلي:** بعد F.3، يتعمل `grep`
  شامل نهائي للتأكد إن صفر مكان في الكود لسه بيكتب على الأعمدة القديمة،
  + تشغيل `npm run build`/`npm test` حقيقي (مش تحقق أوفلاين بس)، + بعدين
  migration الـ`DROP COLUMN` نفسها. **الخطوة دي ميتعملش قبل ما تأكد إنك
  راقبت (E) وإن كل حاجة شغالة صح على بيانات حقيقية** — القرار الفعلي
  لتنفيذها ليك.

---

## جدول الحالة المحدّث

| الطبقة | الحالة الفعلية | يمنع التفكيك؟ |
|---|---|---|
| الكتابة (Write) — **مسار القضية** | ✅ F.1 مكتملة | لأ |
| الكتابة (Write) — **مسار الجلسة المستقلة** | ✅ **F.2 مكتملة** | لأ |
| الكتابة (Write) — **مسارات الربط/التحويل** | ⏳ لسه بتكتب — F.3 الجاية (آخر مصدر متبقي) | أيوه (لسه) |
| القفل/الربط (Edit-lock) | ✅ خلص فعليًا | لأ |
| العرض القرائي (Display) — الكل (كالندر/داشبورد/بحث/أنواع مركزية) | ✅ **مرحلة B كلها مقفولة** | لأ |
| المستندات/AI | ✅ C اتحقّقت | لأ |
| Edge Function | ✅ D مكتملة | لأ |
| قاعدة البيانات (تأكيد صفر فقدان بيانات) | ✅ اتأكدت (مرحلة A) | لأ |
| نافذة المراقبة الحية (E) | ⏸️ مؤجلة من المستخدم لآخر الخطة — يعملها براحته | — |
