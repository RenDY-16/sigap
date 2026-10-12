# SIGAP Operator Workflow Implementation Plan

> **For agentic workers:** Implement this plan task by task in the current approved workspace. The primary workspace has no Git repository and project instructions prohibit initializing one. Do not create a repository, add or run tests, start PostgreSQL, apply migrations, or start a server/browser. Keep implementation in a scratch copy until review, then integrate selectively.

**Goal:** Replace the remaining demo-only incident handling with persisted, region-scoped dispatcher workflow, configurable staging responder/category/SOP data, ownership/withdrawal handling, and an Editorial-UI operations queue.

**Architecture:** PostgreSQL remains the source of truth. Domain services validate a fixed explicit transition matrix, role capability, current session and region in the same transaction as status, assignment, ownership, history, audit and outbox changes. Operational configuration is stored per synthetic region and managed by operator_admin; external dispatch stays disabled and units remain clearly simulated. The React dashboard uses the existing staff API/session flow and exposes only actions the server allows.

**Tech Stack:** React 19, TypeScript, Express 5, PostgreSQL (`pg`), Socket.IO, existing Editorial-UI styles/components.

**Spec:** `docs/fathul/PRD-sigap-operasional-draft.md` sections 4–9 and `docs/fathul/roadmap-sigap-operasional.md` Phase 3.

## Global Constraints

- Keep the service in synthetic `local-staging`; do not send data to real agencies/responders.
- `operator_admin` can manage operational config and staff but cannot work incidents; `auditor` is read-only; `dispatcher` can work incidents; `supervisor` can manage escalations.
- Enforce region scope and current staff session in every server read and mutation; never accept actor or region authority from the client.
- Keep citizen-facing status truthful: internal assignment is not external dispatch acknowledgement.
- Preserve status/audit history; withdrawal processing must not erase previous incident facts.
- Keep every non-landing page in EDITORIAL-UI, with loading, empty, error and keyboard-operable states.
- Preserve `frontend/.openai/hosting.json`, `frontend/worker/index.js`, `frontend/scripts/prepare-sites-build.mjs`, and `frontend/tests/sites-worker.test.mjs` byte-for-byte.
- Do not add/run tests, start PostgreSQL/app/browser, or introduce paid services. Run only TypeScript check and build.

## Review Focus

- Stale concurrent status/assignment/claim actions must return conflict and leave no partial audit/outbox writes.
- A staff member must not read or mutate an incident outside current region/session scope, including detail and realtime paths.
- Role-invalid and terminal-state actions must fail closed.
- Responder disabled/unavailable or wrong-region assignment must be rejected; historical assignment labels must remain understandable.
- Withdrawal request must be visible to dispatchers, have an audited outcome, and not falsely claim that tracking has been erased from retained audit/history.

---

### Task 1: Operational configuration and roster persistence

**Files:**
- Create: `frontend/src/server/db/migrations/0004_operator_workflow.sql`
- Create: `frontend/src/shared/operations.ts`
- Create: `frontend/src/server/operations/config-repository.ts`
- Modify: `frontend/src/server/db/migrate.ts` only if its migration loader requires explicit registration
- Modify: `frontend/src/shared/domain.ts`

**Interfaces:**
- Produce typed region configuration for service hours, public fallback copy/contact, incident categories and required fields, versioned SOPs, simulated responder roster, availability and coverage.
- Persist all records under an existing `regions.id`; seed only `local-staging` and synthetic units/categories/SOP with explicit simulated labels.

- [x] Add migration tables, constraints, version fields, indexes and foreign keys, without changing protected Sites files.
- [x] Add typed repository functions to load and transactionally replace/read config using caller-provided `PoolClient` and current region authorization.
- [x] Reject an enabled incident category without at least one SOP in that configuration snapshot; keep disabled-category history and past SOP/config versions readable.
- [x] Add a manual source review for migration rollback/data provenance and compatibility with existing `unit_id`, audit, and status tables.
- [x] Record migration as unexecuted; do not start PostgreSQL.

### Task 2: Incident lifecycle, ownership, assignment and withdrawal

**Files:**
- Modify: `frontend/src/server/db/migrations/0004_operator_workflow.sql`
- Modify: `frontend/src/server/store/postgres-incident-repository.ts`
- Modify: `frontend/src/server/store/incident-repository.ts`
- Modify: `frontend/src/server/services/incident-service.ts`
- Modify: `frontend/src/server/routes/staff-incidents.ts`
- Modify: `frontend/src/server/identity/staff-policy.ts`
- Modify: `frontend/src/shared/domain.ts`

**Interfaces:**
- Add repository/service actions for claim/release/takeover, transition with expected status + reason + SOP version, assignment to roster responder, and withdrawal accept/reject.
- Each write receives `StaffAccess`, reads authority from the persisted principal/session, checks capability and region under transaction locks, and writes status/audit/outbox atomically.

