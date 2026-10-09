UPPERMOST® PRODUCTION V1
COMMUNICATION ENGINE + ANALYTICS IDENTITY + RULE ENGINE +
TEMPLATE MANAGEMENT + OFFERS MANAGEMENT

CONTINUATION AFTER PRELIMINARY CODEX AUDIT

Repository:
uppermostnaturery-coder/uppermost-dashboard-latest

Branch:
main

DATE CONTEXT:
7 October 2026

======================================================================
0. AUTHORIZATION TO CONTINUE
======================================================================

The preliminary audit correctly stopped because administrative authorization
was missing.

That decision is now resolved.

You are APPROVED to:

1. implement the minimal required admin-security prerequisite,
2. harden analytics ingestion,
3. implement visitor/session/customer identity linking,
4. continue the complete approved Communication Engine,
5. continue Rules / Templates / Providers / Communications Dashboard,
6. continue Offers Management,
7. add migrations, tests and documentation.

Do NOT stop again for the same admin-auth decision.

Only stop for:

- a genuine conflict with a frozen commerce/payment/pricing invariant,
- destructive production-data changes,
- an action that would send real customer communication,
- an action that creates/changes live external provider configuration
  requiring explicit approval,
- genuinely unavailable information that cannot safely be inferred.

Do NOT deploy automatically.

Do NOT send production communication.

======================================================================
1. FROZEN RESPONSIBILITY MODEL
======================================================================

Framer
= customer-facing commerce frontend

Google Tag Manager
= browser analytics/tag orchestration

Uppermost Custom Tracker
= first-party browser tracking + visitor/session identity

GA4
= Google analytics destination

Microsoft Clarity
= behavioral/session-replay destination

Next.js / Vercel
= server APIs + admin dashboard + communication execution

Supabase
= durable application/data source of truth

Razorpay
= payments/mandates

Shiprocket
= logistics

Brevo
= customer email

Meta WhatsApp Cloud API
= WhatsApp

MSG91
= SMS

Lemlist
= outbound lead/prospect nurture

Upstash QStash
= asynchronous HTTP delivery/retry transport

Do NOT introduce RabbitMQ.

Do NOT introduce a permanent worker server.

Do NOT move compute away from Vercel.

======================================================================
2. ABSOLUTE NON-BREAKING REQUIREMENT
======================================================================

Preserve:

POST /api/commerce/quote

POST /api/checkout/prepare

Razorpay APIs/webhooks

renewal cron

Shiprocket integrations

current pricing engine

current promotion evaluation

payment attempt architecture

subscription state machine

checkout idempotency

/api/lead public contract

existing Brevo integration

existing WhatsApp behavior until safely migrated

/api/checkout/prepare MUST CONTINUE WORKING.

The earlier phrase "checkout prepare should stop" was not an instruction
to decommission it.

Framer still uses this API.

Do NOT remove or rename it.

======================================================================
3. COMPLETE CURRENT AUDIT FIRST
======================================================================

Continue from:

docs/UPPERMOST_COMMUNICATION_AUDIT.md

Inspect the remaining required docs/code/migrations before mutation.

Especially inspect:

integration_outbox
integration_failures

Before creating another outbox.

Document:

schema
indexes
constraints
producers
consumers
retry semantics
idempotency
current usage

Prefer reuse if it fits cleanly.

Do NOT create redundant outbox systems just because the original
specification suggested communication_outbox.

======================================================================
4. ADMIN SECURITY — IMPLEMENT FIRST
======================================================================

Use Supabase Auth for dashboard operator authentication.

Create explicit server-owned authorization.

Suggested:

admin_memberships

user_id uuid
role
status
created_at
updated_at

V1 roles:

ADMIN
VIEWER

Do not build complex RBAC.

Do NOT use:

customer auth as admin auth

browser localStorage role

user-editable Supabase metadata

email supplied by request

for authorization.

Every protected endpoint must:

verify Supabase Auth session server-side

then verify admin membership.

No public self-registration that grants admin.

Document first-admin manual bootstrap.

======================================================================
5. PROTECT DASHBOARD + ADMIN APIs
======================================================================

Add dashboard login/auth protection.

Create centralized helper such as:

requireAdmin()
requireAdminRole()

or equivalent.

Use server-side authorization for:

communication rule CRUD

run-now

broadcast controls

template CRUD

provider-template submission/status refresh

test sends

DLQ retry

promotion/offer CRUD

provider/customer analytics containing PII

A protected React page alone is not sufficient.

Every mutation route must verify authorization.

