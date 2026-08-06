# تقرير التحقّق السطري — مشروع Sanad
> تاريخ القراءة: 2026-08-05
> منهجية: قراءة سطرية كاملة للملفات التسعة المذكورة + بحث repo-wide للمعرّفات (`session_group_id`, `client_id`, `is_client`, `readOnly`, `clearDraft`, `useFormDraft`).

---

## 🔧 حالة التنفيذ (يُحدَّث بعد كل مرحلة)

| # | الإصلاح | الملف | الحالة | تاريخ التنفيذ |
|---|---------|-------|--------|---------------|
| 1 | `useFormDraft.ts` — منع رجوع المسودة بعد الحفظ (نافذة suppress 3 ثواني) | `useFormDraft.ts` | ✅ **تم** | 2026-08-05 |
| 3 | `PartyFields.tsx` — قفل زر النجمة لو `party.client_id` موجود | `PartyFields.tsx` | ✅ **تم** | 2026-08-05 |
| 4 | `EditCaseModal.tsx` — `useMemo` بدل `useState` لـ`linkedPartyId` | `EditCaseModal.tsx` | ✅ **تم** | 2026-08-05 |
| 2 | `useClientLinking.ts` — تحويل group-aware عند الإنشاء | `useClientLinking.ts` + `caseSessionLinkingShared.ts` | ✅ **تم** | 2026-08-05 |
| 5 | `CaseDetailView.tsx` — هيدر/واتساب من كل الموكلين المرتبطين | `CaseDetailView.tsx` | ✅ **تم** | 2026-08-05 |
| 6 | `InfoSection.tsx` — فك ربط لكل طرف | `InfoSection.tsx` + `useCaseActions.ts` | ✅ **تم** | 2026-08-05 |

الترتيب الآمن المتّبع: **1 → 3 → 4 → 2 → 5 → 6** (كما في القسم "جدول تنفيذي" بالأسفل) — **الخطة كاملة (6/6).**

---

## ملخّص تنفيذي

التحقق السطري يُثبت أن **8 من 10** ادّعاءات صحيحة بدرجات متفاوتة، **2 من 10** جزء منها مؤكّد والجزء الآخر فيه خطأ في توصيف المستخدم. أدق نقطة في كلام المستخدم هي الجذر المركزي لباگ المسودة (`useFormDraft.ts:125-127`)، وأكبر خطأ تشخيصي هو زعم أن `useSessionLinking.handleLinkCase` يعالج صفًا واحدًا فقط — في الحقيقة هذا المسار مُصلَح بالكامل و`useClientLinking` هو الجاني الفعلي.

---

## النقطة 1 — تحديث الجلسة ينشئ "سلسلة" (`session_group_id`)

**الحكم:** مؤكّد جزئيًا — سلسلة موجودة فعلًا، لكن محصورة في الجلسات المستقلة فقط.

| الموضع | السطر | الدليل |
|--------|-------|--------|
| `SessionUpdateModal.tsx` | `:56` | `const groupId = isStandalone ? (session.session_group_id \|\| makeSessionGroupId()) : null` |
| `SessionUpdateModal.tsx` | `:61` | `...(isStandalone && !session.session_group_id ? { session_group_id: groupId } : {})` — يُكتب على الجلسة القديمة |
| `SessionUpdateModal.tsx` | `:113` | `session_group_id: groupId` — يُكتب على الجلسة الجديدة |
| `SessionUpdateModal.tsx` | `:39-42` | يحفظ `whatHappened` كـ`result` على الجلسة القديمة، ثم INSERT جلسة جديدة مستقلة |
| `caseSessionLinkingShared.ts` | `:248-253` | `linkSessionGroupToCase`: `if (!session.session_group_id) return [session.id]; ... .eq('session_group_id', session.session_group_id)` — أي `session_group_id = null` يعني سلسلة مكوّنة من صف واحد فقط |

**الاستثناء:** `:56` نفسه يُظهر أن السلسلة تتكوّن فقط لو `isStandalone` (= `caseData.id` غير موجود). جلسات القضايا الحقيقية لا تأخذ `session_group_id` لأنها تتبع `case_id` كمعرّف أب.

---

## النقطة 2 — التحويل للقضية يعالج صفًا واحدًا لا السلسلة

