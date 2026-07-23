import { useEffect, useState } from 'react';
import { toast } from '../../../shared/lib/notifications';
import { db } from '../../../supabaseClient';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { recalcNextHearing } from '../../../shared/lib/dataAccess';
import type { Form } from '../NewStandaloneSessionModal';
import {
  makeOfflineTempId, isOfflineTempId, withFkOfflineSentinel, withCaseSelfOfflineSentinel, findMatchingClientByName, buildCaseInsertData,
  movePartiesFromSessionToCase, fetchSessionClientParties, matchClientsForParties, linkClientToParty,
} from './caseSessionLinkingShared';
import type { SessionClientParty, PartyClientMatch } from './caseSessionLinkingShared';

// 🆕 (خطة "المسمى القانوني" — بند مؤجل من التقرير): plaintiffLegalTitle/
// defendantLegalTitle اتضافوا هنا في SavedFormData تحديدًا (مش في تعريف
// Form نفسه) عشان منلمسش الأماكن التانية الكتير اللي بتستخدم Form —
// قيمتهم جايين من partyFields.legalTitles وقت setSavedFormData في
// NewStandaloneSessionModal.tsx.
export type SavedFormData = {
  form: Form;
  finalCaseType: string;
  finalCourtLevel: string;
  fullCaseNumber: string;
  sessionId: string | null;
  plaintiffLegalTitle?: string | null;
  defendantLegalTitle?: string | null;
};

/**
 * منطق إنشاء قضية من بيانات جلسة مستقلة + ربط/إضافة الموكل — منقول حرفيًا
 * من NewStandaloneSessionModal.tsx (نفس المنطق تمامًا، صفر تغيير سلوك):
 * handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient,
 * handleAddClientOnly.
 */
// ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 3): كول-باك بيفتح NewClientModal
// الموحّد بدل ما handleAddClientOnly يعمل INSERT مباشر — شوف
// handleOpenCreateClientForSession في App.tsx.
export type OpenCreateClientForSession = (
  sessionId: string | null,
  plaintiffName: string,
  plaintiffNationalId?: string | null,
  plaintiffPoa?: string | null,
) => void;

// ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 2): كول-باك بيفتح NewClientModal
// الموحّد لمسار "إنشاء موكل جديد وربطه" بقضية (زي handleOpenCreateClientForCase
// المستخدم في Phase 1 — نفس التوقيع بالظبط + باراميتر سادس اختياري لمعلومة
// التمبيد الأوفلاين لو القضية نفسها لسه معرّف مؤقت).
export type OpenCreateClientForCase = (
  caseId: string,
  plaintiffName: string,
  plaintiffNationalId?: string | null,
  plaintiffPoa?: string | null,
  plaintiffAddress?: string | null,
  caseOfflineInfo?: { isOfflineTemp: boolean; fallbackTitle?: string },
) => void;

// ⚡ NEW (خطة تعدد الأطراف، 7.2 جزء 2 — 23 يوليو 2026): كول-باك بيفتح
// NewClientModal الموحّد لطرف بعينه (وسط wizard "طرف واحد في المرة")،
// بدل onOpenCreateClientForCase العام اللي بيتعامل مع "الموكل الأساسي"
// بس. الفرق عن onOpenCreateClientForCase: (1) partyId + isPrimaryParty —
// عشان useClientActions.ts يعرف يربط case_parties.client_id (+
// cases.client_id لو أساسي بس) بدل cases.client_id مباشرة، (2) باراميتر
// أخير onAfterLink — الموديل بيفتح ويقفل بشكل مستقل (async عبر
// App.tsx/openNewClientModal)، فمفيش طريقة لهوك useClientLinking يعرف
// امتى الربط خلص عشان ينتقل للطرف الجاي في partyList — onAfterLink هي
// نفس goToNextPartyOrDone بتاعة الطرف الحالي، بتتنادى من onLinked
// الموجودة في App.tsx (handleOpenCreateClientForParty) بعد نجاح الربط.
export type OpenCreateClientForParty = (
  partyId: string,
  caseId: string,
  isPrimaryParty: boolean,
  partyName: string,
  partyNationalId: string | null | undefined,
  partyPoa: string | null | undefined,
  partyAddress: string | null | undefined,
  caseOfflineInfo: { isOfflineTemp: boolean; fallbackTitle?: string } | undefined,
  onAfterLink: () => void,
) => void;

