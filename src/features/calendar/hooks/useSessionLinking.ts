import { useState } from 'react';
import { toast } from '../../../shared/lib/notifications';
import { validateFullNameParts, checkClientDuplicate } from '../../../shared/lib/clientValidation';
import { showErrorToast } from '../../../shared/lib/errorReporting';
import { getCurrentTenantId } from '../../../constants';
import { ilikeOrClause } from '../../../shared/lib/sanitize';
import { recalcNextHearing } from '../../../shared/lib/dataAccess';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../../database.types';
import type { CaseSessionRow } from '../../../types';

export type ClientSearchResult = { id: string; full_name: string | null; client_name: string | null; national_id: string | null };

/**
 * منطق ربط جلسة مستقلة *محفوظة بالفعل* (session already في الـ DB، مش
 * بيانات form لسه ما اتحفظتش) — بيغطي 3 مسارات:
 *  1) إنشاء ملف قضية من بيانات الجلسة (ونفس البحث التلقائي عن موكل مطابق
 *     زي ما كان موجود في useClientLinking، بس هنا بيربط createdCaseId
 *     بدل savedFormData.sessionId لأن الجلسة already موجودة).
 *  2) إضافة الموكل لقائمة الموكلين + ربطه بالجلسة مباشرة (case_sessions.client_id).
 *  3) [جديد] بحث يدوي في الموكلين الموجودين بالفعل وربط الجلسة مباشرة
 *     بـ client_id بتاعه (case_sessions.client_id) من غير إنشاء قضية.
 */
