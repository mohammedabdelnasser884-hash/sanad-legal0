import React from 'react';
import { createPortal } from 'react-dom';
import { COUNTRY_CONFIGS } from '../constants';
import type { TabName } from '../useNavigation';
import type { NavigationState } from '../useNavigation';
import type { DeleteConfirmState, CaseFormSubmitData } from '@/features/cases/hooks/useCaseActions';
import type { ClientFormData, ClientModalContext } from '@/features/clients/hooks/useClientActions';
import type { OpenCreateClientForSession, OpenCreateClientForCase, OpenCreateClientForParty, OpenCreateClientForSessionParty } from '@/features/calendar/hooks/useClientLinking';
import type { MappedCase, MappedClient } from '../hooks/useAppData';
import type { ProfileRow } from '../types';
import NewCaseModal from '../features/cases/NewCaseModal';
import NewClientModal from '../features/clients/NewClientModal';
import UserFormModal from '@/features/admin/users/UserFormModal';
import ClientDetailModal from '../features/clients/ClientDetailModal';
import UniversalSearchModal from '../shared/modals/UniversalSearchModal';
import AILegalAssistant from '../features/ai/AILegalAssistant';
import DeleteConfirmModal from '@/shared/modals/DeleteConfirmModal';
import NewStandaloneSessionModal from '../features/calendar/NewStandaloneSessionModal';
import CaseDetailView from '../features/cases/CaseDetailView';

interface AppModalsProps {
    // ── بيانات أساسية ──
    cases: MappedCase[];
    clients: MappedClient[];
    lawyers: ProfileRow[];
    profile: ProfileRow | null;
    country: string;
    isAdmin: boolean;
    casesFilter: string;
    nav: NavigationState;

    // ── حالات إظهار المودالات ──
    showSearch: boolean;
    showAI: boolean;
    showCaseModal: boolean;
    showNewSessionModal: boolean;
    showLawyerModal: boolean;
    showClientModal: boolean;
    savingCase: boolean;
    savingLawyer: boolean;
    savingClient: boolean;
    deleteConfirm: DeleteConfirmState | null;
    selectedClient: MappedClient | null;
    selectedCase: MappedCase | null;
    selectedCaseInitialTab: string;
    // ⚡ NEW: سياق فتح موديل "إنشاء موكل جديد" من جوه قضية/جلسة —
    // شوف useClientActions.ts (ClientModalContext) وApp.tsx.
    clientModalContext: ClientModalContext | null;
    openNewClientModal: (ctx: ClientModalContext) => void;

    // ── setters ──
    setShowSearch: (v: boolean) => void;
    setShowAI: (v: boolean) => void;
    setShowCaseModal: (v: boolean) => void;
    setShowNewSessionModal: (v: boolean) => void;
    setShowLawyerModal: (v: boolean) => void;
    setShowClientModal: (v: boolean) => void;
    setTab: (tab: TabName) => void;
    setSelectedCase: (caseOrUpdater: React.SetStateAction<MappedCase | null>, initialTab?: string) => void;
    setSelectedClient: (clientOrNull: MappedClient | null) => void;
    _setDeleteConfirm: React.Dispatch<React.SetStateAction<DeleteConfirmState | null>>;
    _setSelectedClient: React.Dispatch<React.SetStateAction<MappedClient | null>>;
    _setSelectedCase: React.Dispatch<React.SetStateAction<MappedCase | null>>;
    setCases: React.Dispatch<React.SetStateAction<MappedCase[]>>;
    setCasesFilter: (filter: string) => void;
    setCasesPage: (page: number) => void;

    // ── دوال fetch ──
    fetchCases: (page?: number, filter?: string) => Promise<void>;
    fetchTodaySessions: () => Promise<void>;
    fetchUpcomingSessions: () => Promise<void>;
    fetchClients: (page?: number, search?: string) => void | Promise<void>;
    clientSearch: string;

