# Dormant WhatsApp E2E gate — local implementation handoff

30 October 2026. Branch `staging`, HEAD
`0cd4aa140603dcd702f706049bb82c160fd02c06`, unchanged. **Dormant local
implementation complete; NOT READY for a real send or deployment.**

No remote database access/writes, migration application, Production access,
commit/push, Vercel deployment, Meta/QStash mutation, rule activation, real message,
payment or shipment occurred in this implementation phase. Existing uncommitted
work was retained. Only dependency-registry/documentation reads used the network.

## Exact task scope

- New `lib/communications/whatsappE2EGate.ts`: typed service adapter; derives exact
  environment/build/app/WABA/sender context from server environment; validates
  identifiers/expiry; sanitizes RPC failures and never retries reservations.
- New `supabase/migrations/20261030065048_dormant_whatsapp_e2e_gate.sql`:
  CLI-generated ordered migration, tested only in disposable PGlite databases.
- New `tests/communications/whatsapp-e2e-gate-database.test.ts` and
  `tests/communications/whatsapp-e2e-gate.test.ts`: 81 focused regression cases.
- New `eslint.config.mjs`; modified `package.json`/`package-lock.json`: pinned
  `eslint@9.39.5`, `eslint-config-next@15.5.25`, `@eslint/eslintrc@3.3.7`;
  `npm run lint` now executes `eslint .`. Core Web Vitals/TypeScript rules enabled.
  No source rules disabled; generated outputs and local scratch are ignored.
- New implementation ledger `docs/superpowers/plans/2026-10-30-dormant-whatsapp-gate.md`
  and this report. Exact task-only patch: `docs/diffs/2026-10-30-dormant-whatsapp-e2e.patch`.

The patch compares package files against pre-task working copies, not HEAD, so it
excludes earlier uncommitted edits. Baselines remain under
`.codex/dormant-gate-before/`. All pre-existing locked package versions are
unchanged; npm also reordered lock metadata while adding lint dependencies.

## Database contract and safety

`communication_whatsapp_e2e_authorizations` stores a protected authoritative JSON
binding, approval/ADMIN/consent references, unique delivery/intent/shipment,
absolute creation/expiry times, revocation and an irreversible 0-or-1 attempt.
RLS enabled; PUBLIC/anon/authenticated have no access. Service-role inherited
ALL grants are explicitly revoked before granting SELECT/INSERT/UPDATE only.
Immutable triggers forbid rebinding, extending expiry, resetting spent/revoked
state, deletion and truncation. No destructive down migration is supplied.

Service-only RPCs:

```text
comm_authorize_whatsapp_e2e(
  p_delivery_id uuid, p_context jsonb, p_approval_ref uuid,
  p_approved_by uuid, p_consent_id uuid, p_expires_at timestamptz) -> uuid
comm_reserve_whatsapp_e2e(p_id uuid, p_context jsonb) -> boolean
comm_revoke_whatsapp_e2e(p_id uuid) -> void
```

Issuance resolves bindings from existing canonical rows. It requires exactly the
shipped workflow, active approved rule/template, Meta UTILITY artifact, exact
ordered `[name, order_number]` parameters, captured-payment evidence and a marked
synthetic order/tracking event. It cannot activate a rule or fabricate payment
evidence. Names must already match JavaScript trim semantics; empty/untrimmed
names fail closed rather than binding a different provider parameter.

Consent requires an allowed current WHATSAPP/TRANSACTIONAL preference plus an
immutable history record with source `EXPLICIT_E2E_TEST`, exact approval reference
and exact normalized `recipient`. An active ADMIN membership is required. Payment,
marketing consent or an allowlist alone does not suffice. STOP is independently
checked using the existing durable phone opt-out table.

The full binding includes environment/build/app/WABA/sender, canonical recipient,
order/shipment/event/intent, message/run/recipient linkage, rule/version, template
and provider artifact snapshots, consent evidence and exact rendered parameters.
Expiry is absolute and at most 15 minutes. Replayed issuance returns the original
record without renewing its expiry, revocation or budget. The same approval,
delivery, intent or shipment cannot mint a second record.

Reservation locks the authorization, shares the STOP phone advisory lock, locks
intent before delivery and obtains nonblocking source locks. It requires a fresh
SENDING delivery lease, no previous attempt/provider ID, identical binding and
current permissions. Payment eligibility is evaluated after payment locks and
workflow permission is repeated after source locks. Busy/changed/expired work
denies reservation. Exactly one caller can change attempt_count from 0 to 1.
Consumption commits independently before a future external provider attempt;
no result/failure/reset operation can refund that budget. A lost RPC response is
an uncertain consumed budget and must never trigger automatic retry.