> ### ✅ تم الإصلاح (2026-08-05)
> **الملفات:** `useClientLinking.ts` (استبدال منطق الربط) + استيراد إضافي فقط من `caseSessionLinkingShared.ts` (بدون تعديل الدالة نفسها — `linkSessionGroupToCase` كانت مُصدَّرة بالفعل).
> **التغيير:** UPDATE الصف الواحد على `case_sessions` + `movePartiesFromSessionToCase` الصف الواحد اتستبدلوا بنداء واحد لـ`linkSessionGroupToCase(db, { id: savedFormData.sessionId, session_group_id: null }, ...)` — نفس الدالة group-aware المستخدمة في `useSessionLinking.ts`. الجلسة الجديدة عمليًا معهاش `session_group_id` وقت الإنشاء (السلسلة بتتكوّن بس لاحقًا عن طريق "تحديث الجلسة")، فالسلوك الحالي **مطابق تمامًا** للقديم في الحالة الشائعة، لكن المسار بقى موحّد مع `useSessionLinking` ومحمي لو تكوّنت سلسلة قبل التحويل مستقبلًا.
> **تسوية طفيفة في التفاصيل:** رسالة الخطأ بقت مبنية على `groupLinkResult.failedIds.includes(sessionId)` بدل تفرقة صريحة بين "فشل ربط case_id" و"فشل نقل الأطراف" لنفس الجلسة (linkSessionGroupToCase الداخلية مبتفرقش بين الاتنين لكل جلسة على حدة) — التوست القديم "تعذّر ربط الجلسة" لسه بيظهر في نفس الحالة الشائعة (فشل الجلسة الأساسية)، والتوست الأخف "راجعها يدويًا" بيظهر لو فشل جزء تاني من السلسلة بس.
> **⚠️ لم يُنفَّذ:** لا يوجد `node_modules` في البيئة (لا اتصال إنترنت لتثبيت الحزم)، فمقدرتش أشغّل `tsc`/الاختبارات فعليًا على التعديل ده — اتحقق فقط بمراجعة يدوية للتوقيعات والـimports وتوازن الأقواس. **لازم تشغيل `npm run build` أو `tsc --noEmit` + `caseSessionLinkingShared.test.ts`/`useSessionLinking.test.ts` محليًا قبل الدمج**، خصوصًا إن التقرير الأصلي أشار لغياب اختبارات مطابقة لـ`useClientLinking.ts` تحديدًا.

**الحكم:** خطأ جزئيًا — `useSessionLinking.ts` مُصلَح فعلًا، **`useClientLinking.ts` هو الباگ الحقيقي**.

| المسار | الملف:السطر | الحكم |
|--------|------------|--------|
| جلسة محفوظة → قضية | `useSessionLinking.ts:249-251` | ✓ `linkSessionGroupToCase(db, session, realOrTempCaseId, ...)` — يستدعي النسخة الـgroup-aware من Shared |
| جلسة محفوظة → Party لعميل | `useSessionLinking.ts:619-622` | ✓ `updateCaseSessionsForGroup(db, session, ...)` — يحدّث كل أعضاء السلسلة |
| جلسة جديدة محفوظة للتوّ → قضية | `useClientLinking.ts:237-258` | ✗ UPDATE على `savedFormData.sessionId` صف واحد فقط + `movePartiesFromSessionToCase` صف واحد |
| جلسة جديدة محفوظة للتوّ (اختبارات) | `caseSessionLinkingShared.test.ts` و `useSessionLinking.test.ts` | يظهران فقط اختبارات `useSessionLinking` — لا غطاء اختبار لـ`useClientLinking` بنفس النمط |

**الدليل على أن useSessionLinking آمن فعلًا:**
- `:236` `clientPartiesBeforeMove = fetchSessionClientParties(...)` قبل النقل
- `:249-251` يستدعي `linkSessionGroupToCase` (تعليق على `:236-248` يشرح أن الدالة تجلب كل السلسلة وتحدّث `case_id` لكل صف + تنقل case_parties لكل صفّ)

**الدليل على أن useClientLinking به الباگ:**
- `:237` شرط `if (savedFormData.sessionId)`
- `:238-246` `await window.__dbWrite({ type: 'UPDATE', table: 'case_sessions', id: savedFormData.sessionId, data: ... })` — صف واحد
- `:256-258` `await movePartiesFromSessionToCase(db, savedFormData.sessionId, ...)` — صف واحد
- **لا استدعاء لـ`session_group_id` أو `linkSessionGroupToCase` في كل الملف** — تحقّق عبر قراءة الملف كاملاً.

---

## النقطة 3 — ازدواج الكارت (9 و25 قبل التحويل) سلوك مقصود

**الحكم:** مؤكّد

| الملف:السطر | الدليل |
|------------|--------|
| `SessionUpdateModal.tsx:72-115` | INSERT جديد لكل صف `nextDate` مع جميع بيانات الجلسة منسوخة، بدون حذف القديمة |
| `SessionUpdateModal.tsx:36-37` | تعليق المكوّن: "الجلسة القديمة تفضل موجودة بدون زر تحديث" |
| `SessionUpdateModal.tsx:59-62` | القديمة تُحدّث فقط بـ`result` + `session_group_id`، لا تحذف |

