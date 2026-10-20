# Uppermost Commerce Documentation Map

## Checkout redirect work — release status, 21 October 2026

- Backend `fix/checkout-experience-navigation`: prepare returns the existing experience token in `next.url`; optional public typing supports old idempotent replays. Existing verify/status behavior is unchanged. This is a local additive fallback, not a proven root-cause fix for the reported order. Backend tests: 90 passed; typecheck passed; production build passed with dummy local Supabase configuration. No migration is needed for these changes.
- Frontend `fix/checkout-navigation-recovery`: replaces the completed checkout history entry, recovers restored checkout state, exposes a direct paid-order link after stalled navigation, polls unresolved/missing-URL verification responses, and discards responses from stopped polling generations. Six isolated browser scenarios and a focused TypeScript check passed. Mocked browser tests do not establish the incident's exact cause or prove mobile Safari/provider behavior in production.
- After explicit user approval, `CheckoutDrawer.tsx` was pushed to Framer `main` and published to production as version `c2d30ff30` at https://www.uppermost.store. Framer readback matched the local source and returned no type errors; the published bundle contains the navigation replacement, page-restore handler and direct-order-link recovery. The backend prepare-URL fallback and analytics corrections are merged into `main` and deployed to Vercel production. Code revision `0f90eda` passed Vercel deployment status and read-only production smoke checks on 21 October 2026; Today/30-day summary responses returned 200, chart totals matched cards, and the responsive dashboard HTML was served. The subsequent documentation commit records this verification without changing runtime code. No staging branch or environment was changed.
- Production order `UPM-20261019-000085` had a saved `CONFIRMED` verify response with the exact correct experience URL at 21:11:49.780 IST on 19 October. Analytics reported that token's `/experience` URL at 21:11:53.500 IST. These records contradict a missing-URL verification diagnosis for that order, but do not prove successful visual rendering. Browser Back restored the frozen overlay in an isolated reproduction; that does not prove Ankur used Back. Vercel logs remain unreviewed pending connection.

Use this file to choose the correct source before changing or integrating commerce behavior.

For AI coding-tool setup and workflow selection after a fresh checkout, see [`AI_ASSISTANT_SKILLS.md`](AI_ASSISTANT_SKILLS.md).

## Authority order

1. `UPPERMOST_COMMERCE_ARCHITECTURE.md` — frozen architecture and business/state-machine source of truth. Update this first before any architecture-level behavior change.
2. Actual route, service, schema, migration, and test code — source of truth for the checked-out implementation. Confirm the deployed revision before treating local code as live behavior. If implementation differs from the frozen architecture, stop, document the drift, and reconcile intentionally.
3. `FRAMER_COMMERCE_CONTRACT.md` and `FRAMER_COMMERCE_TYPES.ts` — exact browser-safe request, response, error, polling, and type contract for Framer.
4. `UPPERMOST_COMMERCE_CONTRACT.md` — concise API and platform contract overview.
5. `RAZORPAY_LIVE_RUNBOOK.md` — deployment, webhook, renewal, recovery, and production-validation operations.

## Critical reading path for a human or AI

Before commerce work:

1. Read `UPPERMOST_COMMERCE_ARCHITECTURE.md` completely.
2. Read `AGENTS.md` at the repository root.
3. Read the relevant public contract and route/service/tests for the requested area.
4. For payments or renewals, also read `RAZORPAY_LIVE_RUNBOOK.md` and the current migrations.
5. Keep all monetary values in integer paise and all provider secrets/tokens server-side.
6. Do not infer state from browser callbacks, token-ID presence, or UI state. Use persisted, verified provider evidence and the centralized state machines.
7. Treat sections labelled future scope as unimplemented. Never silently promote them to current behavior.

## Razorpay activation invariant

Initial recurring activation requires both a strictly validated captured `RECURRING_AUTH` payment and the exactly correlated recurring mandate in `ACTIVE` with a bound provider token. Mandate confirmation can arrive in a standalone `token.confirmed` event or as an embedded token with `recurring = true` and `recurring_details.status = confirmed` in a signed capture/verified provider fetch. A token ID alone never activates. Arrival order and duplicate delivery must converge without moving billing dates twice or creating duplicate cycles.

## Document formats

The Markdown architecture file is canonical and current. `architecture/UPPERMOST_COMMERCE_ARCHITECTURE.docx` is a historical 24 September 2026 presentation snapshot (version 1.0); it is not maintained as an implementation contract and must not override the Markdown architecture, current contracts, migrations, or code. Regenerate and review that presentation artifact before distributing it as current architecture.

## Current migration note

As confirmed by the operator on 5 October 2026, `20261005090000_harden_razorpay_recurring_architecture.sql` has already been applied to the target environment. The embedded confirmed-token activation reconciliation is code-only and adds no migration. Verify migration history rather than rerunning a migration solely for that fix.

