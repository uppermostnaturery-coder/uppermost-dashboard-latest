# Uppermost repository rules

## Frozen commerce architecture

- `docs/UPPERMOST_COMMERCE_ARCHITECTURE.md` is the frozen source of truth for commerce architecture.
- Read it completely before changing commerce behavior. If a request conflicts with it, stop and identify the conflict. Update the architecture document first if the business intentionally changes architecture.
- Framer owns visible commerce UI. This repository owns authoritative pricing, promotions, quotes, checkout, payments, subscriptions, fulfilment, tracking, webhooks, and customer-safe state.
- Supabase is the commerce source of truth. Keep RLS enabled and commerce tables inaccessible to `anon` and `authenticated`; public access goes through validated server routes.

## Non-negotiable commerce invariants

- Never trust client prices, totals, inventory measurements, shipping dimensions, promotion eligibility, or quote IDs by themselves.
- Use integer paise; public money fields end in `_paise`.
- Purchase mode belongs to each cart line. Initial checkout contains all lines; renewal contains subscription lines only. V1 permits one common interval per checkout.
- Use `lib/commerce/pricing/calculateCartQuote.ts` for initial and renewal pricing.
- Validate quote token, binding, status, lifetime, and authoritative reprice. Never silently charge a changed quote.
- Require durable `Idempotency-Key` handling on money-changing browser endpoints. Provider events and cycles must also be unique.
- Use Razorpay Orders, Customers, UPI AutoPay mandates, and recurring tokens. Never introduce Razorpay Plans or Razorpay Subscriptions; Uppermost owns scheduling.
- Do not fulfil until payment is final. A subscription is active only when the initial payment is captured and a usable recurring token exists.
- Return normalized states and centralized messages, not raw provider errors.
- Never put secrets, full addresses, tokens, or sensitive identity data in provider notes or public experience responses.
- Create Shiprocket shipments only after payment confirmation.
- Keep all provider secrets, Shopify Admin tokens, token pepper, cron secret, and Supabase service role server-side.

## Change discipline

- Preserve analytics and lead integrations. Do not refactor unrelated dashboard code.
- Database changes require an ordered migration in `supabase/migrations`.
- Add focused tests for pricing, quote security, idempotency, webhook deduplication, and renewals.
- Run `npm run typecheck`, `npm test`, and `npm run build` before handoff. Run lint where configuration supports it.
