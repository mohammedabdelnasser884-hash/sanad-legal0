# Sanad — Product Reliability & Data Integrity Audit (Phase 1)

**Scope note:** The codebase has ~288 files. Every finding below was verified by reading the actual source — nothing here is guessed. Given the size of the full request (11 issue areas × a proactive search of the whole app), this is Phase 1: the client/case duplicate-prevention core, the standalone-session workflow, and double-submit protection. It surfaces one critical contradiction and several concrete gaps. Recommend continuing file-by-file into sessions/multi-party/UI text validation next, same as our usual workflow.

---

## Executive Summary

The duplicate-prevention system for **clients** is real, centralized, and reasonably well built (`clientValidation.ts`) — but it has two structural gaps: the name check only requires **two** name parts (not three, as required), and it's **not backed by a database constraint**, so it cannot fully prevent duplicates under concurrent submissions.

The duplicate-prevention system for **cases** — described in your brief as "Solved" — **does not exist in the code**. `handleSaveCase` in `useCaseActions.ts` inserts a case with no query against existing `case_number_official` values, and `NewCaseModal.tsx` has no client-side check either. This is the most important finding in this pass: it directly contradicts what's assumed already fixed, so it changes the priority order.

Double-click protection at the UI layer (`disabled: saving/loading` on submit buttons) is present and consistent everywhere sampled — client, case, and standalone session creation all correctly disable their buttons mid-request. But this only stops a second click on the *same* button; it does not stop two browser tabs, a second device, or a network retry from both passing the "not a duplicate" check before either has inserted.

---

## Findings

### 1. Case-number duplicate check is missing, not "solved"
- **Severity:** Critical
- **Files:** `src/features/cases/hooks/useCaseActions.ts` (`handleSaveCase`, lines 108–175), `src/features/cases/NewCaseModal.tsx`
- **Root cause:** `handleSaveCase` builds the case payload and calls `window.__dbWrite({ type: 'INSERT', table: 'cases', ... })` directly. There is no lookup of `case_number_official` beforehand, and no `UNIQUE` constraint on that column in any migration under `database/migrations/`.
- **Risk:** Two identical case numbers can be created today, from the normal "add case" flow — not just from an edge case.
- **Recommended fix:** Add a `checkCaseNumberDuplicate()` function mirroring `checkClientDuplicate()` in `clientValidation.ts` (same file, or a sibling `caseValidation.ts`), called before `__dbWrite` in both `handleSaveCase` and `handleUpdateCase`. Follow up with a partial `UNIQUE` index on `(tenant_id, case_number_official)` where the value isn't null, so the DB is the real backstop (see finding 3).

### 2. Client name duplicate check requires 2 parts, not 3
- **Severity:** Medium
- **File:** `src/shared/lib/clientValidation.ts`, `validateFullNameParts()` (lines 16–22)
- **Root cause:** `parts.length < 2` — accepts any two-word name ("محمد أحمد").
- **Good news:** this is the *only* place this rule lives — it's already shared across client creation, standalone session, and in-case client creation, per the file's own header comment. Fixing it here fixes it everywhere in one change.
- **Recommended fix:** Change to `parts.length < 3` and update the Arabic message. Then audit callers of this function to confirm none silently swallow the return value (I did not trace every call site in Phase 1 — flagging for Phase 2).

### 3. Duplicate checks are TOCTOU-vulnerable — no DB-level backstop
- **Severity:** High
- **Files:** `clientValidation.ts` (`checkClientDuplicate`), all migrations under `database/migrations/`
- **Root cause:** `checkClientDuplicate` does a `SELECT ... .or(...)` then the caller does a separate `INSERT`. Nothing makes those atomic. I grepped every migration for `UNIQUE` and found none scoped to `clients.national_id`, `clients.full_name`, or `cases.case_number_official`.
- **Risk:** Two near-simultaneous submissions (two tabs, two staff members, a retried request after a slow response) can both pass the check and both insert. The UI's `disabled: saving` guard (finding 5) doesn't help here because it only guards one button in one tab.
- **Recommended fix:** Add partial unique indexes, e.g. `CREATE UNIQUE INDEX ON clients (tenant_id, national_id) WHERE national_id IS NOT NULL AND deleted_at IS NULL;`, and catch the resulting Postgres unique-violation error in the write path to show the same "already exists" message the app-level check shows today. This makes the app-level check a UX nicety and the DB the actual guarantee — which is the right layering for a legal system of record.

