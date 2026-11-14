# Category storefront release — 14 November 2026

Owner authorized final frontend/backend Git main pushes and explicitly excluded staging. Framer production merge/publication remains owner-operated.

The backend adds only the allowlisted optional `listing.unit_price_per_litre_paise` map. It is display metadata for category cards, not a price authority. Unfiltered BuyBox, quotes, inventory, payment and fulfilment behavior remain unchanged.

## Production data readback

Read-only production database checks on 14 November confirmed all nine products and eighteen variants exist with the approved prices. Community ghee, oils and pickles remain inactive / inventory_quantity=0; no activation or stock write was performed. Mustard 5 L per-litre metadata is already stored: Cooking 85000, Gourmet 105000, Frying 65000 paise.

No schema migration is introduced by this release. The category insert script has already been applied manually by the owner; do not rerun the older category seed merely because its filename is absent from migration history. Some historical SQL was owner-applied without matching migration history entries; the history alone is not proof it is pending.

One requested data update remains pending: [mustard-oil-images.sql](mustard-oil-images.sql). Production still points to the older combined mustard photo; this transaction replaces only the three products' listing image arrays with the individual approved Framer photo URLs. It does not change prices, stock, activation or other metadata. Owner can run it in the Production SQL Editor before publishing Framer. It has NOT been executed by the agent.

New oil/pickle parcel dimensions inherited ghee placeholders at the owner's request. Keep these products unavailable until real fulfilment measurements and activation are intentionally configured.

## Validation

`npm run typecheck`, 153 tests and `npm run build` passed. The first build lacked local Supabase variables; the successful build used nonsecret example.supabase.co build-only placeholders, without contacting production or changing deployment variables. No real order/payment was created. Production CORS remains restricted to the existing allowed origins; staging configuration is unchanged.
