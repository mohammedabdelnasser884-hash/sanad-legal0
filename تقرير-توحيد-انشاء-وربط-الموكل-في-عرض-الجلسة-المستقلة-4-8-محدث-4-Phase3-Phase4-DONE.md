# تقرير حالة — توحيد منطق "إنشاء/ربط الموكل" — Phase 3 + Phase 4 (مكتملتين)

> يحل محل النسخة السابقة (`...-4-8-محدث-3-Phase3-WIP.md`). Phase 3 (جانب الجلسة المستقلة)
> اتكمّلت بالكامل، وأضفنا Phase 4 (تستات) للفانكشنز الجديدة في الحالتين (القضية والجلسة).
> **الشبكة لسه مقفولة هنا** — راجعت الكود يدويًا + `node --experimental-strip-types --check`
> على كل ملف اتلمس (صفر أخطاء parsing)، لكن مقدرتش أشغّل `vitest`/`tsc` فعليًا. لازم تشغّلهم
> عندك قبل الـ merge.

---

## ✅ Phase 3 — جانب الجلسة المستقلة (خلصت بالكامل دلوقتي)

### `src/features/calendar/hooks/useSessionLinking.ts`
أضفت الدالتين الناقصتين + صدّرتهم من الهوك:
- **`startExistingClientSearch(party: SessionClientParty | null)`** — بتحدّد
  `existingClientTargetPartyId` (`null` = المسار القديم، الجلسة كلها)، تصفّر
  `clientSearch`/`searchResults`/`selectedExistingClient`، وتفتح `clientStep('searching')`.
- **`cancelExistingClientSearch()`** — عكسها بالظبط: رجوع لـ `idle` + تصفير كل حالة البحث
  (بما فيها `existingClientTargetPartyId` نفسه، عشان مايفضلش عالق لطرف سابق لو المستخدم فتح
  البحث تاني لطرف مختلف).
- الـ `return` statement بقى مصدّر: `existingClientTargetPartyId, startExistingClientSearch,
  cancelExistingClientSearch`.

`confirmLinkToExistingClient` (كانت اتعدّلت جزئيًا في الدفعة اللي فاتت) فضلت زي ما هي — الفرع
بتاعها بيستخدم `existingClientTargetPartyId` اللي بقى دلوقتي فعليًا قابل للتفعيل من الواجهة.

### `src/features/calendar/sessions-calendar/StandaloneSessionDetailModal.tsx` — 4 نقط كاملة
1. `LinkSessionModal` الـ destructuring من `useSessionLinking()` بقى شايل
   `existingClientTargetPartyId, startExistingClientSearch, cancelExistingClientSearch`
   (وشلت `setClientStep` لأنها بقت مش مستخدمة مباشرة في الملف ده خالص).
2. **خطوة `idle`:** زرار "🔗 ربط بموكل موجود بالفعل" الواحد اتحول لنمط `idlePartyList`-per-party
   **بالحرف زي** زرار "إضافة موكل" المجاور — زرار مستقل لكل طرف مش مربوط
   (`idlePartyList.filter(p => !linkedIdlePartyIds.has(p.id))`)، بيفتح
   `startExistingClientSearch(party)`. جلسة قديمة/بلا `case_parties`
   (`idlePartyList.length === 0`) → فولباك كامل للزرار الواحد القديم
   (`startExistingClientSearch(null)`)، صفر تغيير سلوك.
3. **خطوة `searching`:** العنوان بقى بيعرض اسم الطرف المستهدف لو موجود
   (`ابحث عن موكل لـ "فلان"` بدل `ابحث عن موكل موجود`)، وزرار "تأكيد الربط" بقى بيتخطى
   `findClientDataMismatches` كليةً لو فيه `existingClientTargetPartyId` (نفس قرار
   `InfoSection.tsx` بالحرف — `case_parties` بيحتفظ ببياناته لكل طرف على حدة). المسار القديم
   (`target = null`) فضل فحص التعارض زي ما هو بالظبط.