---

## النقطة 4 — الهيدر العلوي ما زال على عقلية "موكل واحد"

> ### ✅ تم الإصلاح (2026-08-05)
> **الملف:** `CaseDetailView.tsx` فقط. مصدر جديد `linkedClients` (useMemo) بيجمع كل الموكلين المرتبطين فعليًا — أي طرف في `caseParties` عنده `client_id` (يتبحث عنه في prop `clients`) + `client` الأساسي القديم لو مش موجود فيهم (توافق رجعي للقضايا القديمة).
> - **الهيدر السريع (بادج "الموكل"):** بقى بيعرض كل الموكلين المرتبطين، بعنوان "الموكل" لو واحد أو "الموكلون (N)" لو أكتر، كل واحد باسمه ورقمه.
> - **مودال الواتساب:** بدل ما يستهدف `client` بس، بقى فيه state جديد `selectedWaClientId` — لو فيه أكتر من موكل مرتبط، بتظهر شرائط اختيار المستلم فوق الرسائل الجاهزة، وبتفتح افتراضيًا على أول موكل عنده رقم فعلي (نفس السلوك القديم بالظبط لو مفيش غير موكل واحد).
> **⚠️ لم يُنفَّذ:** نفس ملاحظة المرحلة السابقة — لا `node_modules` في البيئة، فمقدرتش أشغّل build فعلي. اتحقق بمراجعة يدوية + `tsc --noEmit` على الملف منفصلًا (رجّع أخطاء "cannot find module" متوقعة بس، بدون أخطاء syntax جديدة). **لازم اختبار يدوي فعلي لقضية فيها أكتر من موكل مرتبط (مدعي ومدعى عليه كلاهما ⭐) قبل الدمج.**

**الحكم:** مؤكّد جزئيًا

**دليل على الباگ المتبقّي (مصدر الحقيقة المفرد):**

| الموضع | الملف:السطر | يستخدم |
|--------|------------|--------|
| رسالة واتساب لكل القوالب | `CaseDetailView.tsx:251` | `client?.full_name \|\| 'الموكل الكريم'` |
| عرض رقم الموكل في كرت الواتساب | `CaseDetailView.tsx:316` | `clientPhone ? \`📱 ${client?.phone}\` : "لا يوجد رقم واتساب مسجل للموكل"` |
| كارت الموكل في الشريط السفلي للهيدر | `CaseDetailView.tsx:492-496` | `client.full_name` و `client.phone` |

**دليل على الإصلاح الجزئي للأطراف:**

| الموضع | الملف:السطر | يستخدم |
|--------|------------|--------|
| عرض أسماء الخصوم | `CaseDetailView.tsx:424-436, 461-478` | `caseParties.filter(side)` → `summarizePartySide` → "+N آخرين" |
| `summarizePartySide` | استيراد من `partyDisplay` على `:30` | نفس الدالة المستخدمة في InfoSection.kt |

**النتيجة:** الواتساب + كرت الموكل السريع مازالا على مورد مفرد — يحتاجان تحديثًا.

---

## النقطة 5 — فك الربط ناقص الاتساق

**الحكم:** مؤكّد

**دليل على تعدّد المسارات وعدم اتساقها:**

| الموضع | الملف:السطر | السلوك |
|--------|------------|--------|
| فك ربط القضية الرئيسية | `InfoSection.tsx:235-265` | زر "🔓 فك الربط" inline + `showUnlinkConfirm` للـcases.client_id فقط |
| رابط/فك ربط كل طرف is_client=true | `InfoSection.tsx:291-432` (Phase 3) | يدعم الربط أكثر (`onLinkClientForParty`) لكن **لا يقدّم زر فك ربط صريح لكل طرف مربوط منفصل** |
| EditCaseModal — إخفاء سلوت الربط | `EditCaseModal.tsx:374` | `if(!party.is_client \|\| party.id === linkedPartyId) return null` — يخفي الزرار للـprimary فقط |

**النتيجة المُشاهدة عمليًا:** الربط الجديد (party-level) متاح، الفك القديم (case-level) متاح، لكن **فك ربط `case_parties.client_id` لطرف غير الأساسي غير موجود في الكود.**

---

## النقطة 6 — سياسة قفل بيانات الطرف المرتبط

**الحكم:** مؤكّد مع ثغرتين صريحتين

