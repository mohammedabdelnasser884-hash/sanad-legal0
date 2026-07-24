import React, { useState, useEffect, useCallback, useRef } from 'react';
/**
 * useNavigation — Simple & Predictable Back-Button Navigation
 * -----------------------------------------------------------
 * Logic:
 *   • Back while modal/detail is open  → close modal, stay on current tab
 *   • Back while on any tab (not dashboard) → go to dashboard
 *   • Back while on dashboard → do nothing (prevent app exit)
 *
 * Uses the History API with a two-entry stack:
 *   Entry 0: always "dashboard" (the anchor, never popped)
 *   Entry 1: current tab (pushed on every tab change)
 *
 * Modals do NOT push history — they are managed purely in React state.
 * The popstate handler decides what to do based on current React state.
 */


// ─── Types ──────────────────────────────────────────────────────────────────

export type TabName =
  | 'dashboard'
  | 'cases'
  | 'clients'
  | 'calendar'
  | 'fees'
  | 'reminders'
  | 'team'
  | 'documents'
  | 'admin';

export type ModalName =
  | 'search'
  | 'ai'
  | 'settings'
  | 'newCase'
  | 'newClient'
  | 'newLawyer'
  | 'newSession'
  | 'caseDetail'
  | 'clientDetail'
  | 'delete'
  | 'feeForm'
  | 'feeDetail'
  | 'feeSummary'
  | 'feeInvoice'
  | 'reminderForm'
  | 'reminderView'
  | 'reminderEdit'
  | 'sessionDetail'
  | 'docViewer'
  | 'docForm';

// ─── Constants ──────────────────────────────────────────────────────────────

const VALID_TABS: TabName[] = [
  'dashboard', 'cases', 'clients', 'calendar',
  'fees', 'reminders', 'team', 'documents', 'admin',
];

const TAB_PATHS: Record<TabName, string> = {
  dashboard:  '/',
  cases:      '/cases',
  clients:    '/clients',
  calendar:   '/calendar',
  fees:       '/fees',
  reminders:  '/reminders',
  team:       '/team',
  documents:  '/documents',
  admin:      '/admin',
};

const PATH_TABS: Record<string, TabName> = Object.fromEntries(
  Object.entries(TAB_PATHS).map(([tab, path]: [string, string]) => [path, tab as TabName])
);

const LS_TAB_KEY = 'nasser_nav_tab';

// ─── Nested modals (modal opened INSIDE an already-open top-level modal) ────
// ⚡ NEW (خطة "تطوير أطراف الدعوى" — مرحلة 4، 23 يوليو 2026): آلية عامة
// لأي "نموذج فرعي" بيتفتح جوه نموذج رئيسي مفتوح بالفعل (زي نموذج فرعي
// لطرف الدعوى جوه NewCaseModal). مشكلة زر الرجوع القديمة (قسم المرجع في
// تقرير خطة المسمى القانوني، بند هـ) كانت بتحصل لأن useNavigation فوق
// بيتتبع "مودال واحد بس" (activeModal)، فأي حالة محلية (useState) لنموذج
// فرعي جوه مودال مفتوح أصلاً مفيهاش أي حماية من زر الرجوع — ضغطة الرجوع
// كانت بتوصل لـ onPop تحت وهو مش عارف إن فيه نموذج فرعي مفتوح، فيقفل
// المودال الرئيسي كله (أو يتوه) بدل ما يقفل النموذج الفرعي بس.
//
// الحل: stack بسيط (خارج React state تمامًا، على مستوى الملف) بيسجل فيه
// أي نموذج فرعي نفسه وقت الفتح عن طريق registerNestedModal()، وonPop تحت
// بيفحص الـ stack ده **أول حاجة قبل أي منطق تاني** — لو فيه نموذج فرعي
// مسجل، يقفل هو بس (ويرجع)، من غير ما يوصل لمنطق قفل المودال الرئيسي.
// هي نفس الـ listener الواحد (onPop) اللي بيتسجل مرة واحدة في الأب، فمفيش
// أي مشكلة ترتيب تسجيل listeners بين مكونات مختلفة.
type NestedModalCloseFn = () => void;
const nestedModalStack: NestedModalCloseFn[] = [];

