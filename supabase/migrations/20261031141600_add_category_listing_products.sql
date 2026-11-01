-- INSERT-ONLY template. Not applied by this implementation.
-- Existing Gir/Murrah rows, prices, SKUs, promotions and RLS are untouched.
-- Edit the product rows below and the size rows in the second block BEFORE first application.
-- New rows default inactive. Set active/inventory only after real price, shipping measurements,
-- media and fulfilment configuration are approved. Missing variant configuration is skipped.
-- Reruns insert missing rows only; they never overwrite or activate an existing row.
BEGIN;

INSERT INTO public.products (code, name, product_family, description, is_active, metadata)
VALUES
  ('MANGO_PICKLE', 'Atlas Jar · Mango', 'atlas-mango', 'A closer look at the ingredients behind Atlas Pickle Jar: mangoes, glue berries and the decisions made before a jar is filled.', false, '{"listing": {"category_id": "pickles", "images": [{"url": "/catalog/mango-pickle-2.jpg", "alt": "Uppermost Mango Pickle jar photographed in the grass", "kind": "photograph"}, {"url": "/catalog/mango-pickle-1.jpg", "alt": "Uppermost Mango Pickle jar on a wooden surface", "kind": "photograph"}], "tags": ["Ramkela Mango", "15 Spices", "Cold-Pressed Mustard Oil", "Native Origins"], "badge": "Coming soon", "origin": "Atlas Jar", "detail_url": "/files/uppermost-standard.html#chapter-3", "coming_soon": true, "max_cart_quantity": 1, "display_order": 0}}'::jsonb),
  ('LEMON_PICKLE', 'Atlas Jar · Lemon', 'atlas-lemon', 'A closer look at the ingredients behind Atlas Pickle Jar: mangoes, glue berries and the decisions made before a jar is filled.', false, '{"listing": {"category_id": "pickles", "images": [], "tags": ["Kagzi Lemon", "19 Spices", "Oil-Free", "Native Origins"], "badge": "Coming soon", "origin": "Atlas Jar", "detail_url": "/files/uppermost-standard.html#chapter-3", "coming_soon": true, "max_cart_quantity": 1, "display_order": 1}}'::jsonb),
  ('COOKING_MUSTARD_OIL', 'Cooking Mustard Oil', 'cooking', 'Early-harvest black mustard, cold-pressed once in a wooden kohlu. Bold and pungent — for tadka, sautéing and pickles.', false, '{"listing": {"category_id": "mustard-oil", "images": [{"url": "/catalog/mustard-studio-light.webp", "alt": "Cooking Mustard Oil", "kind": "photograph", "position": "left"}], "tags": ["Black Mustard", "Early Harvest", "Up to 150°C", "Wood Kohlu"], "badge": "1 farm in 100", "origin": "Aravali, Rajasthan", "detail_url": "/files/uppermost-standard.html#chapter-5", "coming_soon": false, "max_cart_quantity": 1, "display_order": 0}}'::jsonb),
  ('GOURMET_MUSTARD_OIL', 'Gourmet Mustard Oil', 'gourmet', 'Early-harvest yellow mustard, cold-pressed once in a wooden kohlu. Mild and light — for dressings, drizzles and gentle sautéing.', false, '{"listing": {"category_id": "mustard-oil", "images": [{"url": "/catalog/mustard-studio-light.webp", "alt": "Gourmet Mustard Oil", "kind": "photograph", "position": "center"}], "tags": ["Yellow Mustard", "Early Harvest", "Up to 140°C", "Wood Kohlu"], "badge": "1 farm in 100", "origin": "Aravali, Rajasthan", "detail_url": "/files/uppermost-standard.html#chapter-3", "coming_soon": false, "max_cart_quantity": 1, "display_order": 1}}'::jsonb),
  ('FRYING_MUSTARD_OIL', 'Frying Mustard Oil', 'frying', 'Late-harvest, fully ripened black mustard, cold-pressed once in a wooden kohlu. Mild, with a smoke point up to 190°C — for deep frying and high heat.', false, '{"listing": {"category_id": "mustard-oil", "images": [{"url": "/catalog/mustard-studio-light.webp", "alt": "Frying Mustard Oil", "kind": "photograph", "position": "right"}], "tags": ["Black Mustard", "Late Harvest", "Up to 190°C", "Wood Kohlu"], "badge": "1 farm in 100", "origin": "Aravali, Rajasthan", "detail_url": "/files/uppermost-standard.html#chapter-5", "coming_soon": false, "max_cart_quantity": 1, "display_order": 2}}'::jsonb),
  ('COMMUNITY_COW_GHEE', 'A2 Desi Cow Ghee', 'desi-cow', 'A2 Desi cow ghee from partner farms we know by name. Every batch tested for A2 protein.', false, '{"listing": {"category_id": "ghee", "images": [{"url": "/catalog/gir-calf.webp", "alt": "A newborn calf in the Uppermost farm archive", "kind": "photograph"}], "tags": ["Desi Cow", "A2 Tested", "Bilona", "Free Grazed"], "badge": null, "origin": "Community Farms", "detail_url": "/files/uppermost-standard.html#chapter-2", "coming_soon": false, "max_cart_quantity": 1, "display_order": 2}}'::jsonb),
  ('COMMUNITY_BUFFALO_GHEE', 'A2 Desi Buffalo Ghee', 'desi-buffalo', 'A2 Desi buffalo ghee from partner farms we know by name. Every batch tested for A2 protein.', false, '{"listing": {"category_id": "ghee", "images": [{"url": "/catalog/buffalo.webp", "alt": "A Murrah buffalo in the Uppermost farm archive", "kind": "photograph"}], "tags": ["Desi Buffalo", "A2 Tested", "Bilona", "Free Grazed"], "badge": null, "origin": "Community Farms", "detail_url": "/files/uppermost-standard.html", "coming_soon": false, "max_cart_quantity": 1, "display_order": 3}}'::jsonb)
