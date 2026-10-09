# Offers administration

Offers is a separate dashboard entry managing the existing `promotions` table. Only verified active ADMIN memberships can mutate. VIEWERs can list/history/simulate. Cookie mutations require same origin. There is no new pricing engine and no destructive delete endpoint.

The form mirrors actual PromotionConditions and PromotionActions: SKU/product scope, country, purchase mode, interval, initial/renewal stage, cycles/customer type, percentage/fixed/free-shipping/benefit actions, priority, stacking/group, usage limit and validity. Active/Scheduled views derive dates from existing statuses; they do not invent new engine states. Pause/resume/archive/clone are versioned edits. usage_count is commerce-owned and never browser-editable. Advanced benefit metadata remains available through the validated API rather than a free-form primary editor.

Server simulation uses `lib/commerce/pricing/calculateCartQuote.ts` with actual catalog/promotions. Inputs are SKU, quantity, purchase mode, interval, INITIAL/RENEWAL, cycle, customer type and country. Results contain eligible/rejected promotions with reasons, adjustments/benefits and paise totals. Simulated shipping defaults to the provided test context; production checkout serviceability/shipping, customer entitlements and usage accounting remain authoritative. Simulating an unsaved draft treats that candidate as active for the test; it does not publish it.

Each save takes expected_version and records an immutable promotion_versions snapshot, actor and reason. A stale editor gets HTTP 409 PROMOTION_VERSION_CONFLICT; reload before retrying. The first edit of an old offer stores a baseline snapshot. Existing order/pricing snapshots are never rewritten. Version history disallows update/delete even for service-role operations.

The list is currently capped at 500 offers and history at 100 records. Add further pagination before catalogs exceed that operational bound. Enable real promotion edits only after testing the existing quote/checkout paths in staging; production discount behavior changes only through the existing authoritative engine.