4. زرار "رجوع" بقى بيستخدم `cancelExistingClientSearch()` بدل `setClientStep('idle')` المباشر
   (فرع `showMismatchConfirm` فضل زي ما هو — "إلغاء" بيرجع لخطوة البحث نفسها مش `idle`).

**النتيجة:** جانب الجلسة المستقلة بقى مطابق تمامًا لجانب القضية (`InfoSection.tsx`) — تقدر
تربط أي طرف من أطراف الجلسة بموكل موجود على حدة، مش بس الجلسة كلها كوحدة واحدة.

---

## ✅ Phase 4 — تستات (جزء الجلسة، اللي كان أولوية)

### `src/features/calendar/hooks/useSessionLinking.test.ts`
`describe` جديد: **`startExistingClientSearch / cancelExistingClientSearch /
confirmLinkToExistingClient (طرف بعينه)`** — 6 حالات:
1. `startExistingClientSearch(party)` → `existingClientTargetPartyId` = id الطرف، `clientStep
   = 'searching'`، وحالة البحث القديمة اتصفّرت.
2. `startExistingClientSearch(null)` → `existingClientTargetPartyId = null` (المسار القديم).
3. `cancelExistingClientSearch` → رجوع لـ `idle` + تصفير كل حاجة.
4. `confirmLinkToExistingClient` مع طرف تاني (مش أساسي) → `UPDATE:case_parties` **بس**، مفيش
   `UPDATE:case_sessions`، الطرف بيتضاف لـ `linkedIdlePartyIds`، ورجوع لـ `idle` (مش `done` —
   زي `handleAddClientOnlyForParty` بالظبط، عشان تقدر تربط طرف تاني على طول).
5. `confirmLinkToExistingClient` مع أول طرف (أساسي) → `UPDATE:case_parties` **و**
   `UPDATE:case_sessions.client_id` مع بعض.
6. `confirmLinkToExistingClient` من غير `existingClientTargetPartyId` (المسار القديم) →
   `UPDATE:case_sessions` بالحقول الحرة التلاتة (`plaintiff`, `plaintiff_national_id`,
   `plaintiff_power_of_attorney`) زي ما كان بالظبط، مفيش `UPDATE:case_parties`، `clientStep =
   'done'` — صفر تغيير سلوك.

### ⚠️ ناقص لسه (Phase 4 بتاعة جانب القضية)
تستات مكافئة لـ `handleLinkClientForParty` في
`src/features/cases/hooks/useCaseActions.ts` (الجانب اللي خلص في الدفعة اللي فاتت) —
مكانش موجود وقت كده، ولسه مش مكتوب. لو عايز أكمله في الرد الجاي قولي.

### ما اتعملش خالص لسه
- اختبار يدوي (E2E) — الملف الموجود `e2e/standalone-sessions.spec.ts` مبيغطيش خطوة "ربط بموكل
  موجود" أصلاً (راجعته، مفيش أي `data-testid` بتاعها فيه) — ممكن نضيف سيناريو جديد لو حابب.
- تشغيل `npm run test` + `tsc --noEmit` فعليًا عندك (الشبكة هنا مقفولة، فمقدرتش أعمل
  `npm install`/`vitest run` — راجعت الكود والـ syntax يدويًا بس).

## الملفات المعدَّلة في هذه الدفعة
- `src/features/calendar/hooks/useSessionLinking.ts` ✅ مكتمل (الدالتين + التصدير)
- `src/features/calendar/sessions-calendar/StandaloneSessionDetailModal.tsx` ✅ مكتمل (4 نقط)
- `src/features/calendar/hooks/useSessionLinking.test.ts` ✅ تستات جديدة (6 حالات)

## الخطوة الجاية (اختياري)
1. تستات `handleLinkClientForParty` (جانب القضية، `useCaseActions.ts`).
2. سيناريو E2E لـ "ربط بموكل موجود" (جلسة مستقلة، طرف بعينه).
3. تشغيل `npm run test` + `tsc --noEmit` عندك للتأكد قبل merge.