## Analytics dashboard correction — production release approved, 21 October 2026

The analytics UI lives in the backend repository (`components/Dashboard.tsx`), not in Framer. Changes are confined to dashboard reads, aggregation, presentation and tests; no tracker, schema, commerce lifecycle, payment, pricing or provider behavior was changed for this dashboard work.

Read-only production inspection on 21 October 2026 found paired tracker records, `buy_now_click` emitted for the **Buy once mode selector**, and no `checkout_started`/purchase events in the inspected 30-day period despite one confirmed paid initial order. Previously, raw event ratios mixed visitors with hit counts, “returning” meant multiple events in the selected range, and several graphs/aggregations read only the first Supabase result page. These are dashboard interpretation/query defects; browser analytics cannot establish payment completion or visual page rendering.

The local `GET /api/analytics/dashboard?days=1|2|7|30|90&group=hour|day|week|month` route performs Supabase reads on the server (existing anon analytics grants for analytics tables; service role exclusively for commerce tables) and returns aggregates, not customer rows, order identifiers, experience tokens or provider payloads. It paginates with deterministic ordering, fails explicitly instead of showing false zeroes, and imposes a 100,000-row per-table read limit (choose a shorter range if exceeded). Access follows the existing public analytics dashboard: these aggregate totals are visible to dashboard visitors; commerce table RLS and credentials remain server-only. It must not be treated as an authenticated finance report.

Metric definitions:

- Today / 7D / 30D / 90D use IST calendar boundaries through snapshot time; 48H is rolling. Cards and graph buckets share that window.
- Visitors are distinct recorded visitor IDs. New means first seen within the window; returning means first seen earlier. Missing first-seen history stays unclassified. Recorded sessions are distinct session IDs in the window's events.
- Paired different-source records with the same visitor, path, event and button label within one second are merged as a reporting heuristic; genuine repeats from one source survive. A paired page/product event is one product-view action, and paired generic/Buy events for one button are one intent action. Raw event rows are unchanged. Historical tracking gaps cannot be repaired by queries.
- Order intent includes observed Pre-order/Buy/add-to-order/cart buttons and excludes Buy once, subscription mode choices and Remove. Payment-intent clicks are not completed payments.
- Prepared checkouts count unique server checkout sessions by creation time. Confirmed sales count unique `CONFIRMED` orders with `paid_at` in range, including renewals. Paid revenue is integer paise; aggregate initial/renewal counts remain separate in the response. These totals are intentionally independent of browser attribution.
- Both funnel views show distinct visitors progressing chronologically through activity → product view → order intent → payment intent → experience journey within the selected window. Percentages share one visitor denominator. A journey URL is not proof of a rendered page or a purchase; absent tracking yields incomplete observed journeys.
- Device/browser/OS/source distributions count recorded sessions associated with the selected activity, not raw hits. Referrers use hostnames only. Page groups strip query strings and hashes. Live counters use a three-minute activity window and each active session's latest page, even if its page view predates that window.

Mobile: collapsible navigation, touch-sized date controls, compact two-column metric cards, responsive panels/graphs and horizontally scrollable tables. Existing commerce rules and third-party lead/advertising integrations remain unchanged.

Validation: 100 automated tests passed (10 analytics regression tests included), TypeScript and production build passed with dummy credentials. Isolated browser checks use mocked data at 375, 390, 768 and 1440px; they check overflow, navigation, funnel/graphs/tables and explicit failed-refresh warnings. The user approved the production merge/deployment on 21 October 2026. This release uses `main` only; check its GitHub/Vercel deployment status and production smoke check to establish the deployed revision. No database writes or migrations are part of this work, and staging is excluded.

Production smoke-check correction: initial deployment returned 503 because analytics tables lack service-role SELECT grants even though anon can read them. The dashboard route now uses the existing public analytics client for event/visitor/session reads and the server-only admin client only for checkout/order reads. No grants, RLS policies or database rows were changed. Regression tests enforce these separate role boundaries.

Verified production code release: `0f90eda`, Vercel deployment `2DWD1oqMFvwi64pn2p6EFrMAaah8`. Live 30-day snapshot at verification: 462 visitors, 1,119 recorded sessions, 1,835 deduplicated page views, 13 prepared checkouts, one confirmed initial order and ₹7,000 paid revenue. Figures change as activity arrives. Today and 30-day APIs returned 200 with graph/card totals consistent and chronological funnel counts monotonic. Production HTML contained the responsive shell and updated funnel. This smoke check does not create a checkout/payment or establish the cause of the historical customer incident. Runtime logs remain unreviewed pending Vercel connection.