ON CONFLICT (code) DO NOTHING;

-- Add product size rows here. Price is INTEGER PAISE. NULL means not configured.
-- Shipping weight/dimensions must be measured, not guessed. A row with NULL fields is not inserted.
-- Pickle sizes/prices are not approved yet; add their rows once confirmed.
WITH sizes (product_code, sku, name, size_label, price_paise, weight_grams,
            length_cm, breadth_cm, height_cm, inventory_quantity, is_active) AS (
  VALUES
    ('COMMUNITY_COW_GHEE', 'COMMUNITY-COW-1000', 'A2 Desi Cow Ghee 1 L', '1 L', 410000::bigint, NULL::integer, NULL::numeric, NULL::numeric, NULL::numeric, 0, false),
    ('COMMUNITY_COW_GHEE', 'COMMUNITY-COW-500', 'A2 Desi Cow Ghee 500 ml', '500 ml', 215000, NULL, NULL, NULL, NULL, 0, false),
    ('COMMUNITY_BUFFALO_GHEE', 'COMMUNITY-BUFFALO-1000', 'A2 Desi Buffalo Ghee 1 L', '1 L', 300000, NULL, NULL, NULL, NULL, 0, false),
    ('COMMUNITY_BUFFALO_GHEE', 'COMMUNITY-BUFFALO-500', 'A2 Desi Buffalo Ghee 500 ml', '500 ml', 160000, NULL, NULL, NULL, NULL, 0, false),
    ('COOKING_MUSTARD_OIL', 'MUSTARD-COOKING-1000', 'Cooking Mustard Oil 1 L', '1 L', NULL, NULL, NULL, NULL, NULL, 0, false),
    ('GOURMET_MUSTARD_OIL', 'MUSTARD-GOURMET-1000', 'Gourmet Mustard Oil 1 L', '1 L', NULL, NULL, NULL, NULL, NULL, 0, false),
    ('GOURMET_MUSTARD_OIL', 'MUSTARD-GOURMET-5000', 'Gourmet Mustard Oil 5 L tin', '5 L tin', NULL, NULL, NULL, NULL, NULL, 0, false),
    ('FRYING_MUSTARD_OIL', 'MUSTARD-FRYING-1000', 'Frying Mustard Oil 1 L', '1 L', NULL, NULL, NULL, NULL, NULL, 0, false)
)
INSERT INTO public.product_variants
  (product_id, sku, name, size_label, price_paise, weight_grams, length_cm, breadth_cm,
   height_cm, inventory_quantity, inventory_policy, is_active, metadata)
SELECT p.id, s.sku, s.name, s.size_label, s.price_paise, s.weight_grams,
       s.length_cm, s.breadth_cm, s.height_cm, s.inventory_quantity, 'SUPABASE', s.is_active,
       '{"max_cart_quantity":1}'::jsonb
FROM sizes s JOIN public.products p ON p.code = s.product_code
WHERE s.price_paise IS NOT NULL AND s.weight_grams IS NOT NULL
  AND s.length_cm IS NOT NULL AND s.breadth_cm IS NOT NULL AND s.height_cm IS NOT NULL
ON CONFLICT (sku) DO NOTHING;
COMMIT;