/**
 * يسجّل نموذج فرعي مفتوح حاليًا عشان زر الرجوع (الفعلي/فيزيائي) يقفله هو
 * بس، مش المودال الرئيسي اللي هو مفتوح جواه. الاستخدام (جوه useEffect):
 *
 *   useEffect(() => {
 *     if (!isOpen) return;
 *     return registerNestedModal(() => setIsOpen(false));
 *   }, [isOpen]);
 *
 * بيرجّع دالة "إلغاء تسجيل" — لازم تتنده وقت القفل اليدوي (زرار حفظ/إغلاق)
 * برضو (بترجع تلقائيًا من الـ useEffect cleanup فوق) عشان الـ stack وحالة
 * الـ history يفضلوا متزامنين حتى لو المستخدم قفل بزرار مش بزر الرجوع.
 */
export function registerNestedModal(onClose: NestedModalCloseFn): () => void {
  // ⚡ FIX (24 يوليو 2026 — باج إغلاق المودال الرئيسي بالغلط): بنسجّل
  // الحالة والمسار اللي كانوا موجودين *قبل* دفع الـentry بتاعة النموذج
  // الفرعي، عشان لو القفل حصل يدويًا (زرار حفظ/إغلاق) نقدر نرجعلهم
  // بـreplaceState من غير أي navigation فعلي — راجع تعليق الفانكشن تحت.
  const previousState = window.history.state as unknown;
  const previousUrl = window.location.pathname + window.location.search + window.location.hash;
  window.history.pushState({ type: 'nested' }, '', window.location.pathname);
  nestedModalStack.push(onClose);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    const idx = nestedModalStack.lastIndexOf(onClose);
    if (idx !== -1) nestedModalStack.splice(idx, 1);
    // لو الـ entry اللي إحنا ضفناها لسه هي الحالية (يعني ده قفل يدوي، مش
    // نتيجة إن المستخدم دعس رجوع بالفعل وonPop تحت هو اللي قفلنا) — بنرجّع
    // الحالة اللي كانت قبل الفتح بـreplaceState (مش history.back()).
    // ⚠️ history.back() بيطلق popstate حقيقي، وonPop الرئيسي وقتها بيلاقي
    // nestedModalStack فاضية بالفعل (لأنها اتشالت منها فوق) فيفترض غلط إن
    // ده رجوع للمودال الرئيسي نفسه ويقفله هو كمان — ده أصل الباج اللي كان
    // بيقفل مودال "تقييد قضية" كله لما نقفل كارت طرف بزرار "حفظ والعودة".
    // replaceState بيوازن الـstack من غير أي navigation ولا أي popstate.
    if ((window.history.state as { type?: string } | null)?.type === 'nested') {
      window.history.replaceState(previousState, '', previousUrl);
    }
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function tabFromUrl(): TabName | null {
  return PATH_TABS[window.location.pathname] ?? null;
}

function tabFromStorage(): TabName | null {
  const saved = localStorage.getItem(LS_TAB_KEY);
  if (saved && VALID_TABS.includes(saved as TabName)) return saved as TabName;
  return null;
}

function resolveInitialTab(): TabName {
  return tabFromUrl() ?? tabFromStorage() ?? 'dashboard';
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NavigationState {
  tab: TabName;
  activeModal: ModalName | null;
  showExitConfirm: boolean;
  confirmExit:   () => void;
  cancelExit:    () => void;
  navigateTo:    (tab: TabName) => void;
  openModal:     (modal: ModalName) => void;
  closeModal:    (modal: ModalName) => void;
  closeAllModals: () => void;
  isOpen:        (modal: ModalName) => boolean;
}

// ─── Hook ───────────────────────────────────────────────────────────────────

export function useNavigation(): NavigationState {
  const initialTab = resolveInitialTab();

  const [tab, setTabState]       = useState<TabName>(initialTab);
  const [activeModal, setModal]  = useState<ModalName | null>(null);
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // Refs for use inside event handlers (avoid stale closures)
  const tabRef         = useRef<TabName>(initialTab);
  const activeModalRef = useRef<ModalName | null>(null);
  const exitingRef     = useRef(false);

  // Keep refs in sync
  useEffect(() => { tabRef.current = tab; }, [tab]);
  useEffect(() => { activeModalRef.current = activeModal; }, [activeModal]);

  // ── Bootstrap ────────────────────────────────────────────────────────
  // Set up a two-entry history stack:
  //   [0] dashboard anchor  (replaceState — always the floor)
  //   [1] current tab       (pushState — only if not dashboard)
  useEffect(() => {
    const initial = resolveInitialTab();
    setTabState(initial);
    tabRef.current = initial;
    localStorage.setItem(LS_TAB_KEY, initial);

    // Entry 0: the dashboard anchor
    window.history.replaceState({ type: 'anchor' }, '', '/');

    // Entry 1: current tab (only if not dashboard)
    if (initial !== 'dashboard') {
      window.history.pushState(
        { type: 'tab', tab: initial },
        '',
        TAB_PATHS[initial]
      );
    }
  }, []);

  // ── popstate handler ─────────────────────────────────────────────────
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      // ── Case 0: a nested sub-modal is open → close IT only, and stop ──
      // (راجع تعريف nestedModalStack فوق) — لازم يتفحص قبل أي حاجة تانية،
      // عشان زر الرجوع وهو مودال رئيسي فاتح ونموذج فرعي جواه مفتوح كمان،
      // يقفل النموذج الفرعي بس ويسيب المودال الرئيسي زي ما هو.
      if (nestedModalStack.length > 0) {
        const closeFn = nestedModalStack.pop();
        closeFn?.();
        return;
      }

      const currentModal = activeModalRef.current;
      const currentTab   = tabRef.current;

      // ── Case 1: a modal is open → close it, stay on current tab ──
      if (currentModal) {
        setModal(null);
        activeModalRef.current = null;
        // Re-push the current tab entry so the stack stays intact
        window.history.pushState(
          { type: 'tab', tab: currentTab },
          '',
          TAB_PATHS[currentTab]
        );
        return;
      }

      const state = e.state as { type: string; tab?: TabName } | null;

      // ── Case 2: popped to the anchor (state.type === 'anchor') ──
      if (!state || state.type === 'anchor') {
        if (currentTab !== 'dashboard') {
          // Go to dashboard
          setTabState('dashboard');
          tabRef.current = 'dashboard';
          setModal(null);
          activeModalRef.current = null;
          localStorage.setItem(LS_TAB_KEY, 'dashboard');
          window.history.replaceState({ type: 'anchor' }, '', '/');
        } else {
          // Already on dashboard → show exit confirm dialog
          if (exitingRef.current) { exitingRef.current = false; return; }
          setShowExitConfirm(true);
        }
        return;
      }

      // ── Case 3: popped to a tab entry ──
      // This happens on forward navigation or multi-step back — sync state
      if (state.type === 'tab' && state.tab) {
        setTabState(state.tab);
        tabRef.current = state.tab;
        setModal(null);
        activeModalRef.current = null;
        localStorage.setItem(LS_TAB_KEY, state.tab);
      }
    };

    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // ── navigateTo ───────────────────────────────────────────────────────
  const navigateTo = useCallback((newTab: TabName) => {
    const currentTab   = tabRef.current;
    const currentModal = activeModalRef.current;

    if (newTab === currentTab && !currentModal) return; // no-op

    // Close any open modal silently
    if (currentModal) {
      setModal(null);
      activeModalRef.current = null;
    }

    setTabState(newTab);
    tabRef.current = newTab;
    localStorage.setItem(LS_TAB_KEY, newTab);

    if (newTab === 'dashboard') {
      // Going to dashboard → restore anchor, no extra entry
      window.history.replaceState({ type: 'anchor' }, '', '/');
    } else {
      // Push new tab on top of anchor
      // First ensure anchor is at bottom of our two-entry stack
      // by replacing current and pushing new, or just pushing new
      window.history.pushState(
        { type: 'tab', tab: newTab },
        '',
        TAB_PATHS[newTab]
      );
    }
  }, []);

  // ── openModal / closeModal ────────────────────────────────────────────
  // Modals are PURE React state — no history push.
  // Back button is intercepted in popstate before it pops anything.
  const openModal = useCallback((modal: ModalName) => {
    if (activeModalRef.current === modal) return;
    setModal(modal);
    activeModalRef.current = modal;
  }, []);

  const closeModal = useCallback((modal: ModalName) => {
    if (activeModalRef.current !== modal) return;
    setModal(null);
    activeModalRef.current = null;
  }, []);

  const closeAllModals = useCallback(() => {
    setModal(null);
    activeModalRef.current = null;
  }, []);

  const isOpen = useCallback(
    (modal: ModalName) => activeModal === modal,
    [activeModal]
  );

  // ── Exit confirm ─────────────────────────────────────────────────────
  const confirmExit = useCallback(() => {
    setShowExitConfirm(false);
    exitingRef.current = true;
    // Actually exit — go back past our anchor
    window.history.back();
    // Reset flag after short delay in case browser blocks exit (e.g. Android Chrome)
    setTimeout(() => { exitingRef.current = false; }, 500);
  }, []);

  const cancelExit = useCallback(() => {
    setShowExitConfirm(false);
    // Re-anchor so we can catch the next back press
    window.history.replaceState({ type: 'anchor' }, '', '/');
  }, []);

  return { tab, activeModal, showExitConfirm, confirmExit, cancelExit, navigateTo, openModal, closeModal, closeAllModals, isOpen };
}