======================================================================
6. FIX /api/whatsapp/send
======================================================================

Audit showed this endpoint can currently invoke Meta using a
caller-provided destination/template without administrative auth.

Fix this before adding broadcast features.

Preferred design:

lib/whatsapp/provider.ts
or existing server-only provider service

contains actual Meta call.

Internal application code calls server service.

QStash communication consumer calls server service.

HTTP /api/whatsapp/send becomes:

admin-protected

or otherwise strictly server-authorized based on its actual callers.

Do NOT leave arbitrary anonymous Meta sending possible.

Preserve legitimate existing /api/lead behavior while migrating that
provider operation async.

======================================================================
7. ANALYTICS ARCHITECTURE — IMPORTANT CLARIFICATION
======================================================================

There are THREE parallel analytics destinations.

Do NOT incorrectly model them as one data stream.

A. UPPERMOST FIRST-PARTY ANALYTICS

Current Custom Tracker sends:

visitor state

session state

page_view

product_view

click events

scroll-depth events

checkout journey events

session_end

and other Uppermost tracking events

into Supabase.

B. GOOGLE ANALYTICS

Independent GTM GA4 tags send events to Google.

For example current GTM contains a GA4 scroll_depth event with
Scroll_percent.

C. MICROSOFT CLARITY

The Microsoft Clarity GTM tag independently sends Clarity telemetry
to Microsoft.

Current Clarity tag configuration uses GTM variables:

{{Analytics Client ID}}

{{Analytics Session ID}}

for Clarity custom identity/session configuration.

Clarity proprietary detections such as:

rage clicks
dead clicks
quick backs
excessive scrolling

must NOT be assumed to exist in analytics_events merely because the
Clarity tag is installed.

Those remain Clarity-owned unless Uppermost explicitly implements
equivalent first-party events or a supported enrichment process.

======================================================================
8. ONE SHARED BROWSER IDENTITY
======================================================================

The Uppermost Custom Tracker currently generates:

localStorage:

uppermost_visitor_id

with:

v_<uuid>

and:

uppermost_session_id

with:

s_<uuid>

Preserve this identity generation behavior.

Visitor ID survives browser sessions until local storage is removed.

Session ID rotates after approximately 30 minutes inactivity.

Do NOT make:

GA4

Clarity

Framer

CheckoutDrawer

each create another Uppermost identity.

There should be ONE Uppermost browser identity.

======================================================================
9. GTM VARIABLE VALIDATION DOCUMENTATION
======================================================================

Repository code cannot inspect the live GTM workspace.

Therefore produce a manual validation checklist.

The GTM variables:

Analytics Client ID

Analytics Session ID

used by Microsoft Clarity MUST resolve to:

uppermost_visitor_id

uppermost_session_id

respectively.

Do NOT assume this merely from the variable names.

Document how to verify this using GTM Preview mode.

If those variables currently represent different IDs:

provide exact GTM variable changes required.

Do NOT automatically modify GTM externally.

======================================================================
10. GTM PUBLIC IDENTITY API
======================================================================

Preserve:

window.uppermostTrack = track

Add:

window.uppermostAnalytics = {
  getIdentity: function () {
    return {
      visitorId: visitorId,
      sessionId: sessionId
    };
  },

  track: track
};

getIdentity() must return the IDs already being used.

It must NOT create a second identity.

Do not expose:

customer_id

email

phone

name

address

through the browser identity object.

======================================================================
11. STOP DIRECT BROWSER SUPABASE ANALYTICS WRITES
======================================================================

Current Uppermost tracker calls Supabase REST directly using the
publishable key.

Migrate ONLY the Uppermost first-party analytics sink.

Do NOT change GA4 or Clarity provider tags merely for this reason.

New architecture:

Uppermost Custom Tracker

-> POST /api/analytics/ingest

-> Vercel

-> validated server-side Supabase operation

-> analytics_visitors
   analytics_sessions
   analytics_events

After rollout:

remove anonymous generic historical SELECT from those analytics tables.

remove anonymous direct visitor/session UPDATE access.

remove browser direct analytics table mutations when no longer needed.

Do not expose service-role key to browser.

======================================================================
12. WHY ANALYTICS INGESTION MOVES SERVER-SIDE
======================================================================

All anonymous browsers share the Supabase publishable role.

RLS cannot securely prove:

browser A owns visitor_id A

when visitor_id is just caller-supplied browser data.

The narrow ingestion endpoint provides:

schema control

origin control

rate limiting

request size limits

allowed operation control

metadata limits

and prevents:

arbitrary historical reads

