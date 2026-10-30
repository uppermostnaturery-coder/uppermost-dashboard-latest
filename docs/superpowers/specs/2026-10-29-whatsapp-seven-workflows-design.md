# Seven WhatsApp workflows: staging implementation design

Status: proposed; application implementation has not started for this request.

## Scope and constraints

Complete the seven requested workflows on `staging`, using Supabase project
`jwsivyxapfnyaafdcdos`. Reuse the communications engine, canonical messages,
deliveries, outbox, QStash transport, Meta artifacts and callback reconciliation.
Do not alter prices, checkout, payment/mandate state transitions, email campaigns,
Shopify or renewal scheduling. Framer continues to own storefront UI.

No commit, push, deployment, rule/template activation, Meta submission, message,
payment, shipment creation, schedule creation or Production mutation is authorized.
Keep explicit dry-run unconditional, staging allowlists empty, Shiprocket disabled
and provider template mutations disabled. No new endpoint may accept a browser's
claim that a payment or shipment succeeded.

## Audit evidence collected on 29 October 2026

- Staging has 18 rules, all DRAFT. WhatsApp content versions are DRAFT.
- Welcome has stored provider status APPROVED/language `en`; this is not fresh
  verification of Meta approval. Other business WhatsApp artifacts are DRAFT/`en`.
- The existing shipment draft combines shipped/transit/out-for-delivery; a distinct
  out-for-delivery rule/template is missing.
- `private.capture_communication_event` captures order, attempt and shipment facts
  in the durable outbox with unique source keys. Projection is receipt-idempotent.
- Runs are event/version-idempotent, but scheduled runs create distinct messages;
  this does not guarantee one recovery per cart episode across schedule ticks.
- Audience conditions use customer-wide latest payment/shipment projections;
  they cannot by themselves authorize a message for the exact event's order.
- Delivery permission rechecks marketing consent and projected conversion. Durable
  cancellation, exact episode identity and authoritative purchase rechecks need
  strengthening for cart recovery.
- Shipment webhook authenticates before persistence, but uses substring status
  matching, persists tracking separately from shipment/message state, and does not
  check the shipment update error. Duplicate early exit can strand partial work.
- QStash has signed consumers, bounded publication and retries. Remote schedule,
  protection access and actual Framer identity/consent binding are not yet verified.

## Approaches

1. Extend the existing engine (requested approach): add narrowly scoped workflow
   intents and guards; retain the existing canonical delivery ledger and transport.
2. Encode everything as customer-feature rules: smaller patch, but cannot establish
   exact event identity, persistent cancellation or cross-run business deduplication.
3. Create a separate WhatsApp sender: duplicates retry/audit infrastructure and
   creates another provider boundary. Excluded by the architecture-reuse requirement.

Approach 1 is proposed; choices below are implementation proposals, not claims
of previously approved business policy.

## Event and eligibility contracts

| Workflow | Authoritative subject and once-only key | Eligibility/recheck |
|---|---|---|
| Welcome | Existing normalized-phone welcome intent | Persisted completed signup, explicit WhatsApp marketing consent, no STOP/withdrawal |
| Cart recovery | Customer + persisted cart episode | Positive cart, 1–24h inactivity using existing timing, marketing consent, no corresponding/newer purchase, same episode still current |
| Payment failed | Exact local payment attempt | Correlated verified provider failure, owned order, no successful settlement or newer active/successful retry making it obsolete |
| Order confirmed | Exact order | Verified captured settlement, matching order/amount/currency, confirmed order |
| Order shipped | Exact shipment + SHIPPED milestone | Authenticated, correlated tracking evidence for a paid order; explicit supported status map |
| Out for delivery | Exact shipment + OUT_FOR_DELIVERY milestone | Authenticated courier transition, paid order, no later delivered/terminal state |
| Order delivered | Exact shipment + DELIVERED milestone | Authenticated explicit delivered status; no substring interpretation of undelivered/RTO-delivered as customer delivery |

Marketing permission is mandatory for welcome/cart. Transactional messages honor
explicit transactional denial under existing preference semantics. Preserve existing
STOP scope; document it instead of inventing a consent policy change. Missing or
conflicting evidence fails closed. Payment records are not modified to make a
message eligible. No historical message backfill occurs automatically.

