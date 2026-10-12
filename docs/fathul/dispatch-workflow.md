# Dispatch workflow — implementation status

Updated: 2026-10-12. This is implementation evidence, not a claim of emergency-service readiness.

The full-feature goal remains active. Durable incident intake, staff workflow and realtime already exist; assignment alone does not record a recipient handoff. Dispatch is being added as a separate lifecycle following `docs/superpowers/plans/2026-10-12-sigap-dispatch-workflow.md`.

## Implemented and verified

- Migration `0008_dispatch_workflow.sql` creates separate intent, attempt and acknowledgement tables. It was applied to the local database; schema v8 has no pending migrations.
- Constraints enforce the local adapter/target, simulation marker, bounded outcomes and attempts, hashed idempotency keys, incident-region association, complete lease fields, ordered timestamps and attempt references.
- Shared staff/public contracts exclude citizen credentials, coordinates and provider response content.
- `LocalMockAdapter` classifies accepted, rejected, transient failure and unknown deterministically, without a network client. This does not send a report to any external service.
- Staff HTTP endpoints now create intents (`POST /api/staff/incidents/:id/dispatch`), list metadata (`GET /api/staff/dispatch`) and read attempts/acknowledgements (`GET /api/staff/dispatch/:id`). Active session, credential version, role and region are rechecked inside the transaction. A dispatcher sees owned incidents; a supervisor sees their scoped region. Creation requires ownership, an eligible incident status and no pending/accepted withdrawal.
- Create hashes the idempotency key and normalized payload. Concurrent identical retries return one stored intent; changed payload conflicts. Intent and creation audit commit together. List pagination retains PostgreSQL microsecond timestamp precision.
- The server starts a local dispatch coordinator. It leases work for 30 seconds, persists the attempt before invoking the adapter, processes at most ten attempts per batch, and fences stale completions. Confirmed transient failures retry after 1 then 2 seconds; three failures enter `dead_letter`. Rejection enters `manual_review`, and ambiguous/exception/timeout outcomes enter `unknown` without automatic retry.
- Expired sending leases become unknown with an audit record instead of sending again. Withdrawn or terminal incidents are cancelled before a new attempt. Attempt outcome, acknowledgement, intent state and audit commit together; dispatch never implicitly changes incident status.
- `POST /api/staff/dispatch/:id/review` requires a scoped supervisor capability and bounded reason. Unknown/manual-review items can be closed without fabricating delivery evidence. Only an unreviewed dead-letter can create one new linked intent; replay uses idempotency and records both creation and review atomically. Unknown cannot be replayed.
- `npm run test:dispatch-worker` passed real PostgreSQL concurrency, fencing, retry, expired-lease/restart, cancellation, exception, timeout, audit rollback and in-flight shutdown checks. `npm run test:dispatch-runtime` launched the actual server entrypoint twice in isolated child processes: automatic processing, SIGTERM exit and restart without duplicate accepted attempts passed.
- `npm run test:dispatch` passed against a newly created isolated synthetic PostgreSQL database, then removed it. Tests cover positive/negative database constraints, duplicate keys, region mismatch, persistence after pool recreation and the four adapter scenarios.
- `npx tsc --noEmit` and `npm run test:incident-workflow` passed after the added schema. The running HTTPS server returned `ready`, schema 8.

## Still required

1. Atomic dispatch realtime invalidation and citizen-safe projection.
2. Staff dispatch queue/actions, live refresh and UI verification.
3. Remaining full-lifecycle edge cases and operational monitoring for dispatch.
4. For real provider delivery: an operator-provided channel, recipient allowlist, acknowledgement contract, sandbox access and acceptance evidence.

The API queues intents and the running server processes them through the local adapter. Dispatch UI and citizen projection remain pending. The reporting UI continues to use the existing incident workflow.

## Execution ledger

Plan: `docs/superpowers/plans/2026-10-12-sigap-dispatch-workflow.md`.

- Task 1 in progress: schema/contracts verified; dispatch realtime invalidation is still pending.
- Task 3 local worker implemented and verified, including actual server process startup/shutdown and restart.
- Task 2 / Task 4 API operations implemented and verified through real HTTP, including supervisor review and idempotent linked replay. Atomic dispatch invalidation remains pending before the dispatch plan as a whole is complete.
- API red evidence: anonymous queue assertion failed with 404 rather than 401 before the route existed.
- API green evidence: isolated HTTP tests pass for session, role, ownership, concurrent replay, payload conflict, withdrawal, metadata redaction, audit rollback, cursor pagination, foreign-region and disabled-account access.
- Ruling: keep the small transactional create/read service inside `postgres-dispatch-repository.ts` for now. Route validation and repository checks are separate; add worker/review modules as lifecycle operations arrive.
- Red evidence: dispatch integration test failed with schema version 7 instead of required version 8 before migration existed.
- Green evidence: dispatch integration test passed after schema/contracts/adapter implementation; fixture explicitly supplies the existing pinned category/config fields.
- Ruling: this workspace has no Git repository, so implementation stays in the authorized project workspace and uses isolated synthetic databases for verification. No Git commit or worktree was created.
- Ruling: add the new realtime event when its transaction writer and publisher/client handling are implemented together; do not widen an unused event allowlist prematurely.
- Safety requirement for the upcoming worker: an expired sending lease may represent an already-issued handoff. Recovery must mark that outcome unknown for review, rather than blindly resending it.
- Worker red evidence: worker test failed because the coordinator module was absent. Review red evidence: the expected supervisor endpoint returned 404 before implementation.
- Worker/review green evidence: PostgreSQL lifecycle, HTTP review/replay, timeout and child-process runtime checks all passed. Failing review-audit insertion rolls back both original review fields and linked intent creation.
- Ruling: worker timing uses PostgreSQL timestamps as the authority rather than a caller-injected wall clock. Tests move due/expiry timestamps explicitly; this avoids clock skew and keeps next-attempt delays internally consistent.
