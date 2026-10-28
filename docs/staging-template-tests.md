# Restricted staging template tests

This change reuses Communications > Templates > Queue a template test. It does not enable the nine real automation rules, ordinary EMAIL, OTP or Lemlist sending in staging. Production branch/database/sending settings are outside this rollout.

## Default off

No real recipient has been approved and no email send is authorized by this implementation rollout. Keep COMMUNICATION_STAGING_TEST_ENABLED unset or false. All existing no-email checks remain the default. Do not turn COMMUNICATION_DRY_RUN off.

For a later explicitly authorized test only, server-side Preview variables scoped to Git branch staging must include:

- COMMUNICATION_STAGING_TEST_ENABLED=true
- COMMUNICATION_STAGING_TEST_EMAIL: one exact approved inbox, also present in COMMUNICATION_ALLOWED_TEST_EMAILS
- COMMUNICATION_STAGING_TEST_VERSION_ID: the active EMAIL DIRECT_CONTENT version belonging to logical key EMAIL_QSTASH_INTEGRATION_TEST
- COMMUNICATION_STAGING_TEST_EXPIRES_AT: an ISO timestamp no more than thirty minutes ahead

VERCEL_ENV=preview, branch staging, staging database jwsivyxapfnyaafdcdos, COMMUNICATION_BASE_URL=https://staging.uppermost.store and COMMUNICATION_DRY_RUN=true must all match. Missing/wrong settings fail closed. No request-body field can supply these settings or override the safeguard.

## Queue and provider boundaries

The existing admin-only, same-origin TEST_TEMPLATE action requires a request UUID in staging. New service-only comm_queue_template_test_once checks the server-owned ADMIN membership, atomically records idempotency and queues through the legacy function. It records actor, request and the server-selected test window on the customerless test message. A duplicate actor/request returns the same delivery; changing its payload/window conflicts. Failed transactions roll back both intent and idempotency state. The legacy queue function and non-staging API behavior remain unchanged.

The existing form disables concurrent submission and retains the same request UUID for the same version/recipient across retries and repeated clicks. A fresh page load starts a new intent; deliberate new requests are not a global send limit. Provider calls for a single delivery retain the existing atomic claim/reservation behavior; ambiguous outcomes are not blindly retried.

The delivery worker requires an audited customerless test message, the same still-valid test window, the dedicated active EMAIL version and DIRECT_CONTENT mapping. It issues a private in-process authorization bound to version/recipient/window. The provider boundary validates that authorization and rechecks all switch/expiry settings. Legacy tests and tests queued while off cannot acquire an authorization later merely by enabling a new window. All normal lifecycle mail remains blocked even while testing is enabled.

## Stop and rollback

Set the staging-only enable variable to false and redeploy Preview to apply the setting; expiry is also checked at both sending boundaries. Configuration changes do not unsend an email already accepted by the provider. Reload the test form for a deliberately new approved test window rather than retrying a request from a different window.

For code rollback, restore this patch's source paths from staging base ea9282218742bf0fad85f71cccda42a08b6f55a5 in a new staging commit. The additive service-only RPC may remain unused; do not delete audit/idempotency/message/delivery records or restore completed deliveries to pending. Do not modify main or production. Keep all nine real rules DRAFT throughout testing.