- [x] Add explicit server transition rules for acknowledge, triage, assignment, start-work, refer, delivery failure, escalation, supervisor takeover, and resolve; preserve terminal-state behavior.
- [x] Add optimistic expected-state checks and ownership conflict semantics; supervisor takeover requires `manage_escalations` and reason.
- [x] Replace hardcoded `DEMO_UNITS` assignment validation with active, available, region-scoped persisted simulated roster.
- [x] Add audited withdrawal decision outcomes that preserve the original request and append a lifecycle event.
- [x] Extend incident creation to resolve the active category snapshot transactionally, validate required answers server-side, and persist category ID, config version, and bounded JSON answers on the incident; retain the legacy `category` column for old rows and migration compatibility.
- [x] Include category ID/answers in request-payload digest so idempotent retries cannot silently alter intake data.
- [x] Ensure all event/public projections use generic `staff`; never expose internal staff IDs/session data to citizens.

### Task 3: Operational configuration APIs and server-filtered queue

**Files:**
- Modify: `frontend/src/server/routes/staff-incidents.ts`
- Modify: `frontend/src/server/store/postgres-incident-repository.ts`
- Modify: `frontend/src/server/identity/staff-policy.ts`
- Modify: `frontend/src/domain/demoService.ts`
- Modify: `frontend/src/server/app.ts` only if route wiring needs it

**Interfaces:**
- Add operator_admin-only, region-scoped configuration read/update endpoints with validation/version conflict handling.
- Add a sanitized public operations-configuration endpoint for service hours, fallback copy/contact, and enabled category/required-field definitions; never include SOP, responder, staff, audit or database IDs.
- Add bounded, paginated queue filters for status, age range, owner and withdrawal-pending; reject malformed or oversized parameters.

- [x] Validate all config fields, required-field definitions, service-hour ranges, contact copy, responder capability/coverage and immutable version history server-side.
- [x] Parse public config and incident answer bodies from `unknown`; enforce length/count/type bounds and reject disabled/unknown categories or answer fields not defined by the pinned config version.
- [x] Revalidate operator_admin/session/current region in the same transaction as update and audit old/new version metadata.
- [x] Filter and paginate incident lists in SQL; include owner, age and pending-withdrawal information without widening scope.
- [x] Keep outward citizen responses free of private roster or operator details.

### Task 4: Editorial-UI operations experience

**Files:**
- Modify: `frontend/src/components/StaffDashboard.tsx`
- Create: `frontend/src/components/IncidentDetailPanel.tsx`
- Create: `frontend/src/components/OperationsSettingsPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/domain/demoService.ts`
- Modify: `frontend/src/styles.css`

**Interfaces:**
- Queue consumes the typed paginated queue API; detail panel consumes scoped incident detail and exposes actions returned/allowed by role.
- Settings page consumes versioned configuration endpoints and is available to operator_admin only.

- [x] Add searchable status/age/owner/withdrawal filters and pagination while keeping authorization on the server.
- [x] Update citizen report intake to load the safe public config and render category-defined required fields with accessible unavailable/out-of-hours fallback. Pin the selected category config version in the created incident and preserve the same payload/key across retries.
- [x] Add incident detail timeline with SOP/version, reasons, owner, simulated responder and explicit internal-only assignment language.
- [x] Add claim/release/takeover, status transitions, withdrawal decision and responder selection with confirmation for consequential actions.
- [x] Add responsive map-failure fallback showing coordinates/address fallback text, status and identifiers needed for operations.
- [x] Add operator settings sections for hours/fallback, categories/required fields, SOP versions and simulated roster/availability/coverage.
- [x] Provide accessible loading/empty/error/retry/conflict states and keyboard operation; follow Editorial-UI outside landing.

### Task 5: Documentation, review and verification

**Files:**
- Modify: `docs/fathul/roadmap-sigap-operasional.md`
- Modify: `docs/fathul/PRD-sigap-operasional-draft.md`
- Modify: `docs/fathul/implementation-plan.md`
- Modify: `frontend/docs/fathul/run-demo.md`

- [x] Document migration/config seeding, role behavior, staging-only responders, transition semantics, withdrawal handling and operator startup.
- [x] Record external decisions still unresolved and explicitly state that internal assignment is not emergency dispatch.
- [x] Run `npx tsc --noEmit` and `npm run build`; record exact outcomes and bundle warning.
- [x] Compare protected file hashes to baseline; integrate reviewed scratch source selectively.
- [x] Record that no tests, database, migrations, server or browser were run.

## Completion record — 3 October 2026

Tasks 1–4 are integrated in `frontend/src/` and the source plan/docs are updated. Independent source review found and repaired terminal-withdrawal closure, select-option normalization, public responder identity exposure, staff realtime DTO downgrade, socket first-connect catch-up, locked draft recovery on definite config-version conflict, required boolean `false`, optional empty select, and out-of-hours UI gating. Review of the final repairs found no open source finding. `npx tsc --noEmit` and `npm run build` both passed in the primary workspace; the main JavaScript bundle is about 1.62 MB and triggers the Vite chunk-size warning. Protected Sites files and migrations 0001–0003 match baseline. Migration 0004 remains unapplied. No tests, database, server, HTTP/Socket.IO, browser, backup/restore, or operator/citizen runtime walkthrough was run. This completes source implementation for Phase 3 only; provider integration, privacy lifecycle/anti-abuse, reliability/deployment, external policy/contract decisions, and readiness approval remain open.