cross-visitor direct table mutation

generic Supabase CRUD

This is the approved direction.

======================================================================
13. /api/analytics/ingest
======================================================================

Create a very small public analytics ingestion boundary.

Possible route:

POST /api/analytics/ingest

It should support only explicitly allowed operations.

Examples:

SESSION_TOUCH

EVENT

INITIALIZE

or an equivalent simple contract.

Do NOT expose:

table name

SQL

filter expressions

customer_id mutation

generic REST behavior.

Validate:

allowed origin

payload size

event count

event name

visitor ID format

session ID format

page URL/path size

metadata maximum depth

metadata maximum encoded size

string lengths

array lengths

timestamp sanity

Use rate limits.

Response should be minimal.

======================================================================
14. ANALYTICS INGESTION MUST STAY LIGHTWEIGHT
======================================================================

Do NOT send every analytics operation through QStash.

First-party page analytics is telemetry, not money-critical workflow.

QStash is for durable communication/business side effects.

Analytics ingest should be:

small
fast
bounded

Prefer one compact DB RPC/transaction for related operations where this
materially reduces calls.

Example initial page activity can safely combine:

visitor touch
session touch
page-view insert

if practical.

Do not build an analytics message-broker platform.

======================================================================
15. ANALYTICS WRITE REDUCTION
======================================================================

Current tracker performs frequent visitor/session heartbeats.

Audit current behavior carefully before changing it.

Reduce unnecessary database write amplification without breaking
"online visitor" semantics.

Preferred principles:

- visible-page heartbeat only
- page/event traffic already counts as activity
- do not independently write visitor + session more often than required
- combine updates where practical
- configurable heartbeat interval
- no heartbeat when document is hidden
- use keepalive/sendBeacon-like behavior for final bounded flush

Do not introduce complicated client batching if benefit is negligible.

A simple bounded micro-batch is acceptable if robust.

Do not queue hundreds of browser events in memory.

======================================================================
16. EVENT DEDUPLICATION
======================================================================

Where practical add optional:

client_event_id

generated by the tracker for first-party analytics events.

Server/database can use it to make retry/beacon duplicates idempotent.

Do not make this a commerce identifier.

This is analytics-only.

======================================================================
17. PRESERVE CURRENT GTM EVENT BEHAVIOR
======================================================================

Do not rewrite unrelated tracker behavior.

Preserve existing first-party events such as:

page_view

product_view

button_click

add_to_cart

remove_from_cart

buy_now_click

checkout_started

checkout_open

checkout_exit

scroll_depth_25
scroll_depth_50
scroll_depth_75
scroll_depth_100

session_end

and current metadata where useful.

GA4 may separately receive a generic:

scroll_depth

event.

That is not a duplicate database problem because it is a separate
analytics destination.

Document the naming distinction.

======================================================================
18. CLARITY ARCHITECTURE
======================================================================

Keep Microsoft Clarity as a separate parallel analytics destination.

Use the shared Uppermost browser identity.

Preferred mapping:

Clarity Custom ID
= Uppermost visitor ID

Clarity Session ID
= Uppermost session ID

Do NOT send to Clarity:

customer email

phone

name

address

payment ID

Razorpay ID

customer PII

Do not send internal customer_id unless separately approved later.

Internal mapping is:

customer_id

-> analytics_identity_links

-> visitor_id

-> Clarity custom visitor identity

This keeps customer data server-side.

======================================================================
19. CLARITY INTELLIGENCE V1
======================================================================

Clarity is INTERNAL intelligence.

Do not currently implement customer-facing messages triggered by:

rage click

dead click

quick back

excessive scrolling

Do not create:

"We saw you clicking repeatedly"

messages.

Clarity/session replay can later support support-team intelligence.

If first-party equivalents are required for rule logic:

instrument explicitly as Uppermost events.

Do not pretend Clarity automatically writes them into Supabase.

======================================================================
20. GA4
======================================================================

GA4 remains independent.

Do not make communication engine depend on GA4.

Do not query GA4 at send time.

GA4 is analytics/reporting.

Uppermost first-party read models are the source used by the communication
rule engine.

Document existing GA4 event coexistence.

======================================================================
21. FRAMER IS AN EXTERNAL FRONTEND SYSTEM
======================================================================

The actual Framer site/code is managed separately.

Do NOT pretend repository implementation modifies Framer automatically.

All Framer changes must be documented separately.

Create:

docs/UPPERMOST_FRAMER_INTEGRATION.md

Every required Framer change should be labelled:

