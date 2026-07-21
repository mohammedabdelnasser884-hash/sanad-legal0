import { useState } from 'react';
import { toast } from '../../../shared/lib/notifications';
import { db } from '../../../supabaseClient';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { recalcNextHearing } from '../../../shared/lib/dataAccess';
import type { Form } from '../NewStandaloneSessionModal';
import {
  makeOfflineTempId, isOfflineTempId, withFkOfflineSentinel, withCaseSelfOfflineSentinel, findMatchingClientByName, buildCaseInsertData,
} from './caseSessionLinkingShared';

export type SavedFormData = { form: Form; finalCaseType: string; finalCourtLevel: string; fullCaseNumber: string; sessionId: string | null };

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
  caseOfflineInfo?: { isOfflineTemp: boolean; fallbackTitle?: string },
) => void;

export function useClientLinking(
  savedFormData: SavedFormData | null,
  onSaved: () => void,
  onClientAdded?: () => void,
  onOpenCreateClient?: OpenCreateClientForSession,
  onOpenCreateClientForCase?: OpenCreateClientForCase,
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
        } else if (!(offline && queued)) {
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
      onSaved(); // تحديث قائمة القضايا والجلسات فوراً (بعد اكتمال الربط)
      // ابحث عن الموكل — read-only، مفيش له معنى أوفلاين (نتيجته هتبقى
      // فاضية طبيعي لو مفيش نت، وده مقبول ومش تغيير سلوك — نفس قرار الخطة).
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
    if (!savedFormData || !createdCaseId) return;
    const { form: f } = savedFormData;
    if (!f.plaintiff?.trim()) return;
    const isTempCaseId = isOfflineTempId(createdCaseId);
    const caseTitle = isTempCaseId ? (f.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة') : undefined;
    onOpenCreateClientForCase?.(
      createdCaseId, f.plaintiff, f.plaintiff_national_id, f.plaintiff_power_of_attorney,
      { isOfflineTemp: isTempCaseId, fallbackTitle: caseTitle },
    );
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

  return {

    linkingCase, linkingClient, linkingToCase,
    createdCaseId, setCreatedCaseId,
    clientStep, setClientStep,
    foundClient, setFoundClient, foundClientMatchType,
    handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
  };
}