## Durable execution

Retain welcome's existing specialized intent and deduplication. For the other
workflows, use narrowly scoped intent records with a unique `(workflow, subject)`
key, authoritative source IDs, cancellation reason and canonical run/delivery links.
This is eligibility/orchestration state, not a second message/delivery ledger.
Insert/recover intents transactionally, with finite dispatch batches. DRAFT rules
may leave intents waiting but cannot queue provider deliveries. No implicit replay
of old outbox history on activation.

Revalidate owned source rows at intent dispatch and immediately before the provider
boundary. Link exact order/shipment/attempt facts to the canonical message and
delivery; never substitute the customer's latest unrelated event. Unique intent
and canonical delivery correlation must survive concurrency, rule versions,
schedule ticks and QStash redelivery. Cancellation is terminal; retries do not
create replacement intents for an already completed/canceled subject.

Activation cutoff proposal: no catch-up. An intent captured while its rule is DRAFT
is audit-only and cannot become dispatchable merely because the rule is activated.
Dispatch requires a source occurrence at or after the explicit activation cutoff,
plus fresh eligibility and bounded workflow expiry. Welcome/cart expire after the
existing 24-hour recovery window; obsolete payment/shipment milestones are always
suppressed. Pre-activation and expired intents remain recorded with the reason.
Historical replay requires a separately authorized operation and is not implemented
or run here. This resolves the independent builder review's stale-intent question.

Purchase/consent withdrawal/STOP cancel pending cart recovery and suppress queued
canonical deliveries before sending. Identify cart episodes from server-persisted
behavior, not client totals or unverified arbitrary customer IDs. If the current
analytics binding cannot prove identity, keep that path ineligible and report the
required Framer binding as an E2E blocker rather than trusting it.

Preserve bounded definite-failure retries and reconciliation-pending treatment of
uncertain provider outcomes. Never retry an ambiguous real send blindly. Preserve
canonical acceptance and authenticated delivered/read callbacks.

Fix shipment ingestion with a transactionally idempotent, authenticated-evidence
boundary: validate/correlate identifiers, persist event and monotonic milestone
state together, and allow safe recovery after failures. Delayed earlier milestones
cannot regress state or queue obsolete messages. Unknown/cancellation/return
statuses do not masquerade as shipment/delivery success. No outbound Shiprocket
call is needed. Keep raw provider evidence private.

## Drafts, schema, tests and rollout boundary

Use ordered additive migrations; new tables have RLS and no anon/authenticated
access; RPCs are service-only with fixed search paths. Generate migrations with
the CLI. Validate first in disposable PostgreSQL/PGlite. Apply only reviewed
additive changes to the named staging project, never Production. Prepare missing
templates and rules idempotently as DRAFT with `next_run_at=null`; do not overwrite
active or immutable artifacts. Language `en` and copy are draft proposals; exact
Meta name/language/content approval is an external prerequisite.

Write failing tests first for each workflow: one valid intent, duplicate/concurrent
events, cross-customer correlation rejection, missing/invalid payment evidence,
shipment authentication and out-of-order milestones, purchase/withdrawal/STOP,
repeat scheduling, retries/ambiguous outcomes and draft-only behavior. Use controlled
database/provider seams and a fail-fast network mock. Retain existing commerce and
safety regression coverage. Run fresh `npm test`, `npm run typecheck`, and the
dummy-credential wrapper for `npm run build`.

Handoff must include per-workflow PASS/FAIL evidence, changed-file inventory,
migration status, approval/language requirements, QStash/Framer prerequisites and
remaining controlled E2E blockers. Deployment readiness means local implementation
and staging schema/drafts are verified; it does not mean provider delivery is proven.
Remote schedules, credentials and Meta approval remain UNVERIFIED unless inspected
read-only. No real E2E send is authorized.

Rollback: stop dedicated staging dispatch, retain dry-run and disabled provider
flags, revert only this application patch. Preserve additive intent/audit/consent
history and migrations; do not delete STOP records, reset delivered messages or
reverse payment/shipment records. Existing uncommitted work remains untouched.