EXTERNAL MANUAL CHANGE — NOT APPLIED BY THIS REPOSITORY

Include copy-paste code.

======================================================================
22. GTM IS AN EXTERNAL SYSTEM
======================================================================

The live GTM workspace is also externally configured.

Create:

docs/UPPERMOST_GTM_ANALYTICS.md

Document:

current architecture

identity variables

GTM tracker change

analytics ingestion endpoint

GA4 coexistence

Clarity coexistence

GTM Preview validation

rollout procedure

rollback procedure

Every live GTM action should be labelled:

EXTERNAL MANUAL CHANGE — NOT APPLIED BY THIS REPOSITORY

======================================================================
23. FRAMER GETS VISITOR ID LOCALLY
======================================================================

Framer does NOT need an API call to retrieve visitor/session identity.

Use:

function getUppermostAnalyticsIdentity() {
  try {
    if (
      window.uppermostAnalytics &&
      typeof window.uppermostAnalytics.getIdentity === "function"
    ) {
      return window.uppermostAnalytics.getIdentity();
    }
  } catch {}

  try {
    return {
      visitorId:
        localStorage.getItem("uppermost_visitor_id") || null,

      sessionId:
        localStorage.getItem("uppermost_session_id") || null
    };
  } catch {
    return {
      visitorId: null,
      sessionId: null
    };
  }
}

Do NOT generate a fallback v_ or s_ identity in CheckoutDrawer.

If no GTM identity exists:

checkout still works.

Analytics identity is optional.

======================================================================
24. FRAMER CHECKOUT REQUEST
======================================================================

Current:

POST /api/checkout/prepare

remains authoritative.

Add optional request headers:

X-Uppermost-Visitor-Id

X-Uppermost-Session-Id

Example:

const analyticsIdentity =
  getUppermostAnalyticsIdentity();

const headers = {
  existing headers...
};

if (analyticsIdentity.visitorId) {
  headers["X-Uppermost-Visitor-Id"] =
    analyticsIdentity.visitorId;
}

if (analyticsIdentity.sessionId) {
  headers["X-Uppermost-Session-Id"] =
    analyticsIdentity.sessionId;
}

Existing checkout body remains unchanged.

======================================================================
25. CHECKOUT IDEMPOTENCY MUST REMAIN UNCHANGED
======================================================================

Current checkout route computes:

requestHash(input)

from parsed authoritative checkout body.

Do NOT include:

visitor ID

session ID

Clarity ID

GA ID

in that hash.

Analytics identity does not influence:

pricing

quote validity

payment amount

promotion

shipping

subscription

Razorpay

business idempotency.

Headers are contextual only.

======================================================================
26. COMMERCE CORS
======================================================================

Add:

X-Uppermost-Visitor-Id

X-Uppermost-Session-Id

to commerce allowed request headers.

Preserve all existing CORS behavior.

Do not remove other allowed headers.

OPTIONS requests from Framer must continue working.

======================================================================
27. CHECKOUT ROUTE IDENTITY CONTEXT
======================================================================

Read optional headers.

Validate:

expected v_ / s_ format where appropriate

max length

safe characters

Treat malformed analytics identity as non-authoritative.

Preferred non-breaking behavior:

ignore malformed analytics context + structured log

rather than reject an otherwise valid checkout.

Do not allow an analytics formatting problem to block purchase.

Pass analytics context separately to checkout service.

Do NOT add it to checkoutPrepareSchema unless absolutely necessary.

======================================================================
28. SERVER CUSTOMER/ANALYTICS LINK
======================================================================

Current checkout service already calls:

findCustomerIdentity(...)

and later:

resolveOrCreateCustomer(...)

Do not resolve customer twice.

After successful:

resolveOrCreateCustomer(...)

returns customer.id,

perform:

linkAnalyticsIdentity({
  customerId,
  visitorId,
  sessionId,
  source: "CHECKOUT"
})

This is best-effort analytics enrichment.

Failure must NOT:

fail checkout

alter price

alter order

alter Razorpay

alter subscription

change API success.

Log and optionally schedule reconciliation.

======================================================================
29. ANALYTICS IDENTITY MODEL
======================================================================

Create:

analytics_identity_links

Recommended:

id uuid PK

visitor_id text not null

customer_id uuid not null

lead_id uuid nullable

identified_session_id text nullable

source text not null

confidence text not null

source_reference_id nullable

linked_at
last_seen_at

valid_from
valid_until nullable

is_current

metadata

created_at
updated_at

Possible sources:

CHECKOUT
OTP_LOGIN
AUTH
LEAD_CONVERSION

