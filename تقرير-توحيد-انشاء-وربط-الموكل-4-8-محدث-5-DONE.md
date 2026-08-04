# تقرير حالة — توحيد منطق "إنشاء/ربط الموكل" — الخطة كاملة (مكتملة)

> يحل محل `...-4-8-محدث-4-Phase3-Phase4-DONE.md`. Phase 3 (جانب الجلسة) + Phase 4 (تستات
> الحالتين) + سيناريو E2E خلصوا كلهم دلوقتي. **الشبكة لسه مقفولة هنا** — راجعت كل ملف
> بـ`node --experimental-strip-types --check` (صفر أخطاء parsing)، لكن **لازم تشغّل
> `npm run test` + `tsc --noEmit` + الـE2E فعليًا عندك** قبل الـ merge — ده لسه ما اتعملش.

---

## ✅ Phase 3 — جانب الجلسة المستقلة (زي التقرير السابق، كاملة)
`useSessionLinking.ts` + `StandaloneSessionDetailModal.tsx` — التفاصيل الكاملة في التقرير
السابق (`محدث-4`)، ملخّص: زرار "🔗 ربط بموكل موجود" بقى مستقل لكل طرف (فولباك كامل للجلسات
القديمة)، بيتخطى فحص التعارض لو فيه طرف محدد، وبيرجع لـ`idle` (مش يقفل) بعد النجاح — تمامًا
زي جانب القضية.

## ✅ Phase 4 — تستات (الحالتين كاملين دلوقتي)

### `src/features/calendar/hooks/useSessionLinking.test.ts` (كانت خلصت في الرد اللي فات)
`describe` جديد فيه 6 حالات لـ `startExistingClientSearch`/`cancelExistingClientSearch`/
`confirmLinkToExistingClient` (طرف تاني، طرف أساسي، والمسار القديم بلا طرف محدد).

### 🆕 `src/features/cases/hooks/useCaseActions.test.ts`
مكانش فيه أي تست لـ `handleLinkClientForParty` (ولا حتى `handleLinkClient` القديمة) خالص —
أضفت `describe('handleLinkClientForParty')` بـ4 حالات:
1. طرف أساسي (`isPrimaryParty=true`) → `UPDATE:case_parties` **و** `UPDATE:cases` مع بعض
   (بالترتيب اللي بينداه `linkClientToParty`)، توست نجاح فيه اسم الموكل، `logActivity`،
   `fetchCases(0, 'all')`، و`onAfterLink()`.
2. طرف غير أساسي (`isPrimaryParty=false`) → `UPDATE:case_parties` **بس**، مفيش
   `UPDATE:cases` ولا `fetchCases` — لكن `onAfterLink()` لسه بتتنادى (عشان الواجهة تحدّث
   `caseParties` فورًا حتى لو مش الطرف الأساسي).
3. فشل تحديث `case_parties` (`error`) → `showErrorToast`، مفيش `logActivity`/`fetchCases`/
   `onAfterLink` — وقف فوري.
4. الموكل مش موجود في `clients[]` الممرّرة (id مش معروف محليًا) → توست نجاح من غير اسم
   الموكل في الرسالة (نفس فولباك `linkedClient?.full_name ? ... : ''` في الكود الحقيقي).

هذا التست بيستخدم `window.__dbWrite` الموك الموجود بالفعل في الملف (نفس نمط باقي التستات) —
`linkClientToParty` (من `caseSessionLinkingShared.ts`) مش موك، بتتنفّذ فعليًا وتعدي عن طريقه،
فبنتحقق من شكل نداءاته الحقيقية بدل استدعاء دالة موك مباشرة.

### 🆕 `e2e/standalone-sessions.spec.ts` — تست 10 (جديد)
**"ربط طرف من جلسة مستقلة بموكل موجود بالفعل (🔗 ربط بموكل موجود)"** — بيغطي المسار الجديد
كامل: `createClient` (موكل جاهز) → `createStandaloneSession` (طرف مدعي ⭐ واحد) → فتح
"🔗 ربط" → الزرار الجديد `idlePartyList`-per-party → بحث ← اختيار الموكل → "تأكيد الربط" (من
غير أي شاشة تعارض، لأن `case_parties` لسه فاضية من بيانات حرة قديمة) → توست النجاح بالنص
الكامل (`✅ تم ربط "..." بـ"..."`) → التأكد إن زرار الطرف ده اختفى (`linkedIdlePartyIds`)
ومفيش تسكير للموديل (بيرجع لـ`idle`، مش `done`).

⚠️ التست ده لسه **ما اتشغّلش فعليًا** (محتاج Playwright + Supabase حقيقي، الشبكة هنا مقفولة)
— راجعت الـ`data-testid`s والمنطق يدويًا بمطابقتها لكود `StandaloneSessionDetailModal.tsx`
و`useSessionLinking.ts` الفعلي، لكن أول تشغيل حقيقي عندك هو الاختبار الحاسم.

## ما اتعملش خالص لسه
- تشغيل `npm run test` (vitest) و`tsc --noEmit` و`npx playwright test e2e/standalone-sessions.spec.ts`
  فعليًا — الشبكة هنا مقفولة تمامًا (مفيش `npm install` حتى).
- لو التستات الجديدة كشفت أي فرق بين افتراضاتي وسلوك الكود الفعلي (مثلاً ترتيب نداءات
  `__dbWrite`، أو رسالة توست مختلفة شوية)، سهل نظبطها بمجرد ما تشوف نتيجة أول تشغيل.

## الملفات المعدَّلة في هذه الدفعة (فوق الدفعة اللي فاتت)
- `src/features/cases/hooks/useCaseActions.test.ts` 🆕 4 تستات جديدة (`handleLinkClientForParty`)
- `e2e/standalone-sessions.spec.ts` 🆕 تست 10 جديد

## الخطوة الجاية
1. `npm install` + `npm run test` + `tsc --noEmit` عندك.
2. `npx playwright test e2e/standalone-sessions.spec.ts` (أو التست 10 بس أول مرة).
3. لو كل حاجة عدّت — الخطة كاملة، جاهزة للـ merge/build/deploy.
