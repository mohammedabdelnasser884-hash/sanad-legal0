# تقرير حالة — مودال تحذير الإغلاق المخصص بدل window.confirm
تاريخ: 3 أغسطس 2026

## الخلاصة
اتقفل آخر قرار مفتوح من التقرير رقم 7: `useUnsavedChangesGuard` بقى
بيعرض مودال مصمم بشكل التطبيق بدل `window.confirm` الافتراضي بتاع
المتصفح.

## اللي اتعمل
### 1. `UnsavedChangesConfirmModal.tsx` (جديد)
مودال جديد في `src/shared/modals/` — نفس نمط `ExitConfirmModal.tsx`
الموجود بالفعل بالحرف (أيقونة دايرة + عنوان + وصف + زرارين في شبكة)،
بس بلون تحذير كهرماني بدل الأحمر. `z-[95]` — أعلى من أي فورم بيستخدمه
(أعلى واحد فيهم `z-[80]`) وأعلى من تأكيدات الحذف (`z-[90]`)، وأقل من
تأكيد الخروج من التطبيق (`z-[9999]`). فيه `data-testid` لكل من الزرارين
(`unsaved-changes-confirm` / `unsaved-changes-cancel`) والمودال نفسه.

### 2. `useUnsavedChangesGuard.ts`
بدل ما ينده `window.confirm` جوه `guardedClose`، دلوقتي بيمسك
`isConfirmOpen` state ويرجّع `{ guardedClose, confirmModal }` بدل
الدالة لوحدها. نفس منطق الـ`isDirty` (مقارنة `JSON.stringify`) فضل
زي ما هو تمامًا.

### 3. الأماكن الستة اللي بتستخدم الهوك
كل واحد فيهم اتعدّل بنفس النمط: `const guardedClose = ...` بقت
`const { guardedClose, confirmModal } = ...`، والريتيرن بتاعه بقى
لافّه Fragment ضايف `confirmModal` كسبلينج:
- `NewCaseModal.tsx`
- `EditCaseModal.tsx` (فورم `EditCaseModalForm`)
- `NewClientModal.tsx`
- `EditClientModal.tsx` (جوه الـ`createPortal` نفسه)
- `NewStandaloneSessionModal.tsx` (كان أصلاً بيرجّع Fragment، بس ضفنا
  `confirmModal` كطفل تالت)
- `StandaloneSessionDetailModal.tsx` (فورم `EditStandaloneModalForm`)

## الفحص
كل الملفات التمانية اتفحصت syntax-wise بـTypeScript
(`transpileModule`) — صفر أخطاء. اتأكدت كمان إن `confirmModal` متستخدمة
فعليًا (مش تعريف من غير استخدام) في كل الأماكن الستة.

## تحديث (مراجعة ثانية — نفس اليوم)
راجعت الكود تاني بحثًا عن أخطاء منطقية/UX. لقيت نقطة واحدة حقيقية:
**زر الرجوع الفعلي (Android/PWA) كان بيقفل المودال مباشرة من غير أي
تحذير خالص**، لأن `useNavigation.ts` بيتعامل مع المودالات دي (قضية
جديدة/تعديل قضية/موكل جديد/تعديل موكل/جلسة مستقلة جديدة/تعديل جلسة
مستقلة) كـ"مودال رئيسي" عادي (`onPop` → Case 1)، واللي بيقفله على طول
من غير ما يعدي على `guardedClose` أصلاً. ده كان موجود حتى قبل التعديل
ده (مع `window.confirm` القديم كان بردو بيتخطى نفس الحاجة) — مش رجعة
للخلف، بس قرر حضرتك نقفلها.

### الحل
استخدمت آلية `registerNestedModal` الموجودة بالفعل في `useNavigation.ts`
(نفس اللي بيستخدمه `useNestedModalBackButton.ts` لنماذج فرعية زي
`PartySubform.tsx`) — بتسجّل دالة قفل كـ"نموذج فرعي"، وde `onPop`
بيفحصها **قبل** أي حاجة تانية.

في `useUnsavedChangesGuard.ts`: بقى فيه تسجيل إضافي (`useEffect` معتمد
على `regEpoch`) بينده `registerNestedModal` بنفس منطق `isDirty`
بالظبط — لو مفيش تغييرات يقفل على طول، ولو فيه يعرض `confirmModal`.
النقطة الدقيقة: `registerNestedModal` بيتشال من الستاك تلقائيًا أول ما
زر الرجوع يستدعيه، فلو المستخدم قرر "إلغاء" (يفضل في الفورم)، لازم
نسجّله تاني فورًا عشان ضغطة رجوع تانية تتحمي برضو — ده اللي بيعمله
`regEpoch` (بيزيد رقم فبيتسجل تاني عن طريق نفس الـ`useEffect`). فحصت
المنطق ده خطوة بخطوة (تتبع push/replace history entry) وبيرجّع نفس
عمق الـhistory بالظبط بعد كل دورة (مفيش تراكم إضافي).

مفيش أي تعديل مطلوب في الأماكن الستة نفسها (`NewCaseModal.tsx`
وباقي الخمسة) — كلهم بياخدوا `{ guardedClose, confirmModal }` بنفس
الشكل من غير تغيير، فالإصلاح كله محصور في الهوك المشترك بس.

### الفحص
كل الملفات التمانية + `useNavigation.ts` نفسه اتفحصوا بـ`transpileModule`
تاني — صفر أخطاء. مفيش أي E2E test بيتعامل مع زر الرجوع الفعلي
(`goBack`/`history.back`) حاليًا، فمفيش خطر كسر تست موجود.

## الخطوة الجاية
لو حابب:
1. نراجع سوا كمستخدم — افتح أي فورم، اكتب حاجة، دوس ✕ (أو زر رجوع
   الموبايل لو بتجرب على PWA)، شوف المودال الجديد طالع بدل ما يقفل
   على طول.
2. ننتقل لأي بند تاني في المشروع.
