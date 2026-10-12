# SIGAP Durable Incident Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace SIGAP's process-memory incident lifecycle with a persistent, auditable staging core that survives restarts and keeps citizen, dispatcher, and realtime views consistent.

**Architecture:** Express remains the authority for incident validation and state transitions. A single PostgreSQL pool stores incidents, the latest consented location, status history, audit events, idempotency digests, and a transactional outbox; Socket.IO publishes committed outbox events, while reconnects always fetch a fresh database snapshot. This plan is the first bounded sub-project of the larger operational SIGAP program; it does not enable public emergency service or official dispatch.

**Tech Stack:** Existing Node.js 24 LTS, React 19, TypeScript, Express, Socket.IO, and Vite; PostgreSQL 18 (keep on a supported minor release); `pg` with one bounded connection pool; SQL migrations run by the application. PostgreSQL 18 is supported by the PostgreSQL project, and Node.js 24 is an LTS line. See [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/), [Node.js release schedule](https://nodejs.org/en/about/previous-releases), and [node-postgres pool guidance](https://node-postgres.com/features/pooling).

**Spec:** [Operational PRD](../../fathul/PRD-sigap-operasional-draft.md), [operational architecture](../../fathul/operational-architecture-draft.md). This phase implements persistent incident creation, location, state, audit, and realtime consistency only.

## Global Constraints

- The app remains clearly labeled staging/demo and uses synthetic incident data until operational owner, territory, SOP, responder, privacy, security, reliability, and support sign-offs exist.
- Dispatch to official responders is outside this phase; do not invent or imply responder acknowledgements.
- A citizen withdrawal request immediately stops the browser from sending new locations; the server rejects late location updates after it records the request.
- Keep only the latest location in the incident record in this phase; do not create a route history or put coordinates in the general audit trail.
- Citizen credentials remain secret digests in storage and are never written to logs, query strings, referrers, analytics, or error responses.
- The client creates and stores a separate high-entropy citizen access token and idempotency key before submitting; retries reuse both and the same payload. Server storage contains digests only. Reusing an idempotency key with a different payload returns `409`.
- PostgreSQL failure must prevent a success response; the server must not fall back silently to process memory.
- Use PostgreSQL 18 on a supported minor release and Node.js 24 LTS; do not add a paid database/hosting service in this phase.
- Preserve `frontend/.openai/hosting.json`, `frontend/worker/index.js`, `frontend/scripts/prepare-sites-build.mjs`, and `frontend/tests/sites-worker.test.mjs`.
- This workspace has no Git repository; do not initialize one or invent commit steps.

## Review Focus

- Concurrent retries of the same idempotency token cannot create duplicate incidents; same token with a different payload remains a conflict.
- A withdrawal request stops live tracking immediately, and a location update already queued in the browser cannot overwrite the final accepted location.
- When a location update and withdrawal race, whichever obtains the incident row lock first commits first; once withdrawal commits, every later location update is rejected. A location committed before withdrawal is the final accepted point.
- A database timeout or unavailable PostgreSQL cannot be represented to the citizen as a successfully stored incident.
- A crash after commit but before Socket.IO publish does not lose the state change; outbox processing publishes it after restart.
- A reconnecting citizen or dispatcher receives the latest authorized snapshot and cannot join another incident's socket room with an invalid token.

---

## File Map

- Modify `frontend/package.json` and `frontend/package-lock.json` to add PostgreSQL client and local database/migration scripts.
- Create `frontend/scripts/dev-database.mjs` to manage a local PostgreSQL 18 development container through Podman's CLI; do not require Compose because no Compose provider is installed in this workspace.
- Create `frontend/src/server/db/pool.ts` to own one bounded `pg.Pool`, report database readiness, and close it during graceful shutdown.
- Create `frontend/src/server/db/migrate.ts` and `frontend/src/server/db/migrations/0001_operational_core.sql` for ordered, checksummed, idempotent schema migrations.
- Create `frontend/src/server/store/incident-repository.ts` for the async repository contract and `frontend/src/server/store/postgres-incident-repository.ts` for PostgreSQL implementation.
- Delete `frontend/src/server/store/incident-store.ts` after all runtime call sites use the persistent repository.
- Modify `frontend/src/server/services/incident-service.ts` to use async persistence and transactional lifecycle operations.
- Create `frontend/src/server/services/outbox-publisher.ts` to publish committed event rows to Socket.IO and mark delivery attempts.
- Modify `frontend/src/server/app.ts`, `frontend/src/server/index.ts`, `frontend/src/server/config.ts`, `frontend/src/server/routes/citizen-incidents.ts`, `frontend/src/server/routes/staff-incidents.ts`, and `frontend/src/server/realtime/socket-server.ts` to use the database-backed services and explicit readiness.
- Modify `frontend/src/shared/domain.ts`, `frontend/src/shared/socket-events.ts`, `frontend/src/domain/demoService.ts`, and `frontend/src/App.tsx` to expose the operational status/event model while retaining the staging label.
- Modify `frontend/.env.example` if present, otherwise create it; document `DATABASE_URL` and mode-specific requirements without putting secrets in `VITE_*`.
- Do not edit the existing Sites worker, build preparation, or hosting configuration files listed in Global Constraints.

### Task 1: Add local PostgreSQL and migration lifecycle

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/package-lock.json`
- Create: `frontend/scripts/dev-database.mjs`
- Create: `frontend/src/server/db/pool.ts`
- Create: `frontend/src/server/db/migrate.ts`
- Create: `frontend/src/server/db/migrations/0001_operational_core.sql`
- Modify or create: `frontend/.env.example`
- Modify: `frontend/src/server/config.ts`
- Modify: `frontend/src/server/app.ts`
- Modify: `frontend/src/server/index.ts`

**Interfaces:**
- Produces `createDatabasePool(config: Pick<ServerConfig, "databaseUrl">): Pool` and `closeDatabasePool(pool: Pool): Promise<void>`.
- Produces `runMigrations(pool: Pool): Promise<{ applied: string[]; currentVersion: string }>`; migration rows are recorded in `schema_migrations` with a checksum, ordered by the numeric filename prefix, guarded by a PostgreSQL advisory lock, and applied in a transaction.
- Produces `IncidentStatus = "received" | "acknowledged" | "triaged" | "assigned" | "in_progress" | "referred" | "delivery_failed" | "escalation_pending" | "resolved"`.
- Produces `AuditActor = { kind: "citizen" | "staff" | "system"; staffId?: string }`; citizen/system actors never carry a staff ID.
- Produces `IncidentListFilter = { statuses?: IncidentStatus[]; createdAfter?: string; createdBefore?: string; limit: number; cursor?: string }`.
- Produces `IncidentChangeName = "incident:created" | "incident:location:updated" | "incident:status:updated" | "incident:withdrawal:requested"`.
- Produces `IncidentOutboxEvent = { id: string; event: IncidentChangeName; incident: PublicIncident; occurredAt: string }` and `OutboxWriter.enqueue(tx: PoolClient, event: IncidentOutboxEvent): Promise<void>`; writes are atomic with incident state. Socket.IO emits this safe envelope; `incident` remains the public DTO and never includes credentials or private digests.
- Produces `GET /api/readyz`, returning HTTP 200 only when the DB is reachable and migrations are current; retain `/api/healthz` as liveness only.
- Adds `DATABASE_URL` as a server-only setting. No database credential is exposed as a `VITE_*` variable.

- [ ] Add dependency `pg` and a single `pg.Pool` with finite `max`, `connectionTimeoutMillis`, and `idleTimeoutMillis`; set pool size through validated server configuration.
- [ ] Add `frontend/scripts/dev-database.mjs` with `up`, `status`, and `down` actions using `node:child_process.spawn` with an argument array (never shell interpolation); use a named Podman volume, synthetic local-only credentials, container health check, and loopback-only port binding. Do not delete the volume in `down`.
- [ ] Add npm scripts `db:up`, `db:container:status`, and `db:down`; `db:up` must wait for the container health check before reporting ready.
- [ ] Add migration runner scripts `db:migrate` and `db:status`; `db:status` reports schema version/readiness and must fail nonzero for checksum mismatch, missing earlier migration, database connection failure, or pending migration.
- [ ] Add initial migration tables: `schema_migrations`, `incidents`, `incident_status_events`, `audit_events`, and `outbox_events`; `incidents` stores only the latest location, client GPS fix time (`location_measured_at`, required when a GPS point exists and null for simulation/no point), server receive/update time (`location_updated_at`), and `withdrawal_requested_at`; `incident_status_events` stores actual status transitions; add indexes/unique constraints for public ID, access-token digest, idempotency digest, status/created time, and unpublished outbox rows.
- [ ] Store citizen access token and idempotency values only as cryptographic digests; include `payload_digest` for conflict detection. Store current latitude/longitude and location source/time on the incident, without a historical route table.
- [ ] Add graceful server shutdown that stops accepting HTTP/socket connections, drains the outbox publisher, then calls `pool.end()`.
- [ ] Manually verify `npm run db:up` makes the local database healthy, `npm run db:container:status` reports the container, a new database migrates to version 1, `npm run db:status` reports schema readiness, rerunning migration changes nothing, `npm run db:down` preserves the named volume, and tampering with an applied migration checksum fails clearly.
- [ ] Run `npm run build`; expected: build completes and the Sites output files remain present.

### Task 2: Move citizen incident CRUD and idempotency into PostgreSQL

**Files:**
- Create: `frontend/src/server/store/incident-repository.ts`
- Create: `frontend/src/server/store/postgres-incident-repository.ts`
- Modify: `frontend/src/server/services/incident-service.ts`
- Modify: `frontend/src/server/app.ts`
- Modify: `frontend/src/server/routes/citizen-incidents.ts`
- Modify: `frontend/src/server/config.ts`
- Modify: `frontend/src/domain/demoService.ts`

**Interfaces:**
- `IncidentRepository.create(input: CreateIncidentInput, accessTokenDigest: string, idempotencyDigest: string, payloadDigest: string): Promise<PublicIncident>`
- `IncidentRepository.getByCitizenTokenDigest(digest: string): Promise<PublicIncident | null>`
- `IncidentRepository.getById(id: string): Promise<IncidentRecord | null>`
- `IncidentRepository.listForStaff(filter: IncidentListFilter): Promise<PublicIncident[]>`
- `IncidentRepository.updateLocation(id: string, point: GeoPoint, source: LocationSource, updatedAt: string): Promise<PublicIncident>`
- `IncidentRepository.requestWithdrawal(id: string, requestedAt: string): Promise<PublicIncident>`
- `IncidentRepository.transition(id: string, expectedStatus: IncidentStatus, nextStatus: IncidentStatus, actor: AuditActor, reason: string | null): Promise<PublicIncident>` uses a conditional update so concurrent staff actions cannot both win.
- `IncidentOutboxEvent` and `OutboxWriter` are defined in Task 1; Task 4 implements the writer/publisher behavior.
- `IncidentServices.createIncident(input: CreateIncidentInput, accessToken: string, idempotencyKey: string): Promise<PublicIncident>`
- `IncidentServices.getIncidentForCitizen(token: string): Promise<PublicIncident>`
- `IncidentServices.updateIncidentLocation(token: string, point: GeoPoint, source: LocationSource): Promise<PublicIncident>`
- `IncidentServices.updateGpsLocation(incidentId: string, update: GpsLocationUpdate): Promise<PublicIncident>`
- `IncidentServices.requestWithdrawal(token: string): Promise<PublicIncident>`
- `IncidentServices.listIncidentsForStaff(filter: IncidentListFilter): Promise<PublicIncident[]>`
- `IncidentServices.setIncidentStatus(id: string, next: IncidentStatus, actor: AuditActor, reason: string | null): Promise<PublicIncident>`
- `IncidentServices.assignIncidentUnit(id: string, unitId: string, actor: AuditActor): Promise<PublicIncident>`; the unit remains explicitly demo-only until the responder-registry follow-on project.
- `createIncidentService(repository: IncidentRepository, outbox: OutboxWriter): IncidentServices`; all persistence-facing methods return `Promise`.

- [ ] Replace the synchronous process-local `IncidentStore` dependency in the default server path with the injected PostgreSQL repository; missing/unreachable PostgreSQL is a startup/readiness error, never an in-memory fallback.
- [ ] The browser generates and stores two independent cryptographically random values before submit: a citizen access token and an idempotency key. Retry reuses both; server persists separate digests and binds the idempotency digest to the access-token digest. Implement create in a transaction; enforce unique token and idempotency digests in PostgreSQL; on idempotency conflict load the prior result and return it only when both digests and `payload_digest` match, otherwise return `409 idempotency_conflict`. Ensure a lost response can be retried with the same access token, without returning a different credential.
- [ ] Persist incident record and initial `incident_status_events` row atomically; do not include credential digests in public DTOs or serialized outbox data.
- [ ] Implement authorized citizen lookup by token digest and staff list/detail reads; return the same not-found response for invalid and unknown citizen credentials.
- [ ] Convert Express route handlers and service calls to await database operations; map database unavailability to a clear retryable service error without leaking SQL, connection strings, or values.
- [ ] Manually verify create → restart server → retrieve with citizen token; verify two concurrent same-key/same-payload submits produce one incident ID and preserve access to it; verify same-key/different-payload returns HTTP 409; verify invalid token returns no incident details.
- [ ] Run `npm run build`; expected: TypeScript and client/server bundling complete.

### Task 3: Persist location, transitions, withdrawal, and audit atomically

**Files:**
- Modify: `frontend/src/shared/domain.ts`
- Modify: `frontend/src/shared/socket-events.ts`
- Modify: `frontend/src/server/store/postgres-incident-repository.ts`
- Modify: `frontend/src/server/services/incident-service.ts`
- Modify: `frontend/src/server/routes/citizen-incidents.ts`
- Modify: `frontend/src/server/routes/staff-incidents.ts`
- Modify: `frontend/src/domain/demoService.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- A citizen withdrawal is an append-only `withdrawal_requested` event plus `withdrawalRequestedAt`; it does not erase the incident or silently assert that an already-dispatched responder has stopped.
- `IncidentServices.requestWithdrawal(token: string): Promise<PublicIncident>` stops future location updates, stores a withdrawal audit/status-history event, and enqueues a realtime event in one transaction.
- `IncidentServices.updateLocation(token: string, point: GeoPoint, source: LocationSource): Promise<PublicIncident>` rejects if the incident is terminal or withdrawal has been requested.
- Staging transition edges are `received -> acknowledged -> triaged -> assigned -> in_progress -> resolved`, with `triaged -> referred`, `assigned -> referred`, `assigned -> delivery_failed`, `in_progress -> referred`, `delivery_failed -> escalation_pending`, and `escalation_pending -> assigned | referred`. `referred` and `resolved` are terminal in this first phase. This provisional matrix requires operator review before any pilot.
- `acknowledged` means a signed-in staging dispatcher recorded acknowledgement; it does not mean an external responder accepted the incident. `assigned` in this phase means a simulated staging unit was selected; it does not mean a real unit was dispatched.
- Source compatibility mapping for existing UI/demo fixtures only: `new -> received`, `verified -> triaged`, `unit_assigned -> assigned` (simulation label required), `completed -> resolved`. Legacy `cancelled` is represented as the prior operational status plus a pending `withdrawal_requested` event; do not convert it into an assertion that a cancellation was processed. There is no persistent production data migration in this phase because the current source store is process-memory only.

- [ ] Replace demo-only status literals in shared types and UI labels with the operational status model; keep explicit UI wording that the environment is staging until operational sign-off.
- [ ] Implement conditional, transactional transitions using only the staging matrix above and append status history/audit rows with actor and server timestamp; avoid storing precise coordinates in general audit payloads.
- [ ] Persist only the current location; validate coordinates/source and parseable GPS fix time server-side, preserve client measurement time separately from server receive/update time, reject a measurement more than 60 seconds in the future or older than the latest accepted measurement, and show the accepted fix age so a stale point is never presented as current. The future-skew and stale-display thresholds remain configurable/reviewable before pilot. Reject location updates after withdrawal has been recorded, including delayed requests. Both location update and withdrawal transactions lock the incident row (`SELECT ... FOR UPDATE`) before checking `withdrawal_requested_at`; this serializes the race. If location commits first, it is the final accepted point; if withdrawal commits first, the location update fails without changing it.
- [ ] Make the citizen UI stop `watchPosition` immediately on withdrawal request, show “tracking stopped; withdrawal request received — waiting for dispatcher”, and never auto-resume tracking after reconnect. Do not display “processed” in this phase because no dispatcher processing action exists yet.
- [ ] Preserve dispatcher work state when withdrawal is requested: the dashboard shows the request and last location timestamp; the dispatcher still follows the operation policy to close or continue the incident.
- [ ] Manually verify a transition survives restart, two concurrent updates produce one valid state transition, a withdrawal stops subsequent GPS writes, the row-lock race follows the rule above, and the last accepted point remains visible under the configured retention policy.
- [ ] Run `npm run build`; expected: build completes with no type errors.

### Task 4: Add transactional outbox and realtime recovery

**Files:**
- Create: `frontend/src/server/services/outbox-publisher.ts`
- Modify: `frontend/src/server/services/incident-service.ts`
- Modify: `frontend/src/server/realtime/socket-server.ts`
- Modify: `frontend/src/server/index.ts`
- Modify: `frontend/src/shared/socket-events.ts`
- Modify: `frontend/src/domain/demoService.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- `OutboxWriter.enqueue(tx: PoolClient, event: IncidentOutboxEvent): Promise<void>` writes event data in the same transaction as incident state.
- `OutboxPublisher.start(): void`, `OutboxPublisher.stop(): Promise<void>`, and `OutboxPublisher.publishPending(batchSize: number): Promise<number>` use row locking with `SKIP LOCKED`, bounded retry/backoff, and mark rows published only after the local Socket.IO publication succeeds.
- Socket.IO publishes `{ id, event, incident, occurredAt }`; the `incident` field is only `PublicIncident`. Citizen socket join validates the bearer token and gets one incident room; staff room authorization remains restricted to an authenticated staff session.

- [ ] Enqueue incident-created, location-updated, withdrawal-requested, and status-changed events transactionally with the corresponding row changes.
- [ ] Publish pending rows in bounded batches; retain failed rows and retry with capped backoff; log only event ID/type, error class, and attempt count.
- [ ] Include the stable outbox event ID in the realtime envelope and have clients ignore already-seen IDs within the active page session. Never expose internal digest or credential columns in that envelope.
- [ ] Keep HTTP snapshot reads authoritative on page load and every socket reconnect; never infer recovery from Socket.IO connection state alone.
- [ ] Manually verify commit→publish, process stop after DB commit before publish→restart→publish, duplicate publication, socket reconnect snapshot, and denied cross-incident room access.
- [ ] Run `npm run build`; expected: build completes and server/client shared event types agree.

### Task 5: Integrate operational core without claiming production readiness

**Files:**
- Modify: `frontend/src/server/app.ts`
- Modify: `frontend/src/server/config.ts`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/docs/fathul/run-demo.md`
- Modify: `docs/fathul/implementation-plan.md`
- Modify: `docs/fathul/PRD-sigap-operasional-draft.md`

- [ ] Remove copy that says incidents are lost on process restart only after the persistent path has been verified; retain prominent staging/no-real-dispatch labels until all production gates are separately signed off.
- [ ] Keep the existing demo-account route isolated and explicitly staging-only; do not present the shared demo credential as an operational operator account.
- [ ] Document local PostgreSQL startup, migration, synthetic data reset, backup/restore practice for staging, and shutdown in `run-demo.md` without claiming production deployment instructions.
- [ ] Add `/api/readyz` semantics to the operational docs; readiness failure must prevent the citizen client from reporting a submission as stored.
- [ ] Manually walk through citizen create/status/withdrawal and staff acknowledge/triage/assignment with the persistent store; verify restart behavior and clear database-outage UI.
- [ ] Run `npm run build` and inspect that `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` exist; expected: production bundle is emitted and protected Sites files remain unchanged.

## PRD Coverage for This Phase

| PRD requirement | Phase-1 coverage |
|---|---|
| FR-01 to FR-08 (citizen create, token access, location, status and withdrawal) | Tasks 2–4; citizen sees withdrawal as pending only. Operator processing and the “processed” state are in the workflow follow-on. Real-world copy/fallback remains gated on region/operator sign-off. |
| FR-09 to FR-10 (individual staff identity and scoped authorization) | Follow-on staff identity project; existing demo session remains staging-only in this phase. |
| FR-11 (persistent staff queue, filters, detail/map fallback) | Tasks 2 and 5; deep queue operations require the workflow follow-on. |
| FR-12 (acknowledge, triage, assignment and status changes) | Tasks 3 and 5 use staging units only; dispatch confirmation is not claimed. |
| FR-13 to FR-14 (supervisor escalation and configurable responder roster) | Follow-on operator configuration/workflow project. |
| FR-15 (audit trail) | Tasks 1 and 3 persist status/withdrawal audit records without duplicating precise location; administrative-access audit is part of staff identity/admin follow-on. |
| FR-16 (DB/realtime/channel failure) | Tasks 1, 4 and 5 cover DB/realtime; external channel failures belong to the responder-integration follow-on. |
| FR-17 (official responder adapter) | Separate responder-integration project, gated on authorized institution/channel and sandbox. |
| FR-18 (retention/deletion process) | Separate privacy/operations decision and implementation before any real data; this phase uses synthetic data only. |
| FR-19 (citizen notifications outside the app) | Not selected; decide provider, cost, consent and support before pilot. |
| FR-20 (environment separation) | This phase configures local/staging only; production separation is in the deployment/readiness follow-on. |

## Follow-on sub-projects required for the full operational goal

1. **Staff identity and authorization:** individual accounts, MFA, RBAC, persistent sessions, account lifecycle, region scoping, audited administrative reads/writes, abuse/rate controls, and account recovery. Provider choice and account recovery policy must be agreed before its separate plan.
2. **Operator configuration and service workflow:** region/service hours, categories, on-call roster, responder readiness, acknowledgement/escalation policy, explicit withdrawal-request processing/outcome, map-tile fallback, and operational dashboards. Values require the service owner/SOP.
3. **Responder integration:** implement a specific official channel only after the institution, authorized technical owner, sandbox, acknowledgement contract, credentials, and fallback procedure are provided.
4. **Production deployment/readiness and privacy operations:** hosting/provider, TLS, backups/restore, health/queue/latency observability and on-call alerting, SLO/RPO/RTO, abuse monitoring, threat/security review, synthetic-to-real environment separation, incident exercises, and pilot sign-off. Define and implement approved retention/deletion/anonymization and data-subject request procedures, privacy/access review, and a non-map coordinate fallback before real data. No paid provider is selected in this plan.

This phase makes the existing workflow durable and improves integrity but does not complete these follow-on sub-projects or make SIGAP an operating emergency service by itself. Keep the overall goal active until every applicable follow-on gate has been implemented and verified.