The database trusts service infrastructure to assert deployment context. The
adapter derives context from server variables, not request data. A future issuer
must authenticate the approving operator before invoking this service-only API.
The stored binding contains protected recipient/consent data; never log or expose it.

## Dormancy is unconditional

No existing sender, dispatcher, delivery worker, webhook, financial module or API
contract was changed. No application entry point imports the gate adapter. There
is no enable flag, provider callback, send-capability token or real-send bypass.
Existing `COMMUNICATION_DRY_RUN=true` enforcement, forced dry workflow dispatch,
provider-mutation block and allowlist behavior remain intact. A test proves that
even a successful mocked reservation cannot make `sendProvider` bypass dry-run.

Runtime binding additionally requires `WHATSAPP_APP_ID` and
`COMMUNICATION_E2E_REVIEWED_BUILD_SHA`, matching `VERCEL_GIT_COMMIT_SHA`; existing
WABA/sender variables and all staging Preview/database/base/branch values must
match. No local or hosted environment values were changed.

This phase proves a durable one-attempt reservation mechanism, not a functioning
live send path. A future separately approved integration must consume the budget
at the exact provider boundary, bind the actual outbound payload, prevent all
automatic attempt retries and preserve canonical acceptance/callback logging.
It must not interpret a prior stored consumed record as a reusable capability.

## Verification results

| Check | Result |
|---|---|
| Focused gate tests | PASS: 81 cases / 2 files |
| `npm test` | PASS: 430 tests / 48 files, exit 0 |
| `npm run typecheck` | PASS: exit 0 |
| ESLint on all three new gate TypeScript files | PASS: exit 0 |
| `npm run lint` | FAIL: 84 existing errors, 47 warnings; unattended command works |
| `npm run build` via existing dummy-credential wrapper | FAIL: compilation succeeds, then existing application lint errors stop build |
| `git diff --check` | PASS: existing LF/CRLF notices only |
| Independent review | All Important findings addressed; no remaining Important defect identified |

Regression coverage includes default deny, runtime/build/provider identity,
concurrent callers, replay, duplicate issuance, absolute expiry, revocation,
immutable reset/delete/truncate, Supabase-like inherited privileges, actual
service/anon/authenticated role execution, consent withdrawal/STOP, cancelled/
returned/RTO shipments, altered recipient/message/run/order/payment/intent,
template/language/parameters, DRAFT history and irreversible consumption after
simulated timeout, rejection, 5xx, unknown or crash outcomes. Provider fetches are
forbidden. PGlite serializes database commands; Promise.all tests concurrent
application callers, not a multi-session hosted Postgres stress test.

Lint errors: 81 `no-explicit-any`, 2 `no-require-imports`, 1 `prefer-const`.
Warnings: 44 unused variables, one image rule, one anonymous default export and
one unused disable. Build examples: `lib/commerce/checkout.ts:245`,
`lib/commerce/payments/service.ts:40` and existing app/components. These files
were not modified. Full diagnostics remain in `.codex/dormant-gate-*-final.log`.
Dependency installation reported seven audit vulnerabilities; no audit-fix or
unrelated package upgrade was performed. This is not a fresh security audit.

## Migration dependencies and remaining blockers

The new migration follows `20261029133013_whatsapp_seven_workflows.sql`, which
depends on the existing commerce/communications engine and
`20261029113628_whatsapp_staging_welcome.sql`. The operational path also requires
`20261028122916_confirm_delivery_acceptance.sql`. Apply neither migration under
this authorization. Reconcile the previously documented staging signup-bridge
history timestamp discrepancy before any future targeted migration application.

Remaining blockers: existing lint/build failures; unapplied workflow and gate
migrations; gate not integrated into a live sender; no verified approved shipped
Utility template; Meta/QStash runtime settings and webhook isolation unverified;
no staged isolated test fixture or explicit recipient/send authorization. Earlier
readiness facts were not refreshed through any remote access during this phase.

## Rollback and stop

For this local-only phase, remove only the added task files and restore package
files from `.codex/dormant-gate-before/`; review the exact patch first and preserve
any subsequent edits. Restore dependencies to that saved lock if needed. Never
reset the entire dirty checkout. There is no remote rollback action now.

If separately deployed later: retain dry-run; stop the dedicated test worker,
revoke the exact authorization, pause only its rule/schedule, and retain all
consent, authorization, intent, delivery and provider evidence. Keep additive
schema, never refund consumption or reset blocked work, and reconcile uncertain
provider outcomes before any new approval. No remote action is authorized here.

STOP: local implementation and verification finished. Await the user's next
approval; no commit, migration application, deployment or real-send enablement.