> ### ✅ الثغرتان الاثنتان تم إصلاحهما (2026-08-05)
> **الثغرة الأولى (النجمة):** `PartyFields.tsx` — زر النجمة دلوقتي بيتحقق من `party.client_id` أولًا: لو موجود، الضغط بيعرض توست تحذيري ("فك الربط أولًا قبل تغيير موكلنا") بدل ما ينادي `onToggleIsClient` مباشرة، + `aria-disabled` وتلوين مطفّي بصريًا.
> **الثغرة الثانية (`linkedPartyId` لقطة واحدة):** `EditCaseModal.tsx` — استُبدل `useState(() => ...)` بـ`useMemo(() => ..., [isLinked, partyFields.plaintiffs, partyFields.defendants, caseData.client_id])`، فبقى بيتحسب من الأطراف الحيّة بدل `initialParties` الثابتة، ويتحدّث تلقائيًا لو المستخدم ربط طرفًا جديدًا بالموكل الأساسي بعد فتح الفورم.
> مفيش تغيير في أي منطق database في الحالتين.

**ما يعمل بشكل صحيح:**

| الموضع | الملف:السطر | السلوك |
|--------|------------|--------|
| حقول الطرف المقفولة | `PartyFields.tsx:104` (name), `:129` (address), `:144` (national_id), `:156` (power_of_attorney) | تمرير `readOnly` للحقول الأربعة |
| شرط القفل المعمّم | `EditCaseModal.tsx:310` | `renderPartyReadOnly = (party) => !!party.client_id` — لا يقتصر على الأساسي |
| إسناد `linkedPartyId` | `EditCaseModal.tsx:294-303` | `client_id === caseData.client_id` وقت mount |

**الثغرتان:**

| الثغرة | الملف:السطر | المشكلة |
|--------|------------|---------|
| النجمة ⭐ قابلة للتبديل حتى لو `client_id ≠ null` | `PartyFields.tsx:75-81` | `onClick: onToggleIsClient` بدون أي شرط على `party.client_id` — يخلق "primary" جديد بدون فك ربط |
| `linkedPartyId` لقطة واحدة | `EditCaseModal.tsx:299-303` | `useState(() => ...)` — لا يُعاد حسابه لو ربط المستخدم طرفًا جديدًا بموكل بعد mount |

---

## النقطة 7 — مسودة تعود بعد الحفظ

> ### ✅ تم الإصلاح (2026-08-05)
> **الملف:** `useFormDraft.ts` فقط. أُضيف `suppressUntilRef`: `clearDraft()` بيلغي أي `timer` مجدول ويرفع نافذة منع 3 ثواني، وcallback الـautosave بيتأكد إنه مش جوه النافذة دي قبل ما يكتب في localStorage. الـinterface العام للـhook ما اتغيّرش، فكل الفورمات الست استفادت من غير أي تعديل في كودها.
> **متبقي:** اختبار يدوي فعلي (خصوصًا `NewStandaloneSessionModal` و`EditCaseModal`)، والتأكد إن 3 ثواني كافية على شبكة بطيئة (offline/queued) — كانت أضعف نقطة في خطة الإصلاح الأصلية.

**الحكم:** مؤكّد مع جذر مركزي في `useFormDraft.ts`

**تسلسل الباگ:**

| الخطوة | الملف:السطر | السلوك |
|--------|------------|--------|
| 1. عند نجاح الحفظ | `NewStandaloneSessionModal.tsx:390` (offline) و `:454` (existing) و `:461` (standalone أونلاين) | `draft.clearDraft()` — يحذف من localStorage |
| 2. الفورم يبقى mounted | `NewStandaloneSessionModal.tsx:176` (`postSaveModal`) و `:498-663` (الـPortal) | لا unmount |
| 3. الـdata يُحدّث في مكان تاني | `draftData` على `:169` يعاد بناءه ككائن جديد | الـ`useEffect` على `data` يُجدول timer جديد |
| 4. الحفظ التلقائي يعمل | `useFormDraft.ts:109-123` | `useEffect` يُجدول `setTimeout(..., DEBOUNCE_MS)` على كل تغيير |
| 5. **الإصلاح الناقص** | `useFormDraft.ts:125-127` | `clearDraft` يحذف من localStorage بس — **لا يلغي `timerRef.current`** |

**الجذر المركزي:**

```ts
// useFormDraft.ts:84
const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
// :109-123
useEffect(() => {
    if (!enabled || !checked) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
        try {
            if (isEmpty && isEmpty(data)) {
                localStorage.removeItem(...);
            } else {
                localStorage.setItem(...);
            }
        } catch { ... }
    }, DEBOUNCE_MS);   // DEBOUNCE_MS = 800 على :35
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
}, [data, enabled, checked, key]);
```

