# Shiprocket staging simulation implementation ledger

Approved scope: current user request; local implementation/testing only.
Frozen commerce authority, quote calculation, payment verification and canonical
communications remain unchanged. No deployment, remote writes, provider calls or
send bypass. Dirty staging workspace retained; pre-task copies under
`.codex/shiprocket-simulation-before/`.

- [x] Inspect existing kill switch, quote/serviceability, verified-payment hook,
  canonical ingest/workflows, API contracts, environment (nonsecret flags only).
- [x] Add opt-in fail-closed Preview/Test Mode config and contract-compatible
  serviceability; no fake courier, AWB or real delivery promises.
- [x] Narrow fulfillment branch and admin transition route; authenticated inbound
  real carrier block. Test first; no payment/pricing refactor.
- [x] Ordered local simulation migration, idempotent paid creation, audited strict
  transitions through canonical ingest, service-only privileges/worker isolation.
- [x] Actual quote/prepare/payment regression seams with provider networking forbidden.
- [x] Full tests/typecheck/lint/build and independent review; task-only diff/handoff.

Ruling: simulation is separate from the Shiprocket transport. It cannot authorize
provider HTTP. No new pickup capability is introduced; no pickup worker exists.
Ruling: simulated records use distinct provider STAGING_SIMULATION, private
simulation IDs and no AWB/carrier ID. Canonical statuses/rule evaluation remain.
Ruling: config must include exact staging identity, dry-run true, Test key and
explicit allowed pincodes. Disabled/invalid mode cannot silently become real.
Ruling: service-only DB context is trusted server infrastructure; no browser may
claim test payment state, pricing or shipment facts.

Review correction: the pre-existing money fingerprint omits simulation provenance.
New simulation-only comparison in checkout enters the existing QUOTE_CHANGED
replacement path for sim→live, live→sim or changed simulation pincode/project.
Three cases reproduced RED and now GREEN; ordinary live comparison is unchanged.
Final results: 74 new tests; npm test 504/51 PASS; typecheck PASS; changed/new
simulation files lint-clean except the same pre-existing checkout/webhook any
errors. Full lint remains84errors/47warnings; full build blocked by baseline lint.
Initial concurrent run had3known5s timeouts; exact full rerun without concurrent
lint/build passed. Independent review: no remaining Important findings.