### 4. National ID is optional in the standalone-session plaintiff/defendant fields
- **Severity:** Medium
- **File:** `src/features/calendar/NewStandaloneSessionModal.tsx`, `handleSave` (lines 158–165)
- **Root cause:** `if (form.plaintiff_national_id && form.plaintiff_national_id.length !== 14)` — only validates *format* if a value is present; never requires one. This is inconsistent with `NewClientModal.tsx`, where national ID is `required: true` and blocked on empty (line 168).
- **Risk:** A standalone session can produce a plaintiff/defendant with no national ID, and if later turned into a client via "Add client only" / "Create case from this," the duplicate check loses its strongest signal (name-only matching is weaker than ID matching).
- **Recommended fix:** Decide intentionally: either make it required here too (consistent with the client form), or explicitly document why standalone-session parties are held to a lower bar (e.g., they're often not yet the firm's own client). I'd default to requiring it, since issue 6 in your brief already asks for mandatory full names in every person-creating form — the same logic should extend to the ID.

### 5. Double-click / rapid-click protection — verified present where sampled
- **Severity:** N/A (confirms existing protection, not a bug)
- **Files checked:** `NewStandaloneSessionModal.tsx` (`disabled: saving`), `NewCaseModal.tsx` (`disabled: loading`), `NewClientModal.tsx` (`disabled: loading`)
- All three set their `saving`/`loading` state synchronously before the `await window.__dbWrite(...)` call and disable the submit button off that same state, with `finally { setSaving(false) }`. This is the correct pattern and it's applied consistently in the three creation flows I read closely.
- **Not yet verified:** Fee, Document, Reminder, Task, Library, Notes, Office, and User creation flows (issue 4 in your brief lists these explicitly) — Phase 2.

### 6. Offline write path is more mature than the brief assumes
- **File:** `src/lib/offlineQueue.ts`, `window.__dbWrite` (lines 752–863)
- Worth noting since it changes how I'd prioritize issue 5 in your brief: this already handles optimistic locking on updates (`knownUpdatedAt` conflict detection), distinguishes "online but request failed" from "actually offline," queues to IndexedDB with user-visible banners, and has an explicit fix for a case where offline-created records need to resolve temp IDs before dependent writes sync. It's not naive. If you're seeing a specific offline bug in the field, it'd help to know the exact repro rather than treat this as a green-field gap — I'd rather verify a real report than invent hypothetical ones here.

---

## Not Yet Covered (Phase 2 candidates)

To keep this pass grounded in things I actually read rather than a generated checklist, I stopped here. Still open from your original list:
- Multi-opponent/multi-client schema and every downstream surface (DB, UI, reports, printing, search, filters, AI assistant) — this is a large schema change, worth its own session.
- Court field free-text conversion and a pass over other predefined-selection fields.
- Full-name validation on opponent/witness/lawyer forms (only client-side confirmed so far).
- Documentation office name field width/charset.
- Standalone-session-to-client relationship display consistency.
- Create-button audit for Fee/Document/Reminder/Task/Library/Notes/Office/User.

## Suggested Priority Order
1. **Critical:** Add case-number duplicate check (finding 1) — this is a live gap, not a hardening exercise.
2. **High:** DB-level unique indexes for client national ID and case number (finding 3).
3. **Medium:** Three-part name rule (finding 2) — one-line fix, single source of truth.
4. **Medium:** Decide and enforce national ID policy in standalone sessions (finding 4).
5. Then move to Phase 2 areas above, same one-file-at-a-time approval flow we've used before.

Want me to start with finding 1 (case-number duplicate check) now, or work through Phase 2's file list first?
