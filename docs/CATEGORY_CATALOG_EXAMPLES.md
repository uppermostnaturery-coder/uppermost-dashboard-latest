# Category catalog requests, responses and loading behavior

Status: local code implemented, not deployed. The localhost:61962 design preview intercepts commerce requests and serves the attached fixture responses. They were generated through the actual backend `buildPublicCatalogResponse` function using a catalog snapshot and preview product inputs. They are **not captures of production HTTP responses or evidence of seeded database rows**. Product IDs in fixtures are stand-ins; deployed responses use existing database product IDs.

## Requests

The existing endpoint accepts exactly one supported category ID:

```http
GET /api/commerce/catalog?category_id=ghee
GET /api/commerce/catalog?category_id=mustard-oil
GET /api/commerce/catalog?category_id=pickles
```

No request body or new auth mechanism is introduced. Public API origin currently configured in the frontend is `https://uppermost-dashboard-latest-orcin.vercel.app`; category support at that origin has not been deployed by this work. `GET /api/commerce/catalog` retains the existing BuyBox response shape. Invalid/blank/repeated category IDs return HTTP 400 with `INVALID_CATEGORY`.

Runnable request examples, against a backend running this branch: [requests.http](examples/category-catalog/requests.http).

## When data is loaded

| Interaction | API behavior | Data shown or used |
|---|---|---|
| Homepage opens | No category catalog request for the three homepage tiles | Static category names, images, links and current brand text |
| Category page opens or category changes | One `GET /api/commerce/catalog?category_id=…` | Matching products, primary images, names, origin, badge, description, tags, detail links, sizes/SKUs, paise prices, availability and cart limits |
| Card before hover | Uses that initial response | Primary image, origin, title, default/selected price and size, badge, size buttons, details/Add controls |
| Card hover | **No new API request** | Reveals tags and description already loaded; animates the existing primary image. It does not request a second product image |
| Size changes | No new catalog request | Selects a returned variant; updates price, sellability, cart limit and existing Gir/Murrah `/ghee?sku=…` destination |
| Know more (non-Gir/Murrah) | No new catalog request | Uses the same description and detail URL; uses `images[1]` when supplied, otherwise `images[0]`. The browser may download that image file when the drawer opens |
| Know more (Gir/Murrah) | Existing external page navigation | Opens the unchanged live `/ghee` destination with the selected SKU |
| Cart first opens | Drawer loads each of the three category catalogs once, then caches successful display metadata in memory | Correct names, images, sizes and grouping for legacy and new SKUs; it no longer assumes an unfamiliar SKU is Gir |
| Add/cart intent changes | Existing quote flow | Sends SKU, quantity and purchase intent to the existing quote API; displayed prices are never checkout authority |

The static page chrome (logo, navigation, heading, background/effects and footer) is not returned by the catalog API. Images are files referenced by API URLs, not image bytes embedded in JSON. Local preview quotes are synthetic and payments/preparation are disabled; real quote/payment behavior has not been exercised against production in this preview.

## Full example responses

- [Ghee — four products](examples/category-catalog/ghee.preview-response.json)
- [Mustard Oil — three products](examples/category-catalog/mustard-oil.preview-response.json)
- [Pickles — two coming-soon products](examples/category-catalog/pickles.preview-response.json)

All amounts are integer paise: `750000` means ₹7,500. Unavailable variants have `sellable: false` and `max_cart_quantity: 0`. New products in these review fixtures are inactive. The fixture prices and counts do not establish production database contents. The insert-only migration still needs real fulfilment measurements, unapproved prices/sizes and intentional activation before use.

For field definitions and compatibility rules see [FRAMER_COMMERCE_CONTRACT.md](FRAMER_COMMERCE_CONTRACT.md) and [FRAMER_COMMERCE_TYPES.ts](FRAMER_COMMERCE_TYPES.ts).

## Production code release — 1 November 2026

The user reviewed the summary/diff and explicitly approved backend code deployment only. Commit `96a13ba8c5a7f143914aa3d2ccc61c21bf73a2e9` was pushed to backend main and deployed to Vercel production as `dpl_DP4AQbzbXqscY8987xXvAR34Xgij` (READY). Production alias: https://uppermost-dashboard-latest-orcin.vercel.app. Typecheck, 152 tests and production build passed before release. Read-only smoke checks returned 200 for all three category queries and unfiltered catalog, with 400 INVALID_CATEGORY for unknown. The unfiltered response retained its old fields. Catalog-route runtime error lookup returned no errors for the selected recent window. No payment/order was created.

The insert-only seed was not executed. Therefore production Ghee currently contains Gir/Murrah; Mustard Oil and Pickles currently return empty arrays. Framer’s isolated design review still uses fixtures to show the unseeded products. Framer main, live storefront, staging configuration and environment variables were not changed by this backend release. Earlier preparation-only wording in these documents is historical and superseded by this release note.

Actual read-only production captures from the deployed code, 1 November 2026: [Ghee](examples/category-catalog/ghee.production-response-2026-11-01.json), [Mustard Oil](examples/category-catalog/mustard-oil.production-response-2026-11-01.json), [Pickles](examples/category-catalog/pickles.production-response-2026-11-01.json). These are separate from the design fixtures above and show the currently unseeded production state.
