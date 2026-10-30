# Staging deployment and one-message approval plan

30 October 2026. **PROPOSED; NOT EXECUTED; NOT AUTHORIZATION.**
Target only `staging`, `jwsivyxapfnyaafdcdos`, `https://staging.uppermost.store`.
Production deployments, database, sender settings and schedules are excluded.

## Proposed gate

Reuse the canonical workflow intent, delivery, outbox and callbacks. A direct
Meta script would skip the path under test; an environment allowlist alone cannot
enforce one message across retries/concurrent workers. Use a service-only durable
authorization record with a globally unique test request key and an atomic budget.

Bind one authorization to: staging project/base/branch/Preview identity, deploying
build, operator/approval reference, exact normalized consenting recipient, customer,
order, shipment, authenticated synthetic event ID, ORDER_SHIPPED rule ID/version,
intent, delivery, template version/provider ID/name/language/UTILITY category and
body parameter digest, sender/WABA/app, and an absolute expiry at most 15 minutes
from issuance. Do not store plaintext secrets or phone data in provider notes/logs;
use protected server storage and a keyed recipient fingerprint for audit binding.

Fail closed for any missing/mismatched binding, missing affirmative WhatsApp
test opt-in, STOP/withdrawal, cancellation/return, unpaid or cross-customer order,
stale event, wrong rule/version/template, changed order/name/recipient, expired
window, inactive rule, stale approval or historical DRAFT intent. Recheck these
immediately before atomic consumption and provider invocation.

In one database transaction, lock the exact authorization and canonical delivery,
require unused budget, and irreversibly reserve the single provider attempt.
Only the worker holding that reservation may invoke the existing Meta sender.
Persist acceptance/callback correlation through the existing delivery ledger.
Every retry, including 429/5xx, timeout, process crash and persistence failure,
must leave the authorization consumed and require manual reconciliation. No
fallback channel, alternate recipient, second template or automatic resend.
Exactly-once receipt cannot be guaranteed across an external network; this gate
guarantees at most one application send attempt per authorization.

**Current code must keep the unconditional dry-run block.** A later, separately
approved implementation must introduce a narrow reviewed authorization capability
at BOTH delivery and provider boundaries, covering only this reserved delivery.
Keep global dry-run true and every other path blocked. Also decouple only that
authorized workflow from the current forced `p_dry:true` run semantics without
enabling generic scheduled/event campaigns. Do not turn global dry-run false:
current staging boundary validation would then be inconsistent and disable the
specialized workflow path. An unscoped flag is not an acceptable implementation.

The authorization table/RPC, RLS/revokes, reservation mechanism and regression tests
are future staging-only changes requiring an ordered migration. They are not
implemented or applied by this readiness task. General phone allowlists remain
empty; the dedicated capability must not authorize legacy, OTP or email sends.

## Approval A: stage the reviewed build, still no sends

1. Review the dirty workspace and scope a staging-only commit/deployment. Resolve
   independent review findings; run focused tests, full tests, typecheck and safe
   build. Confirm the desired staging domain alias and Preview environment.
2. Approve exact pending migration(s), including seven-workflow schema and any
   gate migration, against the staging project only. Check recorded migration
   history first; do not replay already applied migrations or blindly use a bulk
   push. Verify service-only table/RPC privileges and RLS after application.
3. Run the reviewed DRAFT preparation only. Keep every communication rule DRAFT
   and dry-run true. Deploy the compatible scoped staging build.
4. Inspect staging-scoped environment presence without printing values. Verify
   Meta token validity/expiry/app ID and `whatsapp_business_messaging` plus
   `whatsapp_business_management` access to the exact WABA; inspect app mode,
   sender registration/verification, permitted test recipient restrictions,
   subscribed app and actual callback/override destinations. An unavailable
   check blocks progression. Do not change webhook settings under this approval.
5. Read actual Meta templates. Bind exact APPROVED UTILITY name/language/body
   mapping. If absent, stop; template submission needs separate approval.