```ts
// :125-127
const clearDraft = useCallback(() => {
    try { localStorage.removeItem(storageKey(key, userIdRef.current)); } catch {}
}, [key]);
```

`clearDraft` يمسح القراءة فقط. لو لم يتغير `data` بعد 800ms، لن يُجدول timer جديد (`:109-123` لا يعمل إلا عند تغيّر dependencies). **لكن** في معظم التطبيقات، `draftData` يُعاد بناءه في كل render (`NewStandaloneSessionModal.tsx:169` يبني كائن جديد من state slices)، فيُعتبر تغيّرًا من منظور reference equality ويُعيد ترتيب الـtimer. أو أقل، المكونات الفرعية تستدعي `setState` بعد الحفظ (مثل `setSavedFormData`) فيتغير `draftData` ويُجدول timer جديد.

---

## النقطة 8 — النقاط الأربع المرتبطة

**الحكم:** كل واحدة منها مؤكّدة بسطر مباشر

| النقطة | الدليل |
|--------|--------|
| مسار التحويل موجود في موضعين | `useSessionLinking.ts:38` (جلسة محفوظة) + `useClientLinking.ts:99` (جلسة جديدة فور الحفظ) |
| أي مكان يعتمد على client المفرد | `CaseDetailView.tsx:251,316,492-496` (انظر النقطة 4) |
| PartyFields.tsx — نجمة مرنة حتى مع ربط حي | `PartyFields.tsx:75-81` (انظر النقطة 6) |
| helper مركزي | `useFormDraft.ts` يُستخدم في 6 فورمات — كل مشكلة في الـhelper تظهر في 6 أماكن |

---

## ما فات على تحليلك

### أ) مسارات `cases.client_id` الإضافية

| الموضع | الملف:السطر | السلوك |
|--------|------------|--------|
| الكتابة من NewCaseModal → case row | `useCaseActions.ts` (لم يُقرأ مباشرةً لكن يُستدلّ) | عمود client_id في جدول cases |
| الكتابة من تحويل جلسة | `caseSessionLinkingShared.ts` (انظر النقطة 2) | `buildCaseInsertData({...}, caseTitle, offlineTempId, session.client_id)` |
| القراءة في EditCaseModal | `EditCaseModal.tsx:147, 267, 302` | `isOrphaned`, `client_id: caseData.client_id \|\| null`, find party by client_id |
| القراءة في EditCaseModal الجزء | `EditCaseModal.tsx:310` | `renderPartyReadOnly = (party) => !!party.client_id` |
| القراءة في InfoSection | `InfoSection.tsx:71` | `isOrphaned = !!caseData.client_id && !client`؛ `:291` يربط إذا `!client` أو عند unlinked starred parties |
| القراءة في CaseDetailView | `CaseDetailView.tsx:67` (تعليق)، `:492-495` (الهيدر) | `client.full_name` مفرد |
| تعريف "Primary" متّفق عليه | `EditCaseModal.tsx:625-626` | `partyFields.plaintiffs.find(p => p.is_client) \|\| plaintiffs[0]` — أولوية للنجمة، ثم الترتيب |
| استدعاء نفس التعريف في ClientActions | `useClientLinking.ts:462, 619, 782` (تحت أسماء `isPrimary`) | نفس المنطق بالضبط |

### ب) كل الفورمات التي تستخدم `useFormDraft` (6 فورمات)

| الفورم | الملف:السطر | مفتاح المسودة | خطر إعادة كتابة المسودة |
|--------|------------|------------|----------------------|
| NewCaseModal | `NewCaseModal.tsx:75` | `'new-case'` | متوسط — يُغلق بعد الحفظ |
| EditCaseModal | `EditCaseModal.tsx:324` | `\`edit-case:\${caseData.id}\`` | متوسط — لا unmount حتى ينجح onEdit |
| NewClientModal | `NewClientModal.tsx:76` | `'new-client'` | متوسط — يُغلق لو onSave لا يُغلق |
| EditClientModal | `EditClientModal.tsx:85` | `\`edit-client:\${c.id}\`` | منخفض — فورم تعديل كلاسيكي |
| NewStandaloneSessionModal | `NewStandaloneSessionModal.tsx:174` | `'new-standalone-session'` | **الأشد** — postSaveModal يبقى في `:498-663` |
| StandaloneSessionDetailModal (Edit) | `StandaloneSessionDetailModal.tsx:288` | `\`edit-standalone-session:\${session.id}\`` | متوسط-مرتفع — open بعد رابط client منفصل |

### ج) فجوة الاختبار

