import { useState } from 'react';
import { toast } from '../../../shared/lib/notifications';
import { validateFullNameParts, checkClientDuplicate } from '../../../shared/lib/clientValidation';
import { db } from '../../../supabaseClient';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { getCurrentTenantId } from '../../../constants';
import { recalcNextHearing } from '../../../shared/lib/dataAccess';
import type { Form } from '../NewStandaloneSessionModal';

export type SavedFormData = { form: Form; finalCaseType: string; finalCourtLevel: string; fullCaseNumber: string; sessionId: string | null };

/**
 * منطق إنشاء قضية من بيانات جلسة مستقلة + ربط/إضافة الموكل — منقول حرفيًا
 * من NewStandaloneSessionModal.tsx (نفس المنطق تمامًا، صفر تغيير سلوك):
 * handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient,
 * handleAddClientOnly.
 */
export function useClientLinking(savedFormData: SavedFormData | null, onSaved: () => void, onClientAdded?: () => void) {
  const [linkingCase, setLinkingCase] = useState(false);
  const [linkingClient, setLinkingClient] = useState(false);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  // ⚡ NEW (19 يوليو 2026): 'duplicateSession' — لما "إضافة الموكل لقائمة
  // الموكلين فقط" (بدون إنشاء قضية) تكتشف تكرار، بنعرض زرار ربط مباشر
  // بالجلسة (case_sessions.client_id) بدل توست بس — شوف handleLinkFoundClientToSession تحت.
  const [clientStep, setClientStep] = useState<'idle' | 'found' | 'notfound' | 'duplicateSession' | 'done'>('idle');
  const [foundClient, setFoundClient] = useState<{ id: string; full_name: string | null } | null>(null);
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
      const offlineTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { error, offline, queued, data: insertedCase } = await window.__dbWrite({
        type: 'INSERT',
        table: 'cases',
        data: {
          title: caseTitle,
          court_name: f.court || caseTitle,
          case_number_official: cn || caseTitle,
          case_number: cn || null,
          court: f.court || null,
          case_type: ct || null,
          plaintiff: f.plaintiff || null,
          plaintiff_role: f.plaintiff_role || null,
          plaintiff_national_id: f.plaintiff_national_id || null,
          plaintiff_power_of_attorney: f.plaintiff_power_of_attorney || null,
          defendant: f.defendant || null,
          defendant_role: f.defendant_role || null,
          defendant_national_id: f.defendant_national_id || null,
          circuit_number: f.circuit_number || null,
          // ⚡ FIX: كانت الصفة (plaintiff_role/defendant_role) والدور/القاعة
          // بيتسجلوا صح في الجلسة المستقلة لكن بيضيعوا وقت تحويلها لملف
          // قضية. دلوقتي session_hall هو الحقل الموحّد الوحيد لمكان الجلسة
          // (مش court_floor القديم المهجور)، وبننقل درجة التقاضي وبيانات
          // السكرتير كمان بنفس المنطق.
          session_hall: f.session_hall || null,
          // ⚡ FIX: session_time كان بيضيع تمامًا عند تحويل جلسة مستقلة
          // لقضية — الحقل ده كان متسجل صح في الجلسة، بس مكانش بينتقل للقضية
          // الجديدة، فكان بيبان فاضي في تاب البيانات وتقرير الـ PDF.
          session_time: f.session_time || null,
          court_level: cl || null,
          secretary_hall: f.secretary_hall || null,
          secretary_name: f.secretary_name || null,
          secretary_mobile: f.secretary_mobile || null,
          status: 'نشطة',
          _offlineTempId: offlineTempId,
        },
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
          data: {
            case_id: realOrTempCaseId,
            // 🆕 المرحلة 2: sentinel التمبيد العام بيتبعت بس لما القضية نفسها
            // لسه تمبيد (أوفلاين) — لو نجحت أونلاين، case_id بالفعل id حقيقي
            // ومحتاجش أي حل وقت المزامنة.
            ...((offline && queued) ? { _offlineFkTempId: [{ field: 'case_id', tempId: offlineTempId, table: 'cases' as const, fallbackNameValue: caseTitle }] } : {}),
          },
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
      const { data: clients } = await db.from('clients').select('id,full_name').ilike(`full_name`, `%${plaintiffName}%`).limit(3);
      if (clients && clients.length > 0) {
        setFoundClient(clients[0]);
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
      const isTempCaseId = createdCaseId.startsWith('tmp-');
      const caseTitle = isTempCaseId && savedFormData
        ? (savedFormData.form.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة')
        : undefined;
      const { error, offline, queued } = await window.__dbWrite({
        type: 'UPDATE',
        table: 'cases',
        id: createdCaseId,
        data: {
          client_id: foundClient.id,
          ...(isTempCaseId ? { _offlineSelfTempId: createdCaseId, _offlineSelfFallbackName: caseTitle } : {}),
        },
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

  const handleAddAndLinkClient = async () => {
    if (!savedFormData || !createdCaseId) return;
    setLinkingToCase(true);
    try {
      const { form: f } = savedFormData;
      const name = f.plaintiff?.trim();
      if (!name) return;
      const nameErr = validateFullNameParts(name);
      if (nameErr) { toast(nameErr, true); return; }
      const tenantId = getCurrentTenantId();
      if (!tenantId) { toast('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true); return; }
      // ⚡ تحقق موحّد: يرفض الإضافة لو نفس الاسم أو الرقم القومي أو رقم
      // التوكيل مسجل لموكل موجود بالفعل (نفس المكتب) — راجع clientValidation.ts.
      // ⚡ NEW (19 يوليو 2026): كنا بنبعت الاسم والرقم القومي بس، دلوقتي
      // بنبعت f.plaintiff_power_of_attorney كـ cr_number كمان.
      const dup = await checkClientDuplicate(db, { full_name: name, national_id: f.plaintiff_national_id, cr_number: f.plaintiff_power_of_attorney });
      // ⚡ NEW: بدل توست بيوقف الموضوع، بنستخدم نفس خطوة "found" الموجودة
      // فعلاً (بحث الاسم التلقائي) عشان نعرض زرار "ربط بهذا الموكل" جاهز —
      // فيه فرق واحد إن هنا التطابق مؤكد (اسم/رقم قومي/توكيل بالظبط)، مش
      // تخمين بالاسم بس.
      if (dup.duplicate) {
        if (dup.client) { setFoundClient(dup.client); setClientStep('found'); }
        else toast(dup.message!, true);
        return;
      }
      // 🆕 المرحلة 3-2 (خطة توسيع الأوفلاين): تحويل من db.from() المباشر
      // لـ __dbWrite. نفس نمط تمبيد القضايا من المرحلة 2 — تمبيد بيتبعت
      // دايمًا مع العميل الجديد بغض النظر عن حالة الاتصال، عشان لو الاتصال
      // قطع فجأة أثناء المحاولة يبقى معانا مرجع كافي للربط وقت المزامنة.
      const clientTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { data, error, offline: clientOffline, queued: clientQueued } = await window.__dbWrite({
        type: 'INSERT',
        table: 'clients',
        data: {
          // ⚠️ نفس الباگ الموثّق سابقًا (اتأكد بالاستعلام على
          // information_schema): client_name عمود إجباري (NOT NULL)،
          // full_name عمود تاني اختياري بيتحدّث معاه — والاتنين لازم
          // يتبعتوا مع بعض. tenant_id مطلوب لأن الـ RLS policy
          // (tenant_id = current_tenant_id()) كانت بترفض الإدراج بصمت
          // من غيره.
          client_name: name,
          full_name: name,
          tenant_id: tenantId,
          national_id: f.plaintiff_national_id || null,
          // power_of_attorney مش عمود موجود في جدول clients — التوكيل
          // بيتسجل فعلاً على مستوى الجلسة نفسها (plaintiff_power_of_attorney
          // في case_sessions فوق)، فمحتاجش يتكرر هنا.
          _offlineTempId: clientTempId,
        },
        returning: true,
      });
      if (error) {
        showErrorToast('client_create', error, 'تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', 'إضافة موكل');
        return;
      }
      // 🆕 المرحلة 3-2: نفس منطق realOrTempCaseId من المرحلة 2 — أوفلاين،
      // بنستخدم التمبيد نفسه كمرجع مؤقت للعميل بدل id حقيقي مش موجود بعد.
      const realOrTempClientId = (clientOffline && clientQueued) ? clientTempId : (data as { id: string } | null)?.id;
      if (!realOrTempClientId) { showErrorToast('client_create', new Error('no id returned'), 'تعذّر إضافة الموكل. حاول مرة أخرى.', 'إضافة موكل'); return; }
      // 🆕 المرحلة 3-2: نفس فحص isTempCaseId من المرحلة 3-1 بالظبط —
      // القضية نفسها (createdCaseId) ممكن تكون لسه تمبيد لو اتقيدت أوفلاين
      // في handleLinkCase قبلها.
      const isTempCaseId = createdCaseId.startsWith('tmp-');
      const caseTitle = isTempCaseId ? (f.title || savedFormData.fullCaseNumber || 'قضية من جلسة مستقلة') : undefined;
      const isTempClientId = clientOffline && clientQueued;
      const { error: linkErr, offline, queued } = await window.__dbWrite({
        type: 'UPDATE',
        table: 'cases',
        id: createdCaseId,
        data: {
          client_id: realOrTempClientId,
          // 🆕 المرحلة 3-2: العملية دي ممكن تحمل الاتنين مع بعض في نفس
          // الوقت — تمبيد id السطر المستهدف نفسه (القضية، لو أوفلاين من
          // handleLinkCase) وتمبيد حقل FK جوه data (العميل، لو اتقيّد لسه
          // في نداء الإدراج فوق). resolveOfflineSelfId وresolveOfflineFkRefs
          // بيشتغلوا بالتتابع في دورة المزامنة (شوف offlineQueue.ts) من
          // غير تعارض بينهم — ده بالظبط سيناريو "تمبيدين متزامنين" اللي
          // resolveOfflineFkRefs اتصممت له من المرحلة 1.
          ...(isTempCaseId ? { _offlineSelfTempId: createdCaseId, _offlineSelfFallbackName: caseTitle } : {}),
          ...(isTempClientId ? { _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients' as const, fallbackNameValue: name }] } : {}),
        },
      });
      if (linkErr) {
        showErrorToast('session_client_link', linkErr, 'تعذّر ربط الموكل بالقضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'ربط الموكل بالقضية');
      } else if (offline && queued) {
        // ⚠️ ممكن نوصل هنا حتى لو أونلاين فعليًا (isTempCaseId بيفرض القيد
        // — شوف forceQueueForSelfTempId في __dbWrite)، أو لو العميل نفسه
        // اتقيّد أوفلاين وقت الإدراج فوق. الرسالة لسه دقيقة في الحالتين
        // لأن الربط النهائي هيحصل بعد اكتمال المزامنة، مش فورًا.
        toast('📥 إضافة الموكل وربطه محفوظة محلياً — ستُزامن عند عودة الإنترنت');
        setClientStep('done');
        onClientAdded?.();
      } else {
        toast('✅ تمت إضافة الموكل وربطه بالقضية');
        setClientStep('done');
        onClientAdded?.();
      }
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingToCase(false); }
  };

  // ⚡ FIX: قبل كده الزرار ده كان بينشئ الموكل بس من غير ما يربطه
  // بـ case_sessions.client_id — فالجلسة كانت تفضل "مش مربوطة"، وزرار
  // "🔗 ربط" يفضل ظاهر تاني لو المستخدم فتح تفاصيل الجلسة بعدها، وممكن
  // يضيف نفس الموكل تاني بالغلط. دلوقتي بنربط الموكل الجديد بالجلسة اللي
  // اتحفظت لسه (savedFormData.sessionId) على طول.
  const handleAddClientOnly = async () => {
    if (!savedFormData) return;
    setLinkingClient(true);
    try {
      const { form: f } = savedFormData;
      const name = f.plaintiff?.trim();
      if (!name) return;
      const nameErr = validateFullNameParts(name);
      if (nameErr) { toast(nameErr, true); return; }
      const tenantId = getCurrentTenantId();
      if (!tenantId) { toast('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true); return; }
      // ⚡ تحقق موحّد: يرفض الإضافة لو نفس الاسم أو الرقم القومي أو رقم
      // التوكيل مسجل لموكل موجود بالفعل (نفس المكتب) — راجع clientValidation.ts.
      // ⚡ NEW (19 يوليو 2026): f.plaintiff_power_of_attorney بيتبعت كـ
      // cr_number دلوقتي (كان مفقود من الفحص خالص قبل كده).
      const dup = await checkClientDuplicate(db, { full_name: name, national_id: f.plaintiff_national_id, cr_number: f.plaintiff_power_of_attorney });
      // ⚡ NEW: بدل توست بس، بنعرض زرار "ربط الجلسة بيه مباشرة" (المسار ده
      // مالوش قضية أصلاً — case_sessions.client_id بس — فمينفعش نستخدم
      // نفس خطوة "found" اللي بتربط cases.client_id).
      if (dup.duplicate) {
        if (dup.client) { setFoundClient(dup.client); setClientStep('duplicateSession'); }
        else toast(dup.message!, true);
        return;
      }
      const clientTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { data, error, offline: clientOffline, queued: clientQueued } = await window.__dbWrite({
        type: 'INSERT',
        table: 'clients',
        data: {
          // نفس الإصلاح المذكور فوق في handleAddAndLinkClient — client_name
          // هو العمود الإجباري الحقيقي، وtenant_id مطلوب عشان الـ RLS.
          client_name: name,
          full_name: name,
          tenant_id: tenantId,
          national_id: f.plaintiff_national_id || null,
          // power_of_attorney مش عمود موجود في clients، والتوكيل متسجل على
          // مستوى الجلسة.
          _offlineTempId: clientTempId,
        },
        returning: true,
      });
      if (error) {
        showErrorToast('client_create', error, 'تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', 'إضافة موكل');
        return;
      }
      // لو الجلسة لسه ما اتحفظتش أونلاين (sessionId فاضي — نفس الحالة
      // الموثّقة في handleLinkCase/handleLinkExistingClient فوق)، مفيش id
      // نربط بيه دلوقتي — نكتفي بإضافة الموكل زي السلوك القديم، من غير
      // ما نحتاج نتأكد من id العميل الجديد أصلاً.
      let linkedToSession = false;
      if (savedFormData.sessionId) {
        const isTempClientId = clientOffline && clientQueued;
        const realOrTempClientId = isTempClientId ? clientTempId : (data as { id: string } | null)?.id;
        if (realOrTempClientId) {
          const { error: linkErr } = await window.__dbWrite({
            type: 'UPDATE',
            table: 'case_sessions',
            id: savedFormData.sessionId,
            data: {
              client_id: realOrTempClientId,
              ...(isTempClientId ? { _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients' as const, fallbackNameValue: name }] } : {}),
            },
          });
          if (linkErr) {
            showErrorToast('session_client_link', linkErr, 'تمت إضافة الموكل لكن تعذّر ربطه بالجلسة. حاول تحديث الصفحة.', 'ربط الموكل بالجلسة');
          } else {
            linkedToSession = true;
          }
        }
      }
      if (clientOffline && clientQueued) {
        toast(linkedToSession
          ? '📥 إضافة الموكل وربطه بالجلسة محفوظة محلياً — ستُزامن عند عودة الإنترنت'
          : '📥 الموكل محفوظ محلياً — سيُضاف فور عودة الإنترنت');
      } else {
        toast(linkedToSession ? '✅ تمت إضافة الموكل وربطه بالجلسة' : '✅ تمت إضافة الموكل لقائمة الموكلين');
      }
      onClientAdded?.();
      onSaved();
      setClientStep('done');
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingClient(false); }
  };

  // ⚡ NEW (19 يوليو 2026): ربط الجلسة مباشرة (case_sessions.client_id)
  // بموكل موجود بالفعل — بتتستخدم من خطوة 'duplicateSession' لما
  // handleAddClientOnly يكتشف تكرار، بدل ما نسيب المستخدم يدوّر يدويًا.
  const handleLinkFoundClientToSession = async () => {
    if (!savedFormData?.sessionId || !foundClient) return;
    setLinkingClient(true);
    try {
      const { error, offline, queued } = await window.__dbWrite({
        type: 'UPDATE', table: 'case_sessions', id: savedFormData.sessionId, data: { client_id: foundClient.id },
      });
      if (error) {
        showErrorToast('session_client_link', error, 'تعذّر ربط الموكل بالجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'ربط الموكل بالجلسة');
        return;
      }
      toast(offline && queued ? '📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت' : '✅ تم ربط الموكل بالجلسة');
      onClientAdded?.();
      onSaved();
      setClientStep('done');
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingClient(false); }
  };

  return {
    linkingCase, linkingClient, linkingToCase,
    createdCaseId, setCreatedCaseId,
    clientStep, setClientStep,
    foundClient, setFoundClient,
    handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
    handleLinkFoundClientToSession,
  };
}
