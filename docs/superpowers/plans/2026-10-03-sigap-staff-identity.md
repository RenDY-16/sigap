# SIGAP Staff Identity and Authorization Plan

## Goal

Replace the shared demo login with individual staging staff accounts, durable/revocable database sessions, and server-enforced role and region scope across staff REST reads/writes and realtime incident broadcasts. Keep the service explicitly staging-only and provider-neutral; no external IdP or paid service is selected.

## Binding context

- Operational PRD: `docs/fathul/PRD-sigap-operasional-draft.md`.
- Roadmap: `docs/fathul/roadmap-sigap-operasional.md`.
- Prior phase: `docs/superpowers/plans/2026-10-03-sigap-durable-incident-core.md`.
- User selected Editorial-UI for every page except the 3D landing page.
- Existing workspace has no Git repository. Implement in `/tmp/sigap-sdd.5WOkmk/frontend`, compare/review, then selectively integrate.
- Do not add or run tests. Typecheck/build are permitted.
- Preserve `frontend/.openai/hosting.json`, `frontend/worker/index.js`, `frontend/scripts/prepare-sites-build.mjs`, and `frontend/tests/sites-worker.test.mjs` byte-for-byte.

## Security and policy rulings

- This implementation is a local/synthetic staging identity boundary, not production authentication. Keep copy/docs explicit that operational role matrix, organization, region taxonomy, MFA/IdP, recovery and provisioning owners require operator sign-off.
- Use four fixed provisional roles: `dispatcher`, `supervisor`, `operator_admin`, `auditor`. No public self-registration. Only an operator administrator may provision, disable, or reset credentials for individual accounts. Administrative writes are audited.
- Use a single synthetic region key `local-staging` until a real region is approved. All current staging incidents belong to it. Region scope is enforced in repository queries and socket recipients, not only in UI filters.
- Use Node's built-in asynchronous `scrypt` for staging password verifiers (random per-account salt; no plaintext persistence); make provisioning CLI-only for the first operator administrator and admin-only REST thereafter. Do not seed a shared credential or default password.
- Store express-session records in PostgreSQL, never MemoryStore. Use cookie `HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS is configured, absolute expiry, and session ID regeneration on login and credential/privilege changes. Account disable/revoke must invalidate REST and sockets.
- Session store hashes session IDs for all operations. `expires_at` is an immutable absolute expiry from issuance; `touch` never extends it. Revocation writes a tombstone/generation that prevents stale concurrent `set`/`touch` from resurrecting a deleted session. Credential/role/region changes, auth-version bump, revocation, and audit write share one transaction. Active principal is re-read from PostgreSQL for requests and realtime authorization.
- Outbox publish callbacks can run while the publisher holds the pool's only connection. Any database-backed recipient/session/region check on that callback must use the active publisher transaction client, or the publisher must claim then release its client before awaiting delivery. Keep fail-closed authorization and document a consistent account/incident lock order; never rely on pool size being greater than one.
- Preserve the global invariant that at least one active `operator_admin` exists after any administrative mutation. Serialize bootstrap and admin disable/demotion against that invariant with an advisory lock or serializable equivalent; perform account mutation, version bump/revocation, and audit atomically.
- Region comes from incident storage, including old outbox rows; never infer it from citizen input or public DTO. Scope-empty staff queries return no rows. Realtime compares active recipients' current region assignments against the incident's stored region and checks read capability, so auditor can receive permitted read events without workflow mutation rights.
- Audit policy covers staff list and realtime delivery of precise incident data as server-side access/delivery attempts, plus detail and all admin actions; do not treat delivery as proof a human read it. Keep the true staff actor server-side; citizen status-history and event projections use a generic staff label. Preserve legacy `staff-demo` events as a legacy actor instead of assigning them to the first new administrator.
- Fail closed on missing/disabled principal, invalid or expired session, unknown role, missing region, or database error. No fallback to global queue or memory.
- Use generic login errors and avoid logging usernames, passwords, session IDs, or request bodies.
- For a syntactically valid unknown username, perform a dummy scrypt verification with a fixed dummy salt/verifier so the response path does not plainly reveal account existence by skipping password work. Keep malformed identifiers bounded and generic. A persistent login-attempt throttle remains a required security follow-on before any non-synthetic use.
- Incident detail/precise-location reads and account/role/scope mutations add actor-linked audit records. Do not add precise coordinates to general audit payloads.

## Task 1 — Durable principals, sessions, and bootstrap

- Add migration `0002_staff_identity.sql`: staff accounts, role and region assignments, hashed-session store with immutable expiry/revocation generation, disabled/revoked state, and administrative audit events. Add `region_id` to incidents with `local-staging` for existing synthetic rows; leave historical `staff-demo` actor IDs as legacy values with no FK reassignment.
- Implement async scrypt hash/verify, validation for account identifiers/roles, repository functions, and a CLI-only first-admin bootstrap that prompts for credentials without echoing the password. Refuse overwrite/existing bootstrap admin; never print secrets.
- Replace MemoryStore with a PostgreSQL express-session Store; persist expiry and principal metadata; derive active session principal from DB and re-check account active/version.
- Add `region_id` to incident create config path with the fixed staging key; never accept region from anonymous citizen input.

## Task 2 — Scoped staff REST and account admin UI

- Replace demo login/session payload with authenticated principal `{id, username, displayName, role, regionIds}`.
- Apply capability checks and scoped list/detail/status/assignment access. Use route middleware plus repository constraints; detail must not leak existence across regions.
- Permissions: dispatcher can read and work incidents in assigned region(s); supervisor can read/work and manage escalations in assigned region(s); operator_admin can manage staff/scope and access incidents only for explicitly assigned region(s); auditor can read incident/audit data only for explicitly assigned region(s), never mutate workflow or manage accounts.
- Add operator-admin-only staff create/list/update-role-region/disable/re-enable/reset-password/revoke-sessions endpoints. Audit every action with the real staff actor. Prevent an administrator from disabling/demoting their own last active operator-admin account.
- Give auditor role a region-scoped view of both incident audit events and staff account/access audit actions. Store an explicit region key for administrative audit entries; never return password verifiers, credential values, session IDs, or raw session rows. Provide an Editorial-UI audit view for authorized auditors and administrators.
- Update Editorial-UI login, account identity/logout display, staff access management screen, and authorized audit view with loading/empty/error states. Do not expose credentials after creation/reset; use manual password input only.

## Task 3 — Realtime, revocation, and documentation

- Authenticate staff Socket.IO connections from durable sessions; resolve principal server-side and join region-specific rooms only. Broadcast each committed safe outbox incident envelope only to active sessions with current matching region assignment and read capability; a permitted auditor can receive read events. Disconnect on account disable/session revoke. Source incident region from PostgreSQL, including old outbox rows; never fall back to a global room.
- Update session/socket type contracts. Keep true individual staff attribution on server-side status/audit rows, project a generic staff label to citizen payloads, and preserve historical `staff-demo` records without reassigning them.
- Update `frontend/docs/fathul/run-demo.md`, `docs/fathul/implementation-plan.md`, `docs/fathul/PRD-sigap-operasional-draft.md`, and the operational roadmap with bootstrap use, role/scope limits, account lifecycle, tests not run, staging boundary, and open operator decisions.
- Run `npx tsc --noEmit` and `npm run build` in scratch. Review the complete source diff, protected-file hashes, and selectively integrate only approved files to primary. No tests or database lifecycle are run.

## Completion criteria

- Two different staff accounts can sign in independently; stored DB records contain only password verifiers and session payloads, not plaintext passwords.
- An unauthenticated, disabled, expired, revoked, or wrong-role principal receives no staff data or mutation capability.
- REST list/detail/workflow operations are scoped to assigned regions and fail closed; cross-region detail is indistinguishable from missing.
- Socket connections and incident broadcasts are scoped by current active principal/session; revoking a session/account disconnects access.
- Admin lifecycle actions identify the real actor and are audited; no public self-service privilege creation exists.
- Typecheck and build pass; protected Sites files are unchanged. PostgreSQL runtime and actual authentication flows remain unverified unless independently run later.