- `caseSessionLinkingShared.test.ts` و `useSessionLinking.test.ts` بهما تغطية شاملة لـ`session_group_id` (الدوال: `:508, 523, 544, 557, 581, 603, 616, 747, 766, 780, 792, 828`).
- **لا توجد** اختبارات مطابقة لـ`useClientLinking.ts` — يتطابق مع الباگ الذي لم يُصلَح.

---

## الجذور المعمارية الثلاثة

1. **انتقال ناقص "جلسة مفردة" → "سلسلة":** `case_sessions.session_group_id` مضاف وبعض المسارات تستخدمه (SessionUpdate, useSessionLinking)، لكن `useClientLinking.ts:237-258` و`movePartiesFromSessionToCase` يعملان على صف واحد ثابت.
2. **انتقال ناقص "موكل واحد" → "أطراف متعددين":** `case_parties` مكتمل في InfoSection/EditCaseModal/data model، لكن الواتساب + كرت الموكل السريع في الهيدر ما زالوا يستهلكون `client` (مفرد) من prop الأب بدل `caseParties` المرتبط.
3. **autosave بدون "post-submit state":** `useFormDraft.clearDraft()` يحذف القراءة من localStorage بس. لا يمنع الجدولة التالية في التايمر، ولا يضع flag "submission completed" يُوقف الحفظ لـN ثانية.

---

## ترتيب إصلاح آمن مع مخاطر الرجعة (regression)

### الإصلاح 1 — `useClientLinking.ts` group-aware — ✅ تم تنفيذه (2026-08-05، يحتاج تحقق build/tests محلي)

- **التغيير الفعلي:** بدل ما اتعمل دالة جديدة منفصلة، استُخدمت `linkSessionGroupToCase` المُصدَّرة بالفعل من `caseSessionLinkingShared.ts` مباشرة — انظر تفاصيل كاملة داخل النقطة 2 فوق. صفر تعديل على `caseSessionLinkingShared.ts` نفسها.
- **مخاطر الرجعة المتبقية:** لسه **متوسطة** لحد ما يتم تشغيل `tsc`/الاختبارات محليًا (البيئة الحالية بدون `node_modules`/إنترنت). المسار لسه من غير `useClientLinking.test.ts` مخصص — التوصية بإضافته زي ما هي.

> **الخطة الأصلية (قبل التنفيذ)، للمرجعية:** كانت تقترح دالة جديدة منفصلة `linkSavedSessionGroupToCase` + `linkCasePartiesGroup`. التنفيذ الفعلي أبسط — استخدم `linkSessionGroupToCase` الموجودة مباشرة (بتعمل الاتنين معًا داخليًا)، فمفيش داعي لدالتين جديدتين.
- **لازم:** إضافة `useClientLinking.test.ts` بنفس نمط `useSessionLinking.test.ts:258-298` — **لسه لم يُنفَّذ**.

### الإصلاح 2 — توحيد مصدر الموكلين في الهيدر/الواتساب — ✅ تم تنفيذه (2026-08-05، يحتاج اختبار يدوي محلي)

> التنفيذ الفعلي اعتمد على `linkedClients` (useMemo) بدل تعديل كل سطر لوحده يدويًا — انظر تفاصيل كاملة داخل النقطة 4 فوق.

- **التغيير في `CaseDetailView.tsx`:**
  - `:246` `clientPhone = formatPhoneForWhatsApp(client?.phone)` → حلقة على كل الموكلين المرتبطين (caseParties.find(p => p.client_id)).id map) لاختيار الرئيسي.
  - `:251` `clientName = client?.full_name \|\| 'الموكل الكريم'` → نفس التحوّل.
  - `:316` عرض رقم كل الموكلين المرتبطين.
  - `:492-495` "الموكل" badge → "الموكلون (N)" + تكرار كل واحد.
- **مخاطر الرجعة:** **منخفضة**. الواجهة تتغيّر شكليًا فقط؛ لا منطق backend يُلمس.
- **احتياط:** إنزل `client` بـ`null` سيُظهر حالة فارغة محسّنة (بدل تكرار "الموكل الكريم" في كل الرسائل).

### الإصلاح 3 — قفل النجمة + إعادة حساب `linkedPartyId` — ✅ تم تنفيذه بالكامل (2026-08-05)

> النجمة اتصلحت في 2026-08-05 (المرحلة 2)، و`linkedPartyId` اتصلح في 2026-08-05 (المرحلة 3) — انظر تفاصيل كل جزء داخل النقطة 6 فوق.

- **التغيير في `PartyFields.tsx:75-81`:** إذا `party.client_id != null`، استبدل `onClick: onToggleIsClient` بـ `onClick: (() => toast('⚠️ فك الربط أولًا قبل تغيير "موكلنا"', true))` وتعطيل الزر.
- **التغيير في `EditCaseModal.tsx:299-303`:** استبدال `useState(() => {...})` بـ `useMemo(() => {...}, [initialParties, caseData.client_id])`.
- **مخاطر الرجعة:** **منخفضة**. لا تغيير للمنطق database.

