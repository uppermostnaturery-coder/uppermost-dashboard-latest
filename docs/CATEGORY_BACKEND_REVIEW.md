# Backend approval review — 1 November 2026

Status: prepared locally on `feat/category-catalog-listings`. No deployment, remote push, or database execution has occurred.

| Change | Result | Files |
|---|---|---|
| Optional category filter on existing GET catalog | `category_id=ghee`, `mustard-oil`, `pickles`; invalid/empty/repeated values return 400 | `app/api/commerce/catalog/route.ts` |
| Public card projection | Returns identity, category, images, description, tags/badge, origin, sizes/SKUs, paise prices, availability, display order and quantity limits | `lib/commerce/publicCatalog.ts`, new `listing.ts` |
| Existing BuyBox compatibility | Calls without category_id retain their existing response fields; existing SKU/product keys are preserved | `publicCatalog.ts` + compatibility tests |
| Cart enforcement | Aggregates quantities across split lines and different sizes of one product; inactive/coming-soon products cannot pass catalog validation | new `cartLimits.ts`, `catalog.ts`, pricing engine and types |
| Public media | Five existing approved product photos bundled under `/catalog/`; no private storage access or client secrets | `public/catalog/` |
| Insert-only seed template | Seven new products: two Community ghees, three mustard oils, Mango and Lemon. New rows inactive; incomplete variant rows skipped. No updates/deletes/schema/RLS changes | `supabase/migrations/20261031141600_add_category_listing_products.sql` |
| Documentation | API contract, public response types, architecture and full fixture examples updated and synchronized to frontend | `docs/` |

## Approval scope

Backend **code deployment** and **database seed execution** are separate actions. Code can be deployed without applying the seed: category requests would initially return existing Gir/Murrah only for Ghee, with empty new-product categories until configured rows exist. The local/Framer design preview can continue using explicitly labelled fixtures during review.

The migration is not ready to execute unchanged: it deliberately leaves real shipping measurements and unapproved oil/pickle prices/sizes unset. Known Community prices are 4100/2150 and 3000/1600 rupees. All new products default inactive; stock defaults zero. Do not invent measurements, activate products or convert temporary preview oil prices into production prices. Fill the template before its first approved application. Re-running only inserts missing rows; it cannot activate/overwrite prior rows.

## Compatibility / operational effect to review

The catalog endpoint keeps its CORS/rate limit/cache behavior. Existing quote/payment/provider integrations are reused. Server-side product/SKU cart limits apply to all carts, including existing BuyBox requests; Gir/Murrah default to one jar per product per cart. This is not a lifetime/household purchase limit. New products default to 20 unless configured; seed rows explicitly use one. No payment, subscription, promotion or shipping-provider API is replaced.

## Validation already completed

- `npm run typecheck`: passed.
- `npm test`: 25 files / 152 tests passed.
- `npm run build`: passed with dummy local Supabase configuration.
- Category isolation, old wire-shape compatibility, metadata allowlisting and split-line/size quantity-limit tests passed.
- No real order/payment was created and no production database write was used to establish these results.

[Runtime + migration patch](CATEGORY_BACKEND_REVIEW.patch). [Request/response examples](CATEGORY_CATALOG_EXAMPLES.md). [Full contract](FRAMER_COMMERCE_CONTRACT.md).

## Production code release — 1 November 2026

The user reviewed the summary/diff and explicitly approved backend code deployment only. Commit `96a13ba8c5a7f143914aa3d2ccc61c21bf73a2e9` was pushed to backend main and deployed to Vercel production as `dpl_DP4AQbzbXqscY8987xXvAR34Xgij` (READY). Production alias: https://uppermost-dashboard-latest-orcin.vercel.app. Typecheck, 152 tests and production build passed before release. Read-only smoke checks returned 200 for all three category queries and unfiltered catalog, with 400 INVALID_CATEGORY for unknown. The unfiltered response retained its old fields. Catalog-route runtime error lookup returned no errors for the selected recent window. No payment/order was created.

The insert-only seed was not executed. Therefore production Ghee currently contains Gir/Murrah; Mustard Oil and Pickles currently return empty arrays. Framer’s isolated design review still uses fixtures to show the unseeded products. Framer main, live storefront, staging configuration and environment variables were not changed by this backend release. Earlier preparation-only wording in these documents is historical and superseded by this release note.
