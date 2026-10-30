# Welcome #18 signup connection — staging design

Date: 27 October 2026 (IST)
Status: approved by the user on 27 October 2026; implemented and verified locally. See the implementation ledger for staging evidence.

## Scope
Connect the existing completed `/api/lead` signup to a real customer, EMAIL/MARKETING consent, and one durable `lead.completed` Welcome event. Work only on staging. Do not activate rules/templates, dispatch queues, send emails, backfill historical leads, or change production. The nine rules and canonical template versions stay DRAFT.

## Approach
Use the existing Supabase customer/preference/outbox engine with one transactional server-only bridge. A direct Brevo send is unsuitable because it bypasses the engine and durable duplicate protection; browser-side customer/event creation is unsuitable because identity and consent must be checked on the server.

This is the proposed implementation of the lead bridge already described in `../step1/REVIEW.md`. It is a connection, not a sending rollout.

## Data flow
1. Preserve the existing validated signup and lead-save response.
2. For the intended staging environment only, invoke the bridge after a successful completed signup save; pass a persisted lead identifier, never a browser-provided customer identifier.
3. Inside one database transaction, reload/lock the persisted lead and verify server-written completion state, email consent and recorded consent evidence. The current route writes authoritative completion to `metadata.lead_stage` while falling back when a `stage` column is absent; do not treat the separate `lead_stage` column's default as completion evidence.
4. Resolve normalized email/phone to a single real customer. Conflicting identities stop the bridge. Reuse an exact compatible customer without overwriting commerce contact details or Razorpay fields. Create a customer only if no compatible identity exists. Protect concurrent attempts with database locks and uniqueness constraints.
5. Persist the lead-to-customer association and consent evidence. Create EMAIL/MARKETING permission only when consent is recorded; an existing opt-out always wins. Do not create WhatsApp/SMS permission.
6. Record one durable logical Welcome intent/event per customer and welcome purpose. Store separate customer_id and lead_id. Retries/concurrent completions return the existing intent instead of producing another event; the key does not depend on rule version.
7. Keep the event separate from immediate sending. The rule/template mapping already identifies Brevo #18, but rule activation and dispatch remain a later reviewed step. Record this pending state visibly rather than claiming an email was sent.
8. In the staging-owned path, skip the legacy direct welcome sender even if the bridge fails. Preserve existing response fields with truthful integration status/warnings; never fall back to a direct email send.

## Prerequisite: no-send safety
The strict staging email-suppression patch exists locally in `../safety-fix/source` but is not deployed. Integrate and verify this prerequisite before enabling the bridge remotely. Cover direct welcome, Brevo contact/list sync, template tests and engine provider boundaries, including allowlisted destinations. Do not run the old pending SEND job or a broad queue dispatcher.

## Boundaries
- This step targets the completed two-step `/api/lead` flow. `/api/launch-signup` is a separate waitlist path with different completion and consent semantics; do not silently treat it as the same event.
- No checkout/payment/pricing/fulfilment behavior changes.
- Add an ordered migration, RLS on new tables, no browser-role access and service-role-only function execution.
- Keep infrastructure configuration, credentials, other eight rules and Brevo templates unchanged.
- The dashboard crash patch remains a separate local change and must not be silently bundled.

## Verification
Use actual local database functions and mocked external provider boundaries. Verify eligible completion, incomplete/no-consent signup, existing opt-out, same identity, conflicting identity, retry, concurrent completion, rollback on event failure, unchanged commerce identity, and zero provider calls. Confirm server-generated context defeats client metadata overrides. Run focused tests, typecheck, full tests and build; review the complete diff before staging application. Verify deployed function/grants and synthetic staging connection inside an explicitly rolled-back transaction without dispatching anything.

## Rollback
Disable only the staging bridge entry point; retain no-send protection and durable deduplication/audit records. Revert only this task's application commit and narrowly scoped migration objects with a reviewed compensating migration. Do not delete customer, consent or shared outbox history.

## Approval checkpoint
Approve this staging-only design before product code, migration or deployment work. No approval to send emails or activate automation is requested by this document.
