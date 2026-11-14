-- Updates ONLY the three mustard listing image arrays. No stock/price/status changes.
BEGIN;
WITH media(code, url) AS (VALUES
    ('COOKING_MUSTARD_OIL', 'https://framerusercontent.com/images/aeT7g539YRFj1YrfPLJgo3dZu94.png'),
    ('GOURMET_MUSTARD_OIL', 'https://framerusercontent.com/images/fhh7KlfwQSrwWEsoTzaioJUrI.png'),
    ('FRYING_MUSTARD_OIL', 'https://framerusercontent.com/images/IrIzxn2uZKZTXOoX0VXzr8uIg.png')
)
UPDATE public.products AS p
SET metadata = jsonb_set(
    COALESCE(p.metadata, '{}'::jsonb), '{listing}',
    COALESCE(p.metadata->'listing', '{}'::jsonb) || jsonb_build_object(
        'images', jsonb_build_array(jsonb_build_object(
            'url', media.url, 'alt', p.name || ' bottle',
            'kind', 'photograph', 'position', 'center'
        ))
    )
), updated_at = now()
FROM media
WHERE p.code = media.code
  AND p.metadata#>>'{listing,category_id}' = 'mustard-oil'
RETURNING p.code, p.metadata#>'{listing,images}' AS updated_images;
COMMIT;