Do NOT call checkout-entered contact VERIFIED.

Confidence vocabulary should distinguish:

DECLARED

IDENTIFIED

AUTH_VERIFIED

or similarly accurate terms.

Checkout contact information is identified/declared, not necessarily
cryptographically verified.

======================================================================
30. SHARED DEVICE SAFETY
======================================================================

Relationship is NOT:

visitor = customer

One customer may have many devices/browser identities.

One browser may occasionally be shared.

Atomic linker:

no current mapping
-> create

same customer
-> refresh last_seen/session

different customer
-> close previous validity window
-> create new mapping

Do not rewrite historical ownership.

Use locks only on identity-link scope.

Never lock order/payment tables for this.

======================================================================
31. CUSTOMER JOURNEY
======================================================================

Customer timeline should be query-time/support functionality.

customer_id

-> identity link periods

-> visitor IDs

-> sessions/events

then merge with:

lead history

orders

payments

subscriptions

shipments

communications

Paginate.

Do NOT run this expensive timeline assembly as part of ordinary rule
evaluation.

Possible confidence:

VERIFIED_SESSION

IDENTIFIED_BROWSER

INFERRED_PRE_IDENTIFICATION

Do not use inferred analytics as financial authority.

======================================================================
32. NO HEAVY RULE QUERIES
======================================================================

This is non-negotiable.

Normal rules must NOT repeatedly aggregate/join:

orders

order_items

payment_attempts

subscriptions

subscription_cycles

checkout_sessions

shipments

analytics_events

Do NOT run:

large GROUP BY queries

wide JOINs

historical scans

every communication cron cycle.

Commerce tables must remain optimized for commerce.

======================================================================
33. CQRS-LITE READ MODEL
======================================================================

Create compact derived read models.

Example:

communication_customer_features

customer_id PK

order_count

realized_spend_paise

average_order_value_paise

first_order_at

last_order_at

last_order_id

last_order_total_paise

ordered_product_codes

ordered_skus

repeat_product_codes

active_subscription_count

subscription_status

subscription_interval_days

next_subscription_charge_at

last_payment_status

last_shipment_status

discount_order_count

discount_order_ratio

last_product_view

top_product_affinity

last_seen_at

last_cart_activity_at

cart_value_paise

cart_checkout_started

cart_converted

last_marketing_sent_at

messages_last_24h

messages_last_7d

email_marketing_allowed

whatsapp_marketing_allowed

sms_marketing_allowed

updated_at

Rules read this projection.

This table is NOT commerce authority.

======================================================================
34. INCREMENTAL PROJECTIONS
======================================================================

Do not recalculate features by scanning entire order history repeatedly.

Update derived features incrementally from domain events.

Examples:

order confirmed
-> order metrics update

payment confirmed
-> payment feature

subscription activated
-> subscription feature

shipment delivered
-> fulfilment feature

first-party analytics event
-> behavioral feature

communication delivered
-> frequency feature

Projection failures do not change commerce state.

Add a bounded reconciliation/backfill mechanism for recovery.

======================================================================
35. BEHAVIOR READ MODEL
======================================================================

Do not scan raw analytics_events for every abandoned-cart rule.

Maintain compact derived behavior state.

Possible:

communication_behavior_features

visitor_id

current_customer_id nullable

last_seen_at

last_session_id

last_product_view

recent_product_views

recent_add_to_cart_at

last_checkout_started_at

last_purchase_at

friction_score

updated_at

Or safely integrate these fields into customer feature model after
identity resolution.

Raw analytics remains historical storage.

======================================================================
36. RULE QUERY INDEXES
======================================================================

Create only purposeful indexes.

Examples:

communication_rules
(status, next_run_at)

outbox
(status, next_attempt_at)

communication_run_recipients
(run_id, status, customer_id)

communication_customer_features
(last_order_at)

communication_customer_features
(last_cart_activity_at, cart_converted)

communication_customer_features
(subscription_status, next_subscription_charge_at)

analytics_identity_links
(customer_id)

analytics_identity_links
(visitor_id, is_current)

Use partial indexes where useful.

Inspect query plans.

Do not create an index on every field.

======================================================================
37. EVENT RULES VS SCHEDULED RULES
======================================================================

EVENT RULE:

payment success

already knows:

customer
order
payment

Evaluate only that subject.

No audience scan.

SCHEDULED RULE:

retention
abandoned cart
weekly communication
festival campaign

queries derived feature tables.

Do not query raw transactional history.

======================================================================
38. SCHEDULED AUDIENCES
======================================================================