    // ── هاندلرز ──
    handleSaveCase: (form: CaseFormSubmitData) => void | Promise<void>;
    handleDeleteCase: (caseId: string) => void | Promise<void>;
    handleUpdateCase: (caseId: string, form: CaseFormSubmitData) => void | Promise<void>;
    handleLinkClient: (caseId: string, clientId: string) => void | Promise<void>;
    // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 4): عكس handleLinkClient.
    handleUnlinkClient: (caseId: string) => void | Promise<void>;
    // ⚡ CHANGED (خطة توحيد إنشاء الموكل، Phase 1): بقت مجرد فتح لموديل
    // "إنشاء موكل جديد" الموحّد — شوف App.tsx (handleOpenCreateClientForCase).
    handleCreateAndLinkClient: (caseId: string, plaintiffName: string, plaintiffNationalId?: string | null, plaintiffPoa?: string | null, plaintiffAddress?: string | null) => void;
    // ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 3): نفس فكرة handleCreateAndLinkClient
    // بس لـ "إضافة الموكل لقائمة الموكلين فقط" من جلسة مستقلة — شوف App.tsx.
    handleOpenCreateClientForSession: OpenCreateClientForSession;
    // ⚡ NEW (خطة توحيد إنشاء الموكل، Phase 2): نفس handleCreateAndLinkClient
    // (Phase 1) بس ممرّرة لـ NewStandaloneSessionModal — "إنشاء موكل جديد
    // وربطه" بعد تحويل جلسة مستقلة لقضية — شوف App.tsx.
    handleOpenCreateClientForSessionCase: OpenCreateClientForCase;
    // ⚡ NEW (خطة تعدد الأطراف، 7.2 جزء 2 بند 2.3 — 23 يوليو 2026): نفس
    // فكرة handleOpenCreateClientForSessionCase بس لطرف بعينه وسط wizard
    // "طرف واحد في المرة" — شوف App.tsx (handleOpenCreateClientForParty)
    // وuseClientLinking.ts (OpenCreateClientForParty).
    handleOpenCreateClientForSessionParty: OpenCreateClientForParty;
    // ⚡ NEW (خطة تعدد الأطراف، مرحلة 13 جزء 2 — 23 يوليو 2026): مرآة لـ
    // handleOpenCreateClientForSessionParty فوق، بس لخطوة "idle" (زرار
    // "إضافة الموكل لقائمة الموكلين فقط" — قبل حتى ما نعرف الجلسة هتتحول
    // لقضية ولا لأ، فمفيش caseId خالص) — شوف App.tsx
    // (handleOpenCreateClientForSessionPartyOnly) وuseClientLinking.ts
    // (OpenCreateClientForSessionParty).
    handleOpenCreateClientForSessionPartyOnly: OpenCreateClientForSessionParty;
    // ⚡ NEW (خطة تعدد الأطراف، مرحلة 13.1 — 23 يوليو 2026): نفس الدالة
    // بالظبط (handleOpenCreateClientForParty في App.tsx) بس ممرّرة كمان
    // لـ CaseDetailView — زرار "إنشاء موكل" لكل طرف عليه ⭐ ومش مربوط في
    // تفاصيل القضية (InfoSection.tsx)، مش بس وسط wizard الجلسة المستقلة.
    handleOpenCreateClientForCaseParty: OpenCreateClientForParty;
    handleSaveClient: (form: ClientFormData, idFile: File | null, poaFile: File | null) => void | Promise<void>;
    handleDeleteClient: (clientId: string) => void | Promise<void>;
    handleUpdateClient: (clientId: string, form: ClientFormData, idFile?: File | null, poaFile?: File | null) => void | Promise<void>;
    handleSaveLawyer: (form: { email: string; password: string; full_name: string; role?: string }) => void | Promise<void>;
    sendTelegram: (msg: string) => void | Promise<void>;
}