// ⚡ NEW (خطة تعدد الأطراف، مرحلة 13 جزء 2 — 23 يوليو 2026): مرآة لـ
// OpenCreateClientForParty فوق، بس لطرف تابع لجلسة مستقلة *لسه ما
// اتحوّلتش لقضية* (خطوة "idle" — قبل حتى ما المستخدم يقرر يعمل إيه).
// مفيش caseOfflineInfo هنا (sessionId دايمًا id حقيقي وقت ظهور الزرار —
// راجع تعليق linkClientToSessionParty)، ومفيش onAfterLink بمعنى wizard
// انتقال لطرف تاني تلقائي (الأزرار هنا مستقلة زي InfoSection.tsx في
// مرحلة 13 جزء 1، مش wizard) — onAfterLink هنا بس بتعلّم useClientLinking.ts
// إن الطرف ده اتربط عشان زراره يختفي من قايمة "idle".
export type OpenCreateClientForSessionParty = (
  partyId: string,
  sessionId: string,
  isPrimaryParty: boolean,
  partyName: string,
  partyNationalId: string | null | undefined,
  partyPoa: string | null | undefined,
  partyAddress: string | null | undefined,
  onAfterLink: () => void,
) => void;

export function useClientLinking(
  savedFormData: SavedFormData | null,
  onSaved: () => void,
  onClientAdded?: () => void,
  onOpenCreateClient?: OpenCreateClientForSession,
  onOpenCreateClientForCase?: OpenCreateClientForCase,
  onOpenCreateClientForParty?: OpenCreateClientForParty,
  onOpenCreateClientForSessionParty?: OpenCreateClientForSessionParty,
) {
  const [linkingCase, setLinkingCase] = useState(false);
  const [linkingClient, setLinkingClient] = useState(false);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const [clientStep, setClientStep] = useState<'idle' | 'found' | 'notfound' | 'done'>('idle');
  const [foundClient, setFoundClient] = useState<{ id: string; full_name: string | null } | null>(null);
  // ⚡ FIX: خطوة 'found' بتتفعّل من مصدرين مختلفين تمامًا — تخمين بالاسم
  // (ilike تقريبي، handleLinkCase) وتطابق مؤكد (اسم/رقم قومي/توكيل بالظبط،
  // checkClientDuplicate في handleAddAndLinkClient). زرار "إضافة موكل جديد
  // وربطه" كان بيوصل لطريق مسدود مع التطابق المؤكد (checkClientDuplicate
  // هيرفضه تاني بنفس الرسالة). الفلاج ده بيسمح للواجهة تميّز الحالتين.
  const [foundClientMatchType, setFoundClientMatchType] = useState<'exact' | 'fuzzy' | null>(null);
  const [linkingToCase, setLinkingToCase] = useState(false);

  // ⚡ NEW (خطة تعدد الأطراف، 7.2 جزء 2 — 23 يوليو 2026): نفس wizard
  // useSessionLinking.ts بالحرف (راجع التعليق المطوّل هناك) — partyList
  // فاضية = جلسة قديمة قبل مرحلة 6 (أو الجلسة لسه ما اتحفظتش أونلاين
  // خالص، sessionId فاضي) → fallback تلقائي لمسار الاسم الواحد القديم.
  const [partyList, setPartyList] = useState<SessionClientParty[]>([]);
  const [partyMatches, setPartyMatches] = useState<PartyClientMatch[]>([]);
  const [partyIndex, setPartyIndex] = useState(0);

  // ⚡ NEW (خطة تعدد الأطراف، مرحلة 13 جزء 2 — 23 يوليو 2026): أطراف
  // الجلسة (is_client=true) لعرض زرار مستقل لكل واحد فيهم في خطوة
  // "idle" (قبل ما المستخدم يختار "إنشاء قضية" أو "إضافة موكل فقط") —
  // مختلفة عن partyList فوق (اللي بتتملى بس جوه handleLinkCase، بعد
  // ما القضية اتعملت فعلًا). بتتملى بمجرد ما savedFormData.sessionId
  // يبقى متاح (فور نجاح حفظ الجلسة أونلاين) — كل الأطراف الراجعة هنا
  // مضمون إنها مش مربوطة (client_id) لسه، لأن الجلسة لسه جديدة تمامًا
  // (usePartyFields مبيدّيش قيمة client_id للأطراف الجديدة أصلًا).
  const [idlePartyList, setIdlePartyList] = useState<SessionClientParty[]>([]);
  const [linkedIdlePartyIds, setLinkedIdlePartyIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setIdlePartyList([]);
    setLinkedIdlePartyIds(new Set());
    if (savedFormData?.sessionId) {
      fetchSessionClientParties(db, savedFormData.sessionId).then((parties) => {
        if (!cancelled) setIdlePartyList(parties);
      });
    }
    return () => { cancelled = true; };
  }, [savedFormData?.sessionId]);

  const goToNextPartyOrDone = (currentIndex: number, parties: SessionClientParty[], matches: PartyClientMatch[]) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= parties.length) { setClientStep('done'); return; }
    setPartyIndex(nextIndex);
    const nextParty = parties[nextIndex];
    const match = matches.find((m) => m.party.id === nextParty.id);
    if (match) {
      setFoundClient(match.client);
      setFoundClientMatchType(match.matchType);
      setClientStep('found');
    } else {
      setFoundClient(null);
      setFoundClientMatchType(null);
      setClientStep('notfound');
    }
  };

  const handleLinkCase = async () => {
    if (!savedFormData) return;
    setLinkingCase(true);
    try {
      const { form: f, finalCaseType: ct, finalCourtLevel: cl, fullCaseNumber: cn } = savedFormData;
      const caseTitle = f.title || cn || 'قضية من جلسة مستقلة';
      // 🆕 المرحلة 2 (خطة توسيع الأوفلاين): معرّف مؤقت client-side، بنفس
      // نمط offlineTempId الموجود فعلاً في useCaseActions.ts (handleSaveCase)
      // — بيتبعت مع القضية بغض النظر عن حالة الاتصال، وبيتشال قبل أي INSERT
      // حقيقي (stripOfflineSentinels في offlineQueue.ts).
      const offlineTempId = makeOfflineTempId();
      const { error, offline, queued, data: insertedCase } = await window.__dbWrite({
        type: 'INSERT',
        table: 'cases',
        // ⚡ FIX (توحيد): بناء بيانات القضية دلوقتي في buildCaseInsertData
        // (caseSessionLinkingShared.ts) بدل نسخة يدوية هنا — نفس المنطق
        // بالظبط المستخدم في useSessionLinking.ts، مكان واحد بس للفيكسات
        // المستقبلية (session_hall/session_time اللي كانوا بيضيعوا، إلخ).
        data: buildCaseInsertData({
          court: f.court,
          caseNumber: cn,
          caseType: ct,
          plaintiff: f.plaintiff,
          plaintiffRole: f.plaintiff_role,
          plaintiffNationalId: f.plaintiff_national_id,
          plaintiffPoa: f.plaintiff_power_of_attorney,
          defendant: f.defendant,
          defendantRole: f.defendant_role,
          defendantNationalId: f.defendant_national_id,
          // 🆕 (خطة "المسمى القانوني" — بند مؤجل من التقرير)
          plaintiffLegalTitle: savedFormData.plaintiffLegalTitle,
          defendantLegalTitle: savedFormData.defendantLegalTitle,
          circuitNumber: f.circuit_number,
          sessionHall: f.session_hall,
          sessionTime: f.session_time,
          courtLevel: cl,
          secretaryHall: f.secretary_hall,
          secretaryName: f.secretary_name,
          secretaryMobile: f.secretary_mobile,
        }, caseTitle, offlineTempId),
        returning: true,
      });
      if (error) {
        showErrorToast('case_create', error, 'تعذّر إنشاء القضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'إنشاء قضية');
        return;
      }
      // 🆕 المرحلة 2: لو أوفلاين، مفيش id حقيقي راجع من __dbWrite (العملية
      // في الطابور بس) — بنستخدم التمبيد نفسه كمرجع مؤقت بدل null، عشان
      // خطوة ربط الجلسة تحت تقدر "تشاور" عليه لحد ما يتزامن.
      const realOrTempCaseId = (offline && queued) ? offlineTempId : (insertedCase as { id: string } | null)?.id;
      if (!realOrTempCaseId) { showErrorToast('case_create', new Error('no id returned'), 'تعذّر إنشاء القضية. حاول مرة أخرى.', 'إنشاء قضية'); return; }
      if (offline && queued) {
        toast('📥 القضية محفوظة محلياً — ستُضاف فور عودة الإنترنت');
      } else {
        toast('✅ تم إنشاء ملف القضية');
      }
      setCreatedCaseId(realOrTempCaseId);
      // ⚡ ربط الجلسة المستقلة الأصلية بالقضية الجديدة — من غير الخطوة دي
      // الجلسة كانت هتفضل "مستقلة" (case_id = null) حتى بعد إنشاء ملف
      // القضية، وده كان بيمنع فتح صفحة جلسات القضية عند الضغط عليها تاني.
      // ⚡ NEW (7.2 جزء 2): لازم تتقرا هنا *قبل* movePartiesFromSessionToCase
      // تحت — الدالة دي بتحدّث الصفوف نفسها (session_id → null، case_id →
      // القضية الجديدة)، فلو استنينا وقريناها بعدين بـ session_id مش هنلاقي
      // حاجة. فاضية دايمًا لو savedFormData.sessionId فاضي (الجلسة اتقيدت
      // أوفلاين ولسه معندهاش id حقيقي) — مفيش استعلام غير آمن هنا.
      const clientPartiesBeforeMove = savedFormData.sessionId
        ? await fetchSessionClientParties(db, savedFormData.sessionId)
        : [];
      if (savedFormData.sessionId) {
        const { error: sessionLinkErr } = await window.__dbWrite({
          type: 'UPDATE',
          table: 'case_sessions',
          id: savedFormData.sessionId,
          // 🆕 المرحلة 2: sentinel التمبيد العام بيتبعت بس لما القضية نفسها
          // لسه تمبيد (أوفلاين) — لو نجحت أونلاين، case_id بالفعل id حقيقي
          // ومحتاجش أي حل وقت المزامنة.
          data: withFkOfflineSentinel(offline, queued, 'case_id', offlineTempId, 'cases', caseTitle, { case_id: realOrTempCaseId }),
        });
        if (sessionLinkErr) {
          showErrorToast('session_case_link', sessionLinkErr, 'تم إنشاء القضية لكن تعذّر ربط الجلسة بها. حاول تحديث الصفحة.', 'ربط الجلسة بالقضية');
        } else {
          // ⚡ NEW (مرحلة 7.1 — خطة تعدد الأطراف، 23 يوليو 2026): نقل كل
          // صفوف case_parties بتاعة الجلسة (مش بس الطرف الأساسي اللي
          // buildCaseInsertData كتبه فوق للأعمدة القديمة) للقضية الجديدة.
          // savedFormData.sessionId هنا حقيقي دايمًا جوه الشرط ده (الفرع ده
          // بيتنفذ بس لو الجلسة اتحفظت أونلاين بنجاح — راجع تعليق الشرط
          // فوق)، فمفيش داعي لأي تمبيد على جنب المصدر.
          const moveResult = await movePartiesFromSessionToCase(
            db, savedFormData.sessionId, realOrTempCaseId, offline, queued, offlineTempId, caseTitle,
          );
          if (!moveResult.ok) {
            toast('⚠️ تم إنشاء القضية وربط الجلسة، لكن حصل خطأ في نقل بعض أطراف الدعوى الإضافية — راجعها يدويًا', true);
          }
          if (!(offline && queued)) {
            // ⚡ FIX: next_hearing كان بيفضل فاضي في القضية الجديدة رغم إن
            // فيها جلسة مربوطة فعليًا — نفس منطق recalcNextHearing الموحّد
            // المستخدم في كل مكان تاني بيضيف/يربط جلسة بقضية.
            // 🆕 المرحلة 2: أونلاين بس هنا — أوفلاين، next_hearing هتتحسب
            // تلقائيًا بعد المزامنة (المرحلة 4 القادمة في الخطة، لسه ما
            // اتنفذتش)، مفيش معنى نناديها دلوقتي على تمبيد مش موجود فعليًا
            // في القاعدة.
            await recalcNextHearing(db, realOrTempCaseId);
          }
        }
      }
      onSaved(); // تحديث قائمة القضايا والجلسات فوراً (بعد اكتمال الربط)
      // ⚡ NEW (7.2 جزء 2): لو الجلسة فيها أطراف is_client=true فعلية
      // (clientPartiesBeforeMove اللي اتقرت فوق قبل النقل)، بندخل wizard
      // "طرف واحد في المرة" بدل مسار الاسم الواحد القديم — نفس فرع
      // useSessionLinking.ts بالحرف.
      if (clientPartiesBeforeMove.length > 0) {
        const matches = await matchClientsForParties(db, clientPartiesBeforeMove);
        setPartyList(clientPartiesBeforeMove);
        setPartyMatches(matches);
        setPartyIndex(0);
        const firstParty = clientPartiesBeforeMove[0];
        const firstMatch = matches.find((m) => m.party.id === firstParty.id);
        if (firstMatch) {
          setFoundClient(firstMatch.client);
          setFoundClientMatchType(firstMatch.matchType);
          setClientStep('found');
        } else {
          setClientStep('notfound');
        }
        return;
      }
      // ── fallback: جلسة قديمة/لسه ما اتحفظتش أونلاين (مسار الاسم الواحد
      // القديم، صفر تغيير سلوك) — ابحث عن الموكل، read-only، مفيش له معنى
      // أوفلاين (نتيجته هتبقى فاضية طبيعي لو مفيش نت، وده مقبول). ──
      const plaintiffName = f.plaintiff?.trim();
      if (!plaintiffName) { setClientStep('notfound'); return; }
      // ⚡ FIX (توحيد): findMatchingClientByName (caseSessionLinkingShared.ts)
      // بدل استعلام يدوي هنا — نفس المنطق بالظبط اللي في useSessionLinking.ts
      // (فلتر deleted_at + بحث على client_name + تحديد matchType)، مكان
      // واحد بس للفيكسات المستقبلية.
      const match = await findMatchingClientByName(db, plaintiffName);
      if (match) {
        setFoundClient(match.client);
        setFoundClientMatchType(match.matchType);
        setClientStep('found');
      } else {
        setClientStep('notfound');
      }
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingCase(false); }
  };

  const handleLinkExistingClient = async () => {
    if (!createdCaseId || !foundClient) return;
    // ⚡ NEW (7.2 جزء 2): wizard الأطراف المتعددة — الطرف الحالي (partyIndex)
    // بس بياخد الربط عبر linkClientToParty (case_parties.client_id + طرف
    // أساسي بس بيحدّث cases.client_id القديم كمان)، وبعدين بننتقل للطرف
    // الجاي أو 'done'. مفيش لمسة لمسار الاسم الواحد القديم تحت.
    if (partyList.length > 0) {
      const currentParty = partyList[partyIndex];
      if (!currentParty) return;
      setLinkingToCase(true);
      try {
        const isTempCaseId = isOfflineTempId(createdCaseId);
        const caseTitle = isTempCaseId && savedFormData
          ? (savedFormData.form.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة')
          : undefined;
        const isPrimary = partyIndex === 0;
        const result = await linkClientToParty(currentParty.id, foundClient.id, isPrimary, createdCaseId, caseTitle);
        if (!result.ok) {
          showErrorToast('party_client_link', new Error('link failed'), `تعذّر ربط "${currentParty.name}" بالموكل. حاول مرة أخرى.`, 'ربط طرف بموكل');
        } else {
          toast(`✅ تم ربط "${currentParty.name}" بـ"${foundClient.full_name}"`);
        }
        goToNextPartyOrDone(partyIndex, partyList, partyMatches);
      } catch { toast('❌ خطأ غير متوقع', true); }
      finally { setLinkingToCase(false); }
      return;
    }
    // ── fallback: جلسة قديمة (مسار الاسم الواحد القديم، صفر تغيير سلوك) ──
    setLinkingToCase(true);
    try {
      // 🆕 المرحلة 3-1 (خطة توسيع الأوفلاين): تحويل من db.from() المباشر لـ
      // __dbWrite. createdCaseId ممكن يكون لسه تمبيد (لو القضية اتقيدت
      // أوفلاين في handleLinkCase فوق ولسه ما اتزامنتش) — بنميزه بنفس
      // بادئة offlineTempId ('tmp-') المستخدمة هناك. لو تمبيد فعلاً، بنبعت
      // _offlineSelfTempId (+ عنوان القضية كـ fallback بالاسم) عشان دورة
      // المزامنة تقدر تحل الـ id الحقيقي قبل تنفيذ الـ UPDATE (شوف
      // resolveOfflineSelfId في offlineQueue.ts — اكتشاف معماري جديد: هنا
      // الـ id بتاع السطر المستهدف نفسه هو التمبيد، مش حقل FK جوه data
      // زي _offlineFkTempId العادية).
      const isTempCaseId = isOfflineTempId(createdCaseId);
      const caseTitle = isTempCaseId && savedFormData
        ? (savedFormData.form.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة')
        : undefined;
      const { error, offline, queued } = await window.__dbWrite({
        type: 'UPDATE',
        table: 'cases',
        id: createdCaseId,
        data: withCaseSelfOfflineSentinel(createdCaseId, { client_id: foundClient.id }, caseTitle),
      });
      if (error) {
        showErrorToast('session_client_link', error, 'تعذّر ربط الموكل بالجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'ربط الموكل بالجلسة');
      }
      else if (offline && queued) {
        // ⚠️ ممكن نوصل هنا حتى لو أونلاين فعليًا (لو createdCaseId تمبيد —
        // شوف forceQueueForSelfTempId في __dbWrite): الرسالة لسه صحيحة
        // لأن الربط فعليًا هيتم بعد اكتمال مزامنة القضية، مش دلوقتي.
        toast('📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
        setClientStep('done');
      }
      else { toast('✅ تم ربط الموكل بالقضية'); setClientStep('done'); }
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingToCase(false); }
  };

  // ⚡ CHANGED (خطة توحيد إنشاء الموكل، Phase 2): بقى بيفتح NewClientModal
  // الموحّد بدل INSERT مباشر بحقلين بس — شوف handleOpenCreateClientForCase
  // في App.tsx. فحص التكرار والربط بـ cases.client_id (+ logActivity + دعم
  // التمبيد الأوفلاين لو createdCaseId نفسه لسه tmp-) بقوا بيحصلوا جوه
  // handleSaveClient الموحّد (useClientActions.ts) بعد الحفظ.
  const handleAddAndLinkClient = () => {
    if (!createdCaseId) return;
    const isTempCaseId = isOfflineTempId(createdCaseId);
    // ⚡ NEW (7.2 جزء 2): wizard الأطراف المتعددة — بيفتح NewClientModal
    // الموحّد ببيانات الطرف الحالي (اسمه/رقمه القومي/توكيله/عنوانه هو، مش
    // savedFormData.form.plaintiff) عبر onOpenCreateClientForParty الجديدة
    // (target نوعه 'party' في useClientActions.ts — case_parties.client_id
    // بتاع الطرف ده بس + cases.client_id لو ده الطرف الأساسي). onAfterLink
    // = goToNextPartyOrDone للطرف الحالي، بتتنادى من onLinked في App.tsx
    // بعد نجاح الربط الفعلي (الموديل بيفتح/يقفل مستقل عن الهوك ده).
    if (partyList.length > 0) {
      const currentParty = partyList[partyIndex];
      if (!currentParty) return;
      const caseTitle = isTempCaseId && savedFormData
        ? (savedFormData.form.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة')
        : undefined;
      const isPrimary = partyIndex === 0;
      onOpenCreateClientForParty?.(
        currentParty.id, createdCaseId, isPrimary,
        currentParty.name, currentParty.national_id, currentParty.power_of_attorney, currentParty.address,
        { isOfflineTemp: isTempCaseId, fallbackTitle: caseTitle },
        () => goToNextPartyOrDone(partyIndex, partyList, partyMatches),
      );
      return;
    }
    // ── fallback: جلسة قديمة (مسار الاسم الواحد القديم، صفر تغيير سلوك) ──
    if (!savedFormData) return;
    const { form: f } = savedFormData;
    if (!f.plaintiff?.trim()) return;
    const caseTitle = isTempCaseId ? (f.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة') : undefined;
    onOpenCreateClientForCase?.(
      // ⚠️ NewStandaloneSessionModal.Form مفيهاش حقل عنوان (undefined هنا) —
      // الحقل ده خاص بفورم القضية العادية (NewCaseModal/EditCaseModal) بس.
      createdCaseId, f.plaintiff, f.plaintiff_national_id, f.plaintiff_power_of_attorney, undefined,
      { isOfflineTemp: isTempCaseId, fallbackTitle: caseTitle },
    );
  };

  // ⚡ NEW (7.2 جزء 2): تخطي الطرف الحالي بس (مش إغلاق الموديل كله) —
  // بينتقل للطرف الجاي في partyList أو 'done'. بيتفعّل بس لما partyList
  // فيها أطراف؛ الواجهة (زرار "تخطي" الحالي) لازم تفرّق بين الحالتين:
  // partyList.length > 0 → نده الدالة دي، غير كده (مسار قديم) → فضل نفس
  // السلوك القديم (onFullClose من الأب مباشرة، بدون تغيير).
  const handleSkipParty = () => {
    if (partyList.length === 0) return;
    goToNextPartyOrDone(partyIndex, partyList, partyMatches);
  };

  // ⚡ CHANGED (خطة توحيد إنشاء الموكل، Phase 3): بقى بيفتح NewClientModal
  // الموحّد (نفس موديل قسم الموكلين، بكل حقوله الإلزامية اسم/نوع/هاتف/رقم
  // قومي، وفحص التكرار) بدل INSERT مباشر بحقلين بس (اسم + رقم قومي) —
  // شوف handleOpenCreateClientForSession في App.tsx. فحص التكرار والربط
  // بـ case_sessions.client_id (+ logActivity) بقوا بيحصلوا جوه
  // handleSaveClient الموحّد (useClientActions.ts) بعد الحفظ.
  // ⚠️ ملحوظة سلوك: لو الجلسة لسه ما اتحفظتش أونلاين (savedFormData.sessionId
  // فاضي)، بنفتح الموديل من غير target ربط (زي السلوك القديم بالظبط —
  // الموكل بيتحفظ من غير ربط تلقائي)، بس من غير استدعاء fetchTodaySessions/
  // fetchUpcomingSessions بعد كده في الحالة دي تحديدًا (مفيش ربط حصل
  // أصلاً يستأهل تحديث شاشة الجلسات) — فرق طفيف عن السلوك القديم اللي كان
  // بينادي عليهم دايمًا بغض النظر، هيتأكد وقت الاختبار اليدوي الأوفلاين
  // في Phase 4.
  const handleAddClientOnly = () => {
    if (!savedFormData) return;
    const { form: f } = savedFormData;
    if (!f.plaintiff?.trim()) return;
    onOpenCreateClient?.(savedFormData.sessionId, f.plaintiff, f.plaintiff_national_id, f.plaintiff_power_of_attorney);
  };

  // ⚡ NEW (خطة تعدد الأطراف، مرحلة 13 جزء 2 — 23 يوليو 2026): نفس فكرة
  // handleAddClientOnly فوق، بس لطرف بعينه من idlePartyList — بتتنادى
  // لكل زرار مستقل على حدة (مش wizard)، فبتحدد "الطرف الأساسي" بمقارنة
  // id الطرف بأول عنصر في idlePartyList (نفس تعريف "الأساسي" المستخدم
  // في كل مكان تاني — أول is_client=true بترتيب sort_order). onAfterLink
  // بتضيف الطرف لـ linkedIdlePartyIds عشان زراره يختفي فورًا من غير ما
  // نستنى إعادة فتح الموديل.
  const handleAddClientOnlyForParty = (party: SessionClientParty) => {
    if (!savedFormData?.sessionId) return;
    const isPrimary = idlePartyList[0]?.id === party.id;
    onOpenCreateClientForSessionParty?.(
      party.id, savedFormData.sessionId, isPrimary,
      party.name, party.national_id, party.power_of_attorney, party.address,
      () => setLinkedIdlePartyIds((prev) => new Set(prev).add(party.id)),
    );
  };

  return {

    linkingCase, linkingClient, linkingToCase,
    createdCaseId, setCreatedCaseId,
    clientStep, setClientStep,
    foundClient, setFoundClient, foundClientMatchType,
    // ⚡ NEW (7.2 جزء 2): partyList/partyIndex لعرض "طرف X من Y" وتحديد
    // الطرف الحالي في الواجهة، وhandleSkipParty لتخطي الطرف ده بس.
    partyList, partyIndex, handleSkipParty,
    // ⚡ NEW (مرحلة 13 جزء 2): idlePartyList/linkedIdlePartyIds لعرض زرار
    // مستقل لكل طرف في خطوة "idle"، وhandleAddClientOnlyForParty لفتح
    // NewClientModal لطرف بعينه.
    idlePartyList, linkedIdlePartyIds, handleAddClientOnlyForParty,
    handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
  };
}