### الإصلاح 4 — `clearDraft` يلغي الـtimer ويرفع flag — ✅ تم تنفيذه (2026-08-05)

- **التغيير في `useFormDraft.ts`:**
  - `:84` أضف `const suppressUntilRef = useRef(0)` (timestamp).
  - `:125-127` عيّن `suppressUntilRef.current = Date.now() + 3000` + `if (timerRef.current) clearTimeout(timerRef.current)`.
  - `:109-123` في بداية callback، إذا `Date.now() < suppressUntilRef.current && data هو آخر data قبل clearDraft`، return بدون جدولة.
- **مخاطر الرجعة:** **متوسطة**. يؤثر على 6 فورمات. كل wrapper يمرّ `data` مختلف؛ لازم اختبار جنب كل wrapper.
- **احتياط:** الـ"3 ثوان" قد تكون طويلة جدًا على شبكة بطيئة. يفضّل اختبار A/B لتحديد رقم يُلائم UX.

### الإصلاح 5 — `inline unlink` لكل طرف — ✅ تم تنفيذه (2026-08-05)

- **الدالة الجديدة:** `unlinkClientFromParty(partyId, isPrimaryParty, caseId)` أُضيفت لـ `caseSessionLinkingShared.ts` (عكس `linkClientToParty` الموجودة بالظبط — بتصفّر `case_parties.client_id` بس `UPDATE`، وكمان `cases.client_id` لو `isPrimaryParty`، من غير `clientOfflineInfo` لأنه فك ربط مش إنشاء رابط جديد).
- **`useCaseActions.ts`:** دالة جديدة `handleUnlinkClientForParty(caseId, partyId, isPrimaryParty, onAfterLink)` — بتنادي `unlinkClientFromParty`، تعرض toast/تسجّل activity، وتعمل `fetchCases` لو الطرف أساسي، بنفس نمط `handleLinkClientForParty` بالظبط. مُصدَّرة من الهوك ومُمرّرة عبر `App.tsx` → `AppModals.tsx` → `CaseDetailView.tsx` (كل واحدة بنفس التوقيع اللي `onLinkClientForParty` بيستخدمه، `onAfterLink` بينادي `fetchSessions()` عشان `caseParties` تتحدّث فورًا).
- **`InfoSection.tsx`:** زرار 🔓 صغير جنب اسم أي طرف عنده `client_id` (لو `onUnlinkClientForParty` متوفرة)، بيفتح تأكيد inline صغير جوه نفس صف الطرف (state جديد `unlinkPartyConfirmId: string | null` — بيخزّن id الطرف الحالي بس، يدعم أكتر من طرف في نفس القضية من غير تعارض). التأكيد بيستخدم `p.id === primaryPartyId` (نفس التعريف الموجود بالفعل فوق في الملف) كـ`isPrimaryParty`.
- **مخاطر الرجعة:** **منخفضة**. ميزة جديدة بالكامل — مفيش أي مسار قديم بيتلمس (`handleUnlinkClient` لمستوى القضية كلها فضل زي ما هو تمامًا).
- **⚠️ لم يُنفَّذ:** نفس ملاحظة كل مرحلة سابقة — لا `node_modules`/إنترنت في البيئة، فمقدرتش أشغّل build فعلي. اتحقق بمراجعة يدوية + `tsc --noEmit --ignoreConfig` على الملفات الستة المتأثرة (رجّع نفس أخطاء "cannot find module"/بيئة متوقعة زي كل مرة، بدون أي خطأ syntax أو نوع جديد ناتج عن التعديل ده تحديدًا). **لازم تشغيل `npm run build`/`tsc --noEmit` الحقيقي + اختبار يدوي لقضية فيها أكتر من طرف مربوط بموكل قبل الدمج.**

---

## جدول تنفيذي (مقترح)

