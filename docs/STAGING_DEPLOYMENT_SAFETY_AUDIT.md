# Staging deployment safety blockers — 29 October 2026

## Scope

Only local safety code/tests and Vercel environment records scoped to `target=[preview]`, `gitBranch=staging` were changed. No commits, pushes, deployment, payments, shipments, real communication sends, template submissions, rule activation or schedule changes are authorized or performed.

Existing local changes are preserved on the `staging` branch. The broader WhatsApp patch and restored staging source are pre-existing work, not changes introduced by this safety repair. Shopify, pricing, Razorpay, payment and renewal code are untouched by this repair.

## Environment audit

The effective email allowlist originally contained one entry in a staging-specific Preview record. The effective phone allowlist contained one entry inherited from a shared Preview record.

The staging email record is now empty. A new **staging-specific empty phone override** shadows the shared Preview record. The shared inherited phone entry was read back and confirmed unchanged, preserving other environments.

All settings below were read back from records explicitly scoped to Preview/staging:

| Setting | Expected |
| --- | --- |
| COMMUNICATION_ALLOWED_TEST_EMAILS | empty, zero entries |
| COMMUNICATION_ALLOWED_TEST_PHONES | empty, zero entries |
| COMMUNICATION_DRY_RUN | true |
| COMMUNICATION_PROVIDER_MUTATIONS_ENABLED | false |
| COMMUNICATION_STAGING_TEST_ENABLED | false |
| SHIPROCKET_API_ENABLED | false |

No Production record was edited. No credentials were rotated or copied into source/reports.

**Existing deployments are immutable snapshots. These environment changes apply to a future deployment; they do not rewrite the running old Preview. No deployment was performed.** The old runtime must not be described as protected by the new code/settings until a separately authorized deployment and health check.

## Code safeguards

- `lib/communications/sendSafety.ts` makes explicit dry-run an unconditional send block. Inconsistent staging identity/settings also fail closed.
- `sendProvider` blocks email, WhatsApp, SMS and Lemlist before credentials, rendering or network access. The direct legacy WhatsApp client has the same boundary.
- Canonical deliveries and OTP deliveries record DRY_RUN before making provider attempts when the environment dry-run flag is true. Neither allowlists nor historical dedicated email-test authorization can override that environment block. Legacy non-staging unset/false flag semantics are preserved.
- Brevo's shared client blocks mutating requests during dry-run, including contact updates that can launch automations; read-only GET/HEAD operations remain available. Existing lead-path suppression remains.
- Shiprocket checks `SHIPROCKET_API_ENABLED` before serviceability, order creation, request/auth setup, cached bearer-token reuse and the final post-auth request. `false` returns normalized `SHIPPING_UNAVAILABLE` without provider network. Preview also defaults closed unless explicitly true.
- Production's normal live behavior with communication dry-run unset/false and Shiprocket flag unset/true is covered using mocked HTTP. Explicit true dry-run now intentionally suppresses sends in every environment. Explicit false Shiprocket always disables it. No Production configuration or deployment changed.
- No mocked serviceability results, fabricated shipments or synthetic fulfilment were added to application code. Mocks are confined to tests.

## Verification

New zero-network tests cover direct provider boundaries, allowlist bypass, OTP channels, template-mutation rejection, all Shiprocket operations, missing credentials, cached tokens, disabling between authentication and final request, and mocked Production compatibility.

Existing tests that previously expected allowlisted real sends during dry-run were updated to the new requested policy. Provider rejection, timeout and consent behavior still run in controlled mocked live-mode fixtures rather than losing that coverage.

Fresh verification: `npm test` passed **44 files / 303 tests**; `npm run typecheck` passed; `npm run build` passed using the dummy-credential verification wrapper. `git diff --check` passed with only the repository's existing LF/CRLF notices. Lint remains unconfigured from the earlier repository state.

Independent review caught an unintended change to non-staging Production unset-flag allowlist semantics. It was reproduced with failing tests, restored to the previous behavior and included in the successful final run. The new unconditional gate applies to explicit environment dry-run and inconsistent staging configuration; it does not silently change legacy Production unset/false semantics.

## Next boundary

This task ends with reviewed local code and saved staging-only next-deployment settings. It does not authorize commit, push or deployment. A future authorized deployment must recheck these settings, use the staging Supabase project, keep all automation inactive and perform read-only health checks before any separately authorized provider test.