export function useSessionLinking(session: CaseSessionRow, db: SupabaseClient<Database>, onDone: () => void, onClientAdded?: () => void) {
  const [linkingCase, setLinkingCase] = useState(false);
  const [linkingClient, setLinkingClient] = useState(false);
  const [linkingToCase, setLinkingToCase] = useState(false);
  const [linkingExisting, setLinkingExisting] = useState(false);
  const [createdCaseId, setCreatedCaseId] = useState<string | null>(null);
  const [clientStep, setClientStep] = useState<'idle' | 'found' | 'notfound' | 'searching' | 'done'>('idle');
  const [foundClient, setFoundClient] = useState<{ id: string; full_name: string | null } | null>(null);

  const [clientSearch, setClientSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ClientSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedExistingClient, setSelectedExistingClient] = useState<ClientSearchResult | null>(null);

  // ── 1) إنشاء ملف قضية من بيانات الجلسة ──
  const handleLinkCase = async () => {
    setLinkingCase(true);
    try {
      const caseTitle = session.title || session.case_number || 'قضية من جلسة مستقلة';
      // 🆕 المرحلة 2 (خطة توسيع الأوفلاين): نفس نمط useClientLinking.ts —
      // معرّف مؤقت client-side بيتبعت مع القضية بغض النظر عن حالة الاتصال.
      const offlineTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { error, offline, queued, data: insertedCase } = await window.__dbWrite({
        type: 'INSERT',
        table: 'cases',
        data: {
          title: caseTitle,
          court_name: session.court || caseTitle,
          case_number_official: session.case_number || caseTitle,
          case_number: session.case_number || null,
          court: session.court || null,
          case_type: session.case_type || null,
          plaintiff: session.plaintiff || null,
          plaintiff_role: session.plaintiff_role || null,
          plaintiff_national_id: session.plaintiff_national_id || null,
          plaintiff_power_of_attorney: session.plaintiff_power_of_attorney || null,
          defendant: session.defendant || null,
          defendant_role: session.defendant_role || null,
          defendant_national_id: session.defendant_national_id || null,
          circuit_number: session.circuit_number || null,
          // ⚡ نفس إصلاح useClientLinking.ts — نقل الصفة ومكان الجلسة ودرجة
          // التقاضي وبيانات السكرتير من الجلسة لملف القضية الجديد بدل ما
          // يضيعوا. session_hall هو الحقل الموحّد (مش court_floor القديم).
          session_hall: session.session_hall || null,
          // ⚡ FIX: نفس إصلاح useClientLinking.ts — session_time كان بيضيع
          // عند تحويل جلسة مستقلة لقضية.
          session_time: session.session_time || null,
          court_level: session.court_level || null,
          secretary_hall: session.secretary_hall || null,
          secretary_name: session.secretary_name || null,
          secretary_mobile: session.secretary_mobile || null,
          status: 'نشطة',
          // ⚡ FIX: لو الموكل كان اتربط بالجلسة المستقلة قبل إنشاء القضية
          // (عن طريق "إضافة الموكل لقائمة الموكلين فقط" أو "ربط بموكل
          // موجود")، لازم القضية الجديدة تورّث نفس الربط تلقائيًا بدل ما
          // نستنى المستخدم يدوّر تاني على نفس الموكل بالاسم.
          client_id: session.client_id || null,
          _offlineTempId: offlineTempId,
        },
        returning: true,
      });
      if (error) {
        showErrorToast('case_create', error, 'تعذّر إنشاء القضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'إنشاء قضية');
        return;
      }
      // 🆕 المرحلة 2: نفس منطق useClientLinking.ts — أوفلاين، بنستخدم
      // التمبيد نفسه كمرجع مؤقت بدل id حقيقي غير موجود.
      const realOrTempCaseId = (offline && queued) ? offlineTempId : (insertedCase as { id: string } | null)?.id;
      if (!realOrTempCaseId) { showErrorToast('case_create', new Error('no id returned'), 'تعذّر إنشاء القضية. حاول مرة أخرى.', 'إنشاء قضية'); return; }
      if (offline && queued) {
        toast('📥 القضية محفوظة محلياً — ستُضاف فور عودة الإنترنت');
      } else {
        toast('✅ تم إنشاء ملف القضية');
      }
      setCreatedCaseId(realOrTempCaseId);
      // ⚠️ session.id هنا حقيقي دايمًا (الجلسة already موجودة فعليًا في
      // القاعدة، بعكس useClientLinking.ts اللي ممكن تكون لسه بيانات form) —
      // فمحتاجش أي تمبيد لـ id الجلسة نفسها، بس case_id ممكن يكون تمبيد.
      const { error: sessionLinkErr } = await window.__dbWrite({
        type: 'UPDATE',
        table: 'case_sessions',
        id: session.id,
        data: {
          case_id: realOrTempCaseId,
          ...((offline && queued) ? { _offlineFkTempId: [{ field: 'case_id', tempId: offlineTempId, table: 'cases' as const, fallbackNameValue: caseTitle }] } : {}),
        },
      });
      if (sessionLinkErr) {
        showErrorToast('session_case_link', sessionLinkErr, 'تم إنشاء القضية لكن تعذّر ربط الجلسة بها. حاول تحديث الصفحة.', 'ربط الجلسة بالقضية');
      } else if (!(offline && queued)) {
        // ⚡ FIX: نفس إصلاح useClientLinking.ts — next_hearing كان بيفضل فاضي.
        // 🆕 المرحلة 2: أونلاين بس — أوفلاين هتتحسب تلقائيًا بعد المزامنة
        // (المرحلة 4 القادمة، لسه ما اتنفذتش).
        await recalcNextHearing(db, realOrTempCaseId);
      }
      onDone();
      // ⚡ FIX: لو session.client_id موجود بالفعل، القضية الجديدة اتربطت
      // بيه أوتوماتيك من صف الـ INSERT فوق — مفيش داعي ندوّر تاني بالاسم
      // ونعرض خطوة "لقينا موكل مطابق"، ده هيكرر نفس الربط أو يلخبط
      // المستخدم من غير فايدة.
      if (session.client_id) { setClientStep('done'); return; }
      const plaintiffName = session.plaintiff?.trim();
      if (!plaintiffName) { setClientStep('notfound'); return; }
      const { data: clients } = await db.from('clients').select('id,full_name').is('deleted_at', null).ilike('full_name', `%${plaintiffName}%`).limit(3);
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
      // 🆕 المرحلة 3-1: نفس تحويل useClientLinking.ts بالظبط — createdCaseId
      // ممكن يكون لسه تمبيد لو القضية اتقيدت أوفلاين في handleLinkCase فوق.
      // caseTitle هنا بنفس منطق حسابه في handleLinkCase (session.title ||
      // session.case_number) عشان يتستخدم كـ fallback بالاسم لو احتجنا.
      const isTempCaseId = createdCaseId.startsWith('tmp-');
      const caseTitle = isTempCaseId ? (session.title || session.case_number || 'قضية من جلسة مستقلة') : undefined;
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
        showErrorToast('session_client_link', error, 'تعذّر ربط الموكل بالقضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'ربط الموكل بالقضية');
      } else if (offline && queued) {
        toast('📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
        setClientStep('done');
      } else { toast('✅ تم ربط الموكل بالقضية'); setClientStep('done'); }
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingToCase(false); }
  };

  const handleAddAndLinkClient = async () => {
    if (!createdCaseId) return;
    setLinkingToCase(true);
    try {
      const name = session.plaintiff?.trim();
      if (!name) return;
      const nameErr = validateFullNameParts(name);
      if (nameErr) { toast(nameErr, true); return; }
      const tenantId = getCurrentTenantId();
      if (!tenantId) { toast('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true); return; }
      // ⚡ تحقق موحّد: يرفض الإضافة لو نفس الاسم أو الرقم القومي أو رقم
      // التوكيل مسجل لموكل موجود بالفعل (نفس المكتب) — راجع clientValidation.ts.
      // ⚡ NEW (19 يوليو 2026): session.plaintiff_power_of_attorney بيتبعت
      // كـ cr_number دلوقتي (كان مفقود من الفحص خالص قبل كده).
      const dup = await checkClientDuplicate(db, { full_name: name, national_id: session.plaintiff_national_id, cr_number: session.plaintiff_power_of_attorney });
      // ⚡ NEW: بدل توست بس، بنستخدم نفس خطوة "found" الموجودة (بتربط
      // cases.client_id عبر createdCaseId، متسق مع باقي الدالة دي).
      if (dup.duplicate) {
        if (dup.client) { setFoundClient(dup.client); setClientStep('found'); }
        else toast(dup.message!, true);
        return;
      }
      // 🆕 المرحلة 3-2 (خطة توسيع الأوفلاين): نفس تحويل useClientLinking.ts
      // بالظبط — تمبيد بيتبعت دايمًا مع العميل الجديد بغض النظر عن حالة
      // الاتصال.
      const clientTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { data, error, offline: clientOffline, queued: clientQueued } = await window.__dbWrite({
        type: 'INSERT',
        table: 'clients',
        data: {
          client_name: name,
          full_name: name,
          tenant_id: tenantId,
          national_id: session.plaintiff_national_id || null,
          _offlineTempId: clientTempId,
        },
        returning: true,
      });
      if (error) {
        showErrorToast('client_create', error, 'تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', 'إضافة موكل');
        return;
      }
      // 🆕 المرحلة 3-2: نفس منطق useClientLinking.ts — أوفلاين، بنستخدم
      // التمبيد نفسه كمرجع مؤقت للعميل بدل id حقيقي مش موجود بعد.
      const realOrTempClientId = (clientOffline && clientQueued) ? clientTempId : (data as { id: string } | null)?.id;
      if (!realOrTempClientId) { showErrorToast('client_create', new Error('no id returned'), 'تعذّر إضافة الموكل. حاول مرة أخرى.', 'إضافة موكل'); return; }
      // 🆕 المرحلة 3-2: نفس فحص isTempCaseId من handleLinkExistingClient
      // فوق (المرحلة 3-1) — createdCaseId ممكن يكون لسه تمبيد.
      const isTempCaseId = createdCaseId.startsWith('tmp-');
      const caseTitle = isTempCaseId ? (session.title || session.case_number || 'قضية من جلسة مستقلة') : undefined;
      const isTempClientId = clientOffline && clientQueued;
      const { error: linkErr, offline, queued } = await window.__dbWrite({
        type: 'UPDATE',
        table: 'cases',
        id: createdCaseId,
        data: {
          client_id: realOrTempClientId,
          // 🆕 المرحلة 3-2: نفس تعليق useClientLinking.ts — العملية دي ممكن
          // تحمل تمبيد id السطر نفسه (القضية) وتمبيد حقل FK جوه data
          // (العميل) مع بعض؛ resolveOfflineSelfId وresolveOfflineFkRefs
          // بيشتغلوا بالتتابع من غير تعارض (شوف offlineQueue.ts).
          ...(isTempCaseId ? { _offlineSelfTempId: createdCaseId, _offlineSelfFallbackName: caseTitle } : {}),
          ...(isTempClientId ? { _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients' as const, fallbackNameValue: name }] } : {}),
        },
      });
      if (linkErr) {
        showErrorToast('session_client_link', linkErr, 'تعذّر ربط الموكل بالقضية. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'ربط الموكل بالقضية');
      } else if (offline && queued) {
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

  // ── 2) إضافة الموكل لقائمة الموكلين + ربطه بالجلسة نفسها ──
  // ⚡ FIX: قبل كده الزرار ده كان بينشئ الموكل بس من غير ما يربطه بالجلسة
  // (case_sessions.client_id فاضل null) — فالجلسة تفضل "مش مربوطة" في نظر
  // isAlreadyLinked، وزرار "🔗 ربط" يفضل ظاهر تاني ويسمح بتكرار نفس الموكل.
  // دلوقتي بنربط الموكل الجديد بالجلسة على طول زي مسار "ربط بموكل موجود".
  const handleAddClientOnly = async () => {
    setLinkingClient(true);
    try {
      const name = session.plaintiff?.trim();
      if (!name) return;
      const nameErr = validateFullNameParts(name);
      if (nameErr) { toast(nameErr, true); return; }
      const tenantId = getCurrentTenantId();
      if (!tenantId) { toast('❌ تعذر تحديد المكتب الحالي، أعد تحميل الصفحة وحاول مرة أخرى', true); return; }
      // ⚡ تحقق موحّد: يرفض الإضافة لو نفس الاسم أو الرقم القومي أو رقم
      // التوكيل مسجل لموكل موجود بالفعل (نفس المكتب) — راجع clientValidation.ts.
      // ⚡ NEW (19 يوليو 2026): session.plaintiff_power_of_attorney بيتبعت
      // كـ cr_number دلوقتي (كان مفقود من الفحص خالص قبل كده).
      const dup = await checkClientDuplicate(db, { full_name: name, national_id: session.plaintiff_national_id, cr_number: session.plaintiff_power_of_attorney });
      // ⚡ NEW: بدل توست بس، بنستخدم نفس خطوة "searching"/"selectedExistingClient"
      // الموجودة فعلاً (البحث اليدوي) — بنحط الموكل المطابق كـ"مختار" على
      // طول، فبيبان زرار "ربط" الجاهز من غير ما المستخدم يدوّر عليه.
      if (dup.duplicate) {
        if (dup.client) {
          setSelectedExistingClient({ id: dup.client.id, full_name: dup.client.full_name, client_name: dup.client.full_name, national_id: null });
          setClientStep('searching');
        } else toast(dup.message!, true);
        return;
      }
      const clientTempId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const { data, error, offline: clientOffline, queued: clientQueued } = await window.__dbWrite({
        type: 'INSERT',
        table: 'clients',
        data: {
          client_name: name,
          full_name: name,
          tenant_id: tenantId,
          national_id: session.plaintiff_national_id || null,
          _offlineTempId: clientTempId,
        },
        returning: true,
      });
      if (error) {
        showErrorToast('client_create', error, 'تعذّر إضافة الموكل. تحقق من صحة البيانات. لو المشكلة استمرت، تواصل مع الدعم.', 'إضافة موكل');
        return;
      }
      const realOrTempClientId = (clientOffline && clientQueued) ? clientTempId : (data as { id: string } | null)?.id;
      if (!realOrTempClientId) { showErrorToast('client_create', new Error('no id returned'), 'تعذّر إضافة الموكل. حاول مرة أخرى.', 'إضافة موكل'); return; }
      const isTempClientId = clientOffline && clientQueued;
      const { error: linkErr, offline, queued } = await window.__dbWrite({
        type: 'UPDATE',
        table: 'case_sessions',
        id: session.id,
        data: {
          client_id: realOrTempClientId,
          ...(isTempClientId ? { _offlineFkTempId: [{ field: 'client_id', tempId: clientTempId, table: 'clients' as const, fallbackNameValue: name }] } : {}),
        },
      });
      if (linkErr) {
        showErrorToast('session_client_link', linkErr, 'تمت إضافة الموكل لكن تعذّر ربطه بالجلسة. حاول تحديث الصفحة.', 'ربط الموكل بالجلسة');
        onClientAdded?.();
        return;
      }
      if (offline && queued) {
        toast('📥 إضافة الموكل وربطه بالجلسة محفوظة محلياً — ستُزامن عند عودة الإنترنت');
      } else {
        toast('✅ تمت إضافة الموكل وربطه بالجلسة');
      }
      onClientAdded?.();
      onDone();
      setClientStep('done');
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingClient(false); }
  };

  // ── 3) [جديد] بحث يدوي في الموكلين الموجودين وربط الجلسة مباشرة بيه ──
  const searchExistingClients = async (term: string) => {
    setClientSearch(term);
    setSelectedExistingClient(null);
    const q = term.trim();
    if (!q) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const { data, error } = await db.from('clients')
        .select('id,full_name,client_name,national_id')
        .is('deleted_at', null)
        .or([ilikeOrClause('client_name', q), ilikeOrClause('full_name', q), ilikeOrClause('national_id', q), ilikeOrClause('phone', q)].join(','))
        .limit(15);
      if (error) {
        showErrorToast('client_search', error, 'تعذّر البحث عن الموكلين. حاول مرة أخرى.', 'بحث الموكلين');
        return;
      }
      setSearchResults((data as ClientSearchResult[]) || []);
    } catch { toast('❌ خطأ غير متوقع أثناء البحث', true); }
    finally { setSearching(false); }
  };

  const confirmLinkToExistingClient = async () => {
    if (!selectedExistingClient) return;
    setLinkingExisting(true);
    try {
      // ⚡ FIX (مرحلة 0 — توسيع الأوفلاين): تحويل من db.from() المباشر لـ
      // __dbWrite. عملية UPDATE مستقلة بمعرّفين حقيقيين بالفعل (session.id
      // جلسة موجودة فعلاً، selectedExistingClient.id موكل موجود فعلاً) —
      // مفيش أي سلسلة تعتمد على id لسه في الطابور، فآمنة تتحول فورًا.
      const { error, offline, queued } = await window.__dbWrite({
        type: 'UPDATE', table: 'case_sessions', data: { client_id: selectedExistingClient.id }, id: session.id,
      });
      if (error) {
        showErrorToast('session_client_link', error, 'تعذّر ربط الموكل بالجلسة. حاول مرة أخرى. لو المشكلة استمرت، تواصل مع الدعم.', 'ربط الموكل بالجلسة');
        return;
      }
      if (offline && queued) {
        toast('📥 الربط محفوظ محلياً — سيُزامن عند عودة الإنترنت');
      } else {
        toast('✅ تم ربط الجلسة بالموكل');
      }
      onDone();
      setClientStep('done');
    } catch { toast('❌ خطأ غير متوقع', true); }
    finally { setLinkingExisting(false); }
  };

  return {
    linkingCase, linkingClient, linkingToCase, linkingExisting,
    createdCaseId, clientStep, setClientStep, foundClient,
    clientSearch, searchResults, searching, selectedExistingClient, setSelectedExistingClient,
    handleLinkCase, handleLinkExistingClient, handleAddAndLinkClient, handleAddClientOnly,
    searchExistingClients, confirmLinkToExistingClient,
  };
}