| # | الإصلاح | الملف:السطر | Commit الذرّي | مخاطر | الحالة |
|---|---------|------------|--------------|-------|--------|
| 1 | `useFormDraft.ts:125-127` يلغي timer ويرفع flag 3s | useFormDraft.ts | "fix(draft): prevent re-save within 3s of submit" | متوسطة — اختبار 6 فورمات | ✅ **تم (2026-08-05)** |
| 2 | `useClientLinking.ts:237-258` يستخدم helper group-aware (يحتاج fn جديد في Shared) | useClientLinking.ts + caseSessionLinkingShared.ts | "fix(sessions): convert session group on creation" | متوسطة-عالية — اختبار كامل | ✅ **تم (2026-08-05)** — بلا build/test check محلي |
| 3 | `PartyFields.tsx:75-81` نجمة معطّلة لو `party.client_id` | PartyFields.tsx | "fix(party): lock star toggle for linked parties" | منخفضة | ✅ **تم (2026-08-05)** |
| 4 | `EditCaseModal.tsx:299` useMemo بدل useState | EditCaseModal.tsx | "fix(case): recompute linkedPartyId on parties change" | منخفضة | ✅ **تم (2026-08-05)** |
| 5 | `CaseDetailView.tsx:251,316,492-496` يعرض كل الموكلين المرتبطين | CaseDetailView.tsx | "feat(case): unified header from caseParties" | منخفضة | ✅ **تم (2026-08-05)** — بلا اختبار يدوي محلي بعد |
| 6 | `InfoSection.tsx:235-265` زر فك ربط لكل طرف | InfoSection.tsx + useCaseActions.ts + caseSessionLinkingShared.ts + App.tsx + AppModals.tsx + CaseDetailView.tsx | "feat(party): inline unlink for party rows" | منخفضة | ✅ **تم (2026-08-05)** — بلا build check محلي |

**الترتيب الآمن:** 1 → 3 → 4 → 2 → 5 → 6. (إصلاح الـautosave أوّلًا لأنه العامل الأكثر شيوعًا؛ إصلاح group-aware بعد تغطية اختبار كافية.) — **كل الإصلاحات الستة منفّذة الآن.**

---

## 🔍 فحص إضافي (5 أغسطس 2026) — ملفات تيست وفجوات متبقية

**تيستات أُضيفت في نفس المراجعة:**
- `caseSessionLinkingShared.test.ts` — 4 تيستات جديدة لـ `unlinkClientFromParty` (نفس نمط `linkClientToParty` بالظبط: طرف أساسي/غير أساسي، فشل `case_parties`، فشل `cases`).
- `useCaseActions.test.ts` — describe جديد `handleUnlinkClientForParty` (3 تيستات: طرف أساسي، طرف غير أساسي، فشل التحديث) بنفس نمط `describe('handleLinkClientForParty')` الموجود جنبه بالظبط.

**فجوات اختبار موجودة من قبل (لم تُنشأ في هذه الجلسة، ولا في نطاق فك الربط تحديدًا — موروثة من إصلاح رقم 2):**
- **لسه مفيش `useClientLinking.test.ts`** — مذكورة صراحةً كنقطة مفتوحة في التقرير الأصلي (قسم "الإصلاح 1") من قبل ما أبدأ، ولسه محتاجة إضافة بنفس نمط `useSessionLinking.test.ts:258-298`.
- **مفيش أي تغطية E2E خالص لتاب "البيانات" (`InfoSection.tsx`)** — بحثت في كل ملفات `e2e/*.spec.ts` (بما فيها `cases.spec.ts` و`case-parties-and-sessions.spec.ts`) ومفيش أي إشارة لـ `case-tab-info` ولا لأي زرار ربط/فك ربط جوه الشاشة دي. يعني زرار فك الربط الجديد لكل طرف (وكل زراير الربط/الإنشاء القديمة المجاورة له) من غير أي اختبار E2E خالص، مش بس الإضافة الجديدة.
- **مفيش unit test مباشر لـ `PartyFields.tsx`، `EditCaseModal.tsx`، `CaseDetailView.tsx`، `InfoSection.tsx`، أو `useFormDraft.ts`** — الأربعة الأول components بلا تيست وحدة خالص (بس تغطية جزئية غير مباشرة عن طريق E2E لفورمات الإنشاء)، و`useFormDraft.ts` نفسها بلا ملف تيست مخصص رغم إنها الجذر الأكثر حرجًا في التقرير الأصلي.

**⚠️ لم يُنفَّذ (نفس القيد المتكرر):** التيستات الجديدة دي اتكتبت بمراجعة يدوية للنمط الموجود، مقدرتش أشغّلها فعليًا (`vitest run`) لعدم توفر `node_modules`/إنترنت في البيئة الحالية.

---


## 📌 هذا تقرير حيّ

هذا الملف بيتحدّث بعد كل مرحلة تنفيذ (قسم "حالة التنفيذ" فوق + ملاحظة ✅ داخل كل نقطة اتصلحت + جدول التنفيذي في الآخر). آخر تحديث: **2026-08-05 — المرحلة 6 (`InfoSection.tsx` — فك ربط لكل طرف) تمّت. الخطة كاملة (6/6) — باقي بس build/test حقيقي محلي + اختبار يدوي شامل قبل الدمج.**