6. Read QStash schedules and signing configuration. Require exact POST dispatcher
   destination `https://staging.uppermost.store/api/internal/cron/communications`,
   no Production destination, matching current/next keys and no Vercel protection
   redirect. Verify signed consumer reachability at
   `/api/internal/communications/consume`. Keep unrelated schedules untouched.
   Schedule creation/unpausing requires explicit inclusion in approval; one
   authenticated manual dispatcher wake-up is sufficient for a first test.
7. Prepare one clearly marked synthetic staging order and local shipment. Staging
   currently has no order. Seed a reviewed fixture graph, never invoke Razorpay or
   Shiprocket, never borrow/alter a real customer's order or invent live capture
   evidence. Bind approved recipient ownership and synthetic settlement evidence;
   ensure synthetic fixtures cannot enter fulfilment/renewal workers. Validate the
   existing captured-evidence predicate against that clearly marked fixture.
8. Rehearse in disposable/local fixtures first. Existing executable rehearsal:
   `npm test -- tests/communications/whatsapp-workflows.test.ts -t "ingests one authenticated synthetic shipment"`.
   It uses an invalid secret then valid fixture secret and duplicate event, with
   real fetch forbidden and DRAFT result blocked. Its provider IDs and payment
   facts are local synthetic fixtures, not proof of actual provider settlement.

## Synthetic event contract for the later staging rehearsal

No staging event was posted in this task. After the fixture is reviewed, use
server-side stored secret in `x-api-key`, never in the URL or pasted into chat.
POST to `https://staging.uppermost.store/api/webhooks/carrier-events`:

```json
{
  "shipment_id": "<exact marked fixture provider_shipment_id>",
  "event_id": "<unique approved test UUID>:order-shipped",
  "current_status": "shipped",
  "event_time": "<current approved UTC timestamp>"
}
```

Resolve the shipment identifier from the known owned fixture; reject placeholders
or another shipment. Keep the body/event ID identical for duplicate replay.
No address, credential or phone goes in the payload. This records an existing
local shipment milestone and makes no Shiprocket call. If sent while DRAFT it
must remain blocked forever. Use a NEW explicitly approved fixture/event for the
later active test; never reset a blocked intent to make it sendable.

## Approval B: exactly one bounded real message

Required approval identifies the full bindings above, recipient and explicit
WhatsApp consent, exact rendered content, sender, 15-minute UTC window, one rule,
one event, one delivery and maximum **one provider attempt**, plus rollback owner.
Do not request broad approval to activate all rules or disable dry-run.

1. Reverify Approval A evidence; install and test the reviewed durable gate while
   dry-run remains unconditional. Negative tests must cover wrong environment,
   recipient/rule/template/order, duplicate/concurrent workers, expired window,
   STOP, cancel/return, DRAFT history and every retry/ambiguous crash boundary.
2. Only under explicit real-send approval enable the narrow capability and activate
   the exact shipped rule/template with a cutoff before the NEW synthetic event.
   Preserve other DRAFT rules, global dry-run and empty general allowlists.
3. Issue the exact authorization; ingest the one authenticated event. Trace one
   intent → run → recipient → delivery → SEND outbox → signed QStash consume →
   atomic reservation → Meta accepted ID. Record counts at every boundary.
4. Observe signed sent/delivered callback correlation; read is optional. Replay
   the same synthetic event and duplicate/out-of-order callbacks; expect no second
   provider attempt or state regression. Do not reset the consumed gate.
5. Revoke/expire authorization immediately, pause the dedicated rule and any test
   schedule. Confirm dry-run true, no unused authorization and no pending eligible
   send. Retain all evidence. On uncertainty halt and reconcile; never resend.

Success requires exactly one accepted Meta message ID, exactly one matching
delivered record and receipt on the approved phone, with zero other attempts.
Any identity/configuration mismatch, uncertain outcome or budget >1 is a stop.
Rollback is the non-destructive halt procedure in the readiness report.