// ─────────────────────────────────────────────────────────
//  AppModals — منقول حرفيًا من App.tsx (دفعة 4): كل المودالات
//  اللي كانت بتترسم بعد الـ Command Dock (البحث، الذكاء الاصطناعي،
//  الإعدادات، تأكيد الحذف، الموديلات الجديدة لقضية/جلسة/محامي/موكل،
//  تفاصيل الموكل، تفاصيل القضية). صفر تغيير في المنطق أو الترتيب أو
//  شروط العرض — استبدلنا فقط الاعتماد من closure لـ props.
//  (ExitConfirmModal فضل في App.tsx زي ما هو — مش جزء من كتلة
//  "Modals" الأصلية، وده مكوّن منفصل خالص اتعمل من قبل.)
// ─────────────────────────────────────────────────────────
function AppModals({
    cases, clients, lawyers, profile, country, isAdmin, casesFilter, nav,
    showSearch, showAI, showCaseModal, showNewSessionModal,
    showLawyerModal, showClientModal, savingCase, savingLawyer, savingClient,
    deleteConfirm, selectedClient, selectedCase, selectedCaseInitialTab,
    clientModalContext, openNewClientModal,
    setShowSearch, setShowAI, setShowCaseModal, setShowNewSessionModal,
    setShowLawyerModal, setShowClientModal, setTab,
    setSelectedCase, setSelectedClient, _setDeleteConfirm, _setSelectedClient, _setSelectedCase,
    setCases, setCasesFilter, setCasesPage,
    fetchCases, fetchTodaySessions, fetchUpcomingSessions,
    fetchClients, clientSearch,
    handleSaveCase, handleDeleteCase, handleUpdateCase, handleLinkClient, handleUnlinkClient, handleCreateAndLinkClient,
    handleOpenCreateClientForSession, handleOpenCreateClientForSessionCase,
    handleOpenCreateClientForSessionParty, handleOpenCreateClientForCaseParty,
    handleOpenCreateClientForSessionPartyOnly,
    handleSaveClient, handleDeleteClient, handleUpdateClient, handleSaveLawyer,
    sendTelegram,
}: AppModalsProps) {
    return React.createElement(React.Fragment, null,
        // ⚠️ ملحوظة نوع (بدون تغيير سلوك): نتيجة بحث القضايا (SearchCaseResult
        // داخل UniversalSearchModal.tsx) شكلها أضيق من MappedCase الكامل —
        // ناقصها year/session_time. الحقلين دول مش بيتقراهم حد فعليًا في
        // CaseDetailView (اتأكد بالفحص) — يعني الفجوة خاملة (inert)، مالهاش
        // أثر وقت التشغيل. الكاست هنا بيحافظ على نفس السلوك الحالي بالظبط.
        // (فجوة بيانات الموكل المشابهة — notes/cr_number/contact_info/type —
        // اتقفلت: SearchClientResult بقت بتجيب الحقول دي فعليًا من الاستعلام.)
        showSearch && React.createElement(UniversalSearchModal, {
            cases, clients,
            onClose: () => setShowSearch(false),
            onOpenCase: (c) => { setSelectedCase(c as MappedCase, 'timeline'); },
            onOpenClient: (c) => { setSelectedClient(c as MappedClient); setTab('clients'); }
        }),
        showAI && createPortal(React.createElement(AILegalAssistant, { onClose: () => setShowAI(false), cases, clients, profile, country }), document.body),
        deleteConfirm && nav.isOpen('delete') && createPortal(React.createElement(DeleteConfirmModal, {
            title: deleteConfirm.title, itemName: deleteConfirm.name, itemType: deleteConfirm.itemType,
            // ⚠️ mode ميتبعتش افتراض ثابت هنا: لو deleteConfirm.mode مش متحدد
            // (القضايا والموكلين الاتنين دلوقتي بعد باتش 1.1/1.2)، المودال
            // بيعرض شاشة اختيار (أرشفة/حذف نهائي) لوحده. الاستخدام الوحيد
            // اللي لسه بيثبّت mode صراحة هو حذف دفعة أتعاب فردية فى
            // FeesTab.tsx (مفيش معنى لأرشفة دفعة لوحدها — حذف نهائي بس).
            mode: deleteConfirm.mode,
            onConfirm: deleteConfirm.onConfirm,
            onConfirmArchive: deleteConfirm.onConfirmArchive,
            onConfirmDelete: deleteConfirm.onConfirmDelete,
            deleteConsequences: deleteConfirm.deleteConsequences,
            onCancel: () => { nav.closeModal('delete'); _setDeleteConfirm(null); },
            loading: false,
            inputTestId: 'archive-confirm-input',
            confirmTestId: 'archive-confirm-button',
            cancelTestId: 'archive-cancel-button',
            choiceTestId: 'archive-confirm-choice',
        }), document.body),
        showCaseModal && React.createElement(NewCaseModal, {
            onClose: () => setShowCaseModal(false), onSave: handleSaveCase, loading: savingCase,
            lawyers, isAdmin, clients,
            countryCourts: COUNTRY_CONFIGS[country]?.courts,
            countryCaseTypes: COUNTRY_CONFIGS[country]?.caseTypes,
            openNewClientModal,
        }),
        showNewSessionModal && React.createElement(NewStandaloneSessionModal, {
            onClose: () => setShowNewSessionModal(false),
            onSaved: () => { fetchTodaySessions(); fetchUpcomingSessions(); fetchCases(0, casesFilter); },
            onClientAdded: () => { fetchClients(0, clientSearch); },
            onNotify: sendTelegram,
            cases,
            onOpenCreateClient: handleOpenCreateClientForSession,
            onOpenCreateClientForCase: handleOpenCreateClientForSessionCase,
            onOpenCreateClientForParty: handleOpenCreateClientForSessionParty,
            onOpenCreateClientForSessionParty: handleOpenCreateClientForSessionPartyOnly,
        }),
        showLawyerModal && React.createElement(UserFormModal, { onClose: () => setShowLawyerModal(false), onSave: handleSaveLawyer, loading: savingLawyer }),
        showClientModal && React.createElement(NewClientModal, {
            onClose: () => setShowClientModal(false), onSave: handleSaveClient, loading: savingClient,
            initialData: clientModalContext?.initialData,
            contextLabel: clientModalContext?.contextLabel,
        }),
        selectedClient && nav.isOpen('clientDetail') && React.createElement(ClientDetailModal, {
            client: selectedClient,
            cases: cases.filter((c) => c.client_id === selectedClient?.id),
            onClose: () => { nav.closeModal('clientDetail'); _setSelectedClient(null); },
            onDelete: handleDeleteClient, onEdit: handleUpdateClient,
            // 🔒 FIX (تقرير الموثوقية — نتيجة 1): EditClientModal ما كانش عنده
            // أي حماية دبل كليك خالص — بنمرر savingClient نفسها المستخدمة في
            // NewClientModal فوق (نفس الـ state، الاتنين بيستخدموا
            // handleSaveClient/handleUpdateClient من useClientActions.ts).
            savingClient,
            onOpenCase: (ca) => { nav.closeModal('clientDetail'); _setSelectedClient(null); setSelectedCase(ca); }
        }),
        selectedCase && nav.isOpen('caseDetail') && React.createElement(CaseDetailView, {
            caseData: selectedCase,
            client: clients.find((cl) => cl.id === selectedCase?.client_id) || null,
            clients,
            initialTab: selectedCaseInitialTab,
            onClose: () => { nav.closeModal('caseDetail'); _setSelectedCase(null); },
            onUpdate: (newStatus: string) => {
                setSelectedCase((p) => ({ ...p, status: newStatus } as MappedCase));
                setCases((prev) => prev.map((c) => c.id === selectedCase?.id ? { ...c, status: newStatus } : c));
                setCasesFilter(newStatus); setCasesPage(0); fetchCases(0, newStatus);
            },
            onDelete: handleDeleteCase, onEdit: handleUpdateCase, onLinkClient: handleLinkClient, onUnlinkClient: handleUnlinkClient, onCreateAndLinkClient: handleCreateAndLinkClient,
            // ⚡ NEW (مرحلة 13.1): زرار "إنشاء موكل" لكل طرف عليه ⭐ في تفاصيل القضية.
            // 🔧 FIX (بناء فشل — عدم تطابق تواقيع): CaseDetailView بيستخدم
            // امضاء مبسّط (caseId, party, isPrimaryParty, onAfterLink) بينما
            // handleOpenCreateClientForCaseParty من نوع OpenCreateClientForParty
            // (9 باراميترات مفصّلة) — بنلف هنا بدالة موائمة (adapter) بتفكّك
            // حقول party (CasePartyRow) لنفس ترتيب باراميترات OpenCreateClientForParty.
            onCreateAndLinkClientForParty: (caseId, party, isPrimaryParty, onAfterLink) =>
                handleOpenCreateClientForCaseParty(
                    party.id, caseId, isPrimaryParty, party.name, party.national_id,
                    party.power_of_attorney, party.address, undefined, onAfterLink,
                ),
            onNotify: sendTelegram, profile, country,
            // 🔒 FIX (تقرير الموثوقية — نتيجة 1): EditCaseModal ما كانش عنده
            // أي حماية دبل كليك خالص.
            savingCase,
            // ⚡ NEW (خطة تطوير أطراف الدعوى — مرحلة 4 خطوة 2): بتوصل لـ
            // EditCaseModal عشان زرار "إنشاء موكل جديد" جوه كارت أي طرف.
            openNewClientModal,
            // ⚡ NEW (خطة توحيد مصدر بيانات الموكل، مرحلة 2): نفس آلية
            // onOpenClient المستخدمة فوق في UniversalSearchModal — بنقفل
            // تفاصيل القضية الحالية ونفتح تفاصيل الموكل.
            onOpenClientProfile: (c) => { nav.closeModal('caseDetail'); setSelectedClient(c as MappedClient); setTab('clients'); },
        }),
    );
}

export default AppModals;