Use bounded batches.

Prefer keyset pagination.

Do not use large OFFSET pagination.

Example batch size:

500–2000

but choose after testing.

Never load full audience into Vercel memory.

Create communication_run.

Snapshot recipients incrementally.

QStash handles async recipient work.

Cron exits quickly.

======================================================================
39. PERFORMANCE GUARDS
======================================================================

Add hard limits:

max rules per cron run

max recipients claimed per batch

max preview size

max execution duration

max provider concurrency

max database statement duration where safely supported

If a rule becomes unexpectedly expensive:

stop/pause run

record performance failure

surface it to admin.

Do not let an admin-created rule overload production DB.

======================================================================
40. OUTBOX
======================================================================

Inspect existing:

integration_outbox
integration_failures

before choosing design.

If reusable:

extend them.

If semantics conflict:

create communication-specific outbox

and document why.

Never create redundant systems without justification.

Supabase is durability authority.

QStash is transport.

======================================================================
41. BUSINESS STATE VS OUTBOX
======================================================================

Do not publish to QStash as the only record.

Persist durable local intent first.

Where practical:

business/message transition
+
outbox intent

should be coordinated safely.

But do not let a communication-outbox trigger roll back an already-valid
payment/order business transition.

The preliminary audit correctly warned that a failing AFTER INSERT trigger
can fail its enclosing transaction.

Design explicitly around that invariant.

======================================================================
42. QSTASH
======================================================================

Use official:

@upstash/qstash

Environment:

QSTASH_TOKEN
QSTASH_CURRENT_SIGNING_KEY
QSTASH_NEXT_SIGNING_KEY
COMMUNICATION_BASE_URL

Inbound QStash routes verify signatures.

Use official library.

No RabbitMQ.

======================================================================
43. TWO COMMUNICATION LANES
======================================================================

Use:

REALTIME

OTP
payments
mandates
renewals
orders
shipping

BULK

abandoned cart
retention
weekly
festival
launch
marketing

Avoid one physical queue per provider.

Use QStash flow-control keys by provider:

uppermost:whatsapp

uppermost:brevo

uppermost:msg91

uppermost:lemlist

REALTIME cannot be starved by BULK.

======================================================================
44. DYNAMIC CRON DESIGN
======================================================================

Do NOT create one Vercel Cron per rule.

Keep one dispatcher:

/api/internal/cron/communications

Dynamic schedules live in communication_rules.

Dispatcher:

verify secret

claim due rules

create run

advance next_run_at

enqueue bounded work

exit.

Do not send campaign messages in cron request.

Existing renewal cron remains separate.

======================================================================
45. RULE MODEL
======================================================================

communication_rules supports:

DRAFT
ACTIVE
PAUSED
ARCHIVED

trigger:

EVENT
SCHEDULE
MANUAL

cron_expression

timezone

condition_config

channel_strategy

template mapping

priority

frequency caps

quiet hours

validity

last run

next run

status/error

version.

Use Asia/Kolkata default.

Validate cron expressions server-side.

Show future schedule preview.

======================================================================
46. RULE DSL
======================================================================

Whitelisted fields/operators only.

No raw SQL.

No eval.

No user-authored JavaScript.

Operators:

eq
neq
gt
gte
lt
lte
in
not_in
contains
exists
before
after
days_since_gte
days_since_lte

groups:

all
any
none

Rules compile against communication feature tables.

======================================================================
47. ABANDONED CART
======================================================================

Use derived state.

Do not scan analytics_events on every cron.

Before actual send:

re-check current compact purchase/cart state.

If converted:
SUPPRESS.

Anonymous unidentified visitor:
do not message.

======================================================================
48. /api/lead
======================================================================

Keep it.

Prelaunch UI is gone, but API will be useful for future:

promotion popup

waitlist

preorder

product launch

back-in-stock

editorial signup

invitation request

Preserve its contract.

Future optional additive fields:

captureType
sourceReference
campaignReference

Do not require them.

Checkout does not automatically create a lead.

======================================================================
49. LEAD/CUSTOMER LINKING
======================================================================

A lead and a customer are different entities.

If same visitor later checks out:

associate through identity graph and deterministic matching.

Do not use ambiguous fuzzy matching.

Do not call unverified contact values verified.

======================================================================
50. TEMPLATE OWNERSHIP
======================================================================

Uppermost/Supabase is canonical.

Use:

logical template

-> immutable template version

-> provider artifact

Providers do not own canonical Uppermost content.

Preserve existing message_templates/customer_messages compatibility.

======================================================================
51. BREVO
======================================================================

Preferred email delivery:

DIRECT HTML.

Uppermost stores HTML.

Render server-side.

Send using Brevo transactional HTML content.

Optional provider-template mode may exist.

Do not unnecessarily synchronize every email version into Brevo.

======================================================================
52. EMAIL HTML
======================================================================

Dashboard:

upload HTML

paste HTML

desktop preview

mobile preview

plain text preview

variables

assets

test send

Validate/sanitize:

script

iframe

forms

JS handlers

unsafe URLs

broken variables

insecure assets

Do not build a full Mailchimp-style visual editor in V1.

======================================================================
53. EMAIL MEDIA
======================================================================

Images:
supported through public HTTPS assets.

Video:
do not depend on embedded HTML5 video.

Use:

video URL
poster image
clickable thumbnail

Optional GIF.

======================================================================
54. META WHATSAPP TEMPLATES
======================================================================

Provider lifecycle must be modeled.

Uppermost draft

-> submit

-> Meta PENDING

-> webhook/API status

-> APPROVED or rejected/etc.

Production rule cannot select unapproved artifact.

Provider approval cannot be manually forged by admin.

Keep old active version while replacement is awaiting approval.

======================================================================
55. SMS / MSG91 / DLT
======================================================================

Model:

Uppermost template

-> DLT approval

-> DLT Template ID

-> MSG91 mapping

-> READY

DLT remains compliance authority.

Do not claim MSG91 alone approved DLT content.

Provider APIs/callbacks must be based on current documented contracts.

======================================================================
56. LEMLIST
======================================================================

Lemlist remains cold/outbound nurture.

Do not use for:

OTP
payments
orders
shipping
mandates
renewal transactions

Map Uppermost content to:

campaign
sequence
step

Handle running-campaign edit restrictions explicitly.

======================================================================
57. OTP
======================================================================

Fallback:

WhatsApp
-> SMS
-> Email

One challenge.

Same OTP across fallback.

Cryptographically generated.

Persist hash + short-lived encrypted delivery value.

Never plaintext in:

DB
QStash
logs
analytics
DLQ.

============================================================
58. COMMUNICATION DASHBOARD
============================================================

Top-level:

Communications

Tabs:

Overview
Rules
Runs
Templates
Deliveries
Providers
DLQ

Show:

processing

retrying

DLQ

delivery rate

WhatsApp

Email

SMS

Lemlist

provider health

last run

next run

contacts processed.

============================================================
59. RULE EDITOR
============================================================

Support:

friendly schedule

cron expression

timezone

next execution preview

audience builder

channels

template/version

frequency caps

quiet hours

dry run

preview

publish.

No raw JSON as primary UX.

No raw SQL.

============================================================
60. OFFERS DASHBOARD
============================================================

Separate:

Offers

Manage existing promotions engine.

Do not create another price calculator.

UI mirrors actual supported:

conditions

actions

priority

stacking

usage

lifecycle

subscriber cycles

audiences

validity.

Server-side pricing engine performs preview.

============================================================
61. PROMOTION VERSIONING
============================================================

Add version/audit history if absent.

Do not rewrite historical orders.

Optimistic concurrency.

409 on stale update.

Avoid destructive deletes for historically-used offers.

============================================================
62. UI SKILLS
============================================================

Use the previously specified four design references:

Leonxlnx/taste-skill

Leonxlnx/taste-skill/skills/gpt-tasteskill

nextlevelbuilder/ui-ux-pro-max-skill

anthropics/skills/frontend-design

Apply:

hierarchy
typography
density
forms
tables
accessibility
charts
status semantics

But remember:

this is an operational dashboard.

Do not turn it into a marketing landing page.

============================================================
63. DRY RUN
============================================================

COMMUNICATION_DRY_RUN=true

Allowlist test emails/phones.

Non-allowlisted recipients must never be externally sent while dry-run
is enabled.

============================================================
64. DOCUMENTATION — KEEP EXTERNAL SYSTEMS IN SYNC
============================================================

Create/update:

docs/UPPERMOST_COMMUNICATION_ENGINE.md

docs/UPPERMOST_CUSTOMER_IDENTITY.md

docs/UPPERMOST_ANALYTICS_ARCHITECTURE.md

docs/UPPERMOST_GTM_ANALYTICS.md

docs/UPPERMOST_FRAMER_INTEGRATION.md

docs/UPPERMOST_CLARITY_GA4.md

docs/UPPERMOST_COMMUNICATION_TEMPLATES.md

docs/UPPERMOST_ADMIN_OFFERS.md

docs/UPPERMOST_COMMERCE_ARCHITECTURE.md

docs/README.md

Repository docs must clearly distinguish:

REPOSITORY CHANGE

EXTERNAL GTM CHANGE

EXTERNAL FRAMER CHANGE

PROVIDER DASHBOARD CHANGE

This is important so future Codex/Claude/ChatGPT sessions understand
which system owns each part.

============================================================
65. GTM FINAL HANDOFF
============================================================

Provide exact GTM change instructions.

At minimum:

1. updated Custom Tracker network destination
2. window.uppermostAnalytics identity accessor
3. GTM variable validation
4. GA4 coexistence
5. Clarity coexistence
6. preview/testing procedure
7. publish procedure
8. rollback procedure

Do not claim GTM was modified automatically.

============================================================
66. FRAMER FINAL HANDOFF
============================================================

Provide exact CheckoutDrawer change.

Include:

identity helper

optional checkout headers

CORS requirements

what must NOT change in checkout body

exact test procedure.

Do not claim Framer was modified automatically.

============================================================
67. ANALYTICS ROLLOUT ORDER
============================================================

Do NOT revoke current browser Supabase permissions before the new ingestion
API and updated GTM tracker are live.

Safe rollout:

1. deploy ingestion API
2. verify server writes
3. prepare GTM Custom Tracker update
4. GTM Preview test
5. publish GTM
6. confirm new ingestion traffic
7. confirm GA4 remains healthy
8. confirm Clarity remains healthy
9. then tighten Supabase anonymous analytics RLS/grants
10. verify dashboard server-side analytics endpoints

Avoid telemetry outage.

============================================================
68. OBSERVABILITY
============================================================

Monitor:

analytics ingestion request rate

rejected analytics payloads

analytics DB latency

projection lag

outbox backlog

QStash errors

provider health

rule duration

rows processed

DLQ

identity mapping failures

rule query duration

slow query count.

============================================================
69. PERFORMANCE TESTS
============================================================

Prove:

commerce endpoints do not wait for provider communication

rule engine uses derived tables

ordinary scheduled rules do not scan raw orders

ordinary scheduled rules do not scan raw analytics_events

audiences use keyset pagination

large audiences are bounded

analytics ingestion does not perform expensive queries

identity linking only locks identity scope

communication outage does not break checkout/payment.

============================================================
70. CHECKOUT TESTS
============================================================

Test:

existing body unchanged

no analytics headers still works

visitor header works

session header works

malformed analytics IDs cannot break valid purchase

headers do not affect requestHash

headers do not affect pricing

headers do not affect quote

headers do not affect Razorpay

customer resolves once

identity mapping created

mapping failure does not fail checkout.

============================================================
71. ANALYTICS TESTS
============================================================

Test:

existing visitor reused

new session after inactivity

event validation

event size limit

metadata limit

invalid origin

rate limiting

duplicate client_event_id

visitor/session touch

page_view

product_view

scroll event

checkout event

browser cannot read historical analytics after RLS hardening

browser cannot arbitrarily update another visitor after migration.

============================================================
72. ADMIN SECURITY TESTS
============================================================

Test:

anonymous dashboard blocked

customer auth != admin

authenticated non-admin blocked

viewer mutation blocked

admin allowed

WhatsApp send endpoint unauthorized request blocked

protected analytics/customer endpoints blocked anonymously.

============================================================
73. VALIDATION
============================================================

Install dependencies in the development environment if appropriate.

Run:

npm run typecheck

npm test

npm run build

git diff --check where Git is available.

Inspect query plans for important rule/read-model queries.

Do not apply destructive production changes.

Do not deploy automatically.

============================================================
74. FINAL REPORT
============================================================

Report:

1. completed repository audit
2. security implementation
3. admin bootstrap instructions
4. analytics architecture before/after
5. GTM required changes
6. GA4 coexistence
7. Clarity coexistence
8. exact Framer required changes
9. checkout compatibility
10. identity graph
11. read-model/performance architecture
12. existing outbox reuse decision
13. QStash implementation
14. rule engine
15. scheduling
16. templates
17. provider lifecycle
18. OTP
19. communications dashboard
20. Offers dashboard
21. migrations
22. query-plan findings
23. tests
24. required environment variables
25. external manual provider setup
26. deployment order
27. rollback order
28. outstanding production risks

Continue through implementation after completing the security prerequisite.

Do not stop merely to ask again whether admin auth,
analytics-ingestion hardening,
or visitor/customer linking are approved.

They are approved.