do $$
declare
  configured_variant_count integer;
  configured_capacity integer;
begin
  insert into public.product_variant_releases (
    product_variant_id,
    release_code,
    release_label,
    status,
    release_capacity,
    release_committed,
    low_stock_threshold,
    starts_at,
    metadata
  )
  select
    variant.id,
    'LAUNCH_2026',
    'Uppermost launch release',
    'ACTIVE',
    allocation.release_capacity,
    0,
    10,
    now(),
    jsonb_build_object(
      'source', 'confirmed_launch_allocation',
      'expression', allocation.expression,
      'size_ml', allocation.size_ml
    )
  from (
    values
      ('GIR-1000', 80, 'GIR', 1000),
      ('GIR-500', 40, 'GIR', 500),
      ('MURRAH-1000', 80, 'MURRAH', 1000),
      ('MURRAH-500', 40, 'MURRAH', 500)
  ) as allocation(sku, release_capacity, expression, size_ml)
  join public.product_variants variant on variant.sku = allocation.sku
  on conflict (product_variant_id, release_code) do update set
    release_label = excluded.release_label,
    status = excluded.status,
    release_capacity = excluded.release_capacity,
    low_stock_threshold = excluded.low_stock_threshold,
    starts_at = coalesce(public.product_variant_releases.starts_at, excluded.starts_at),
    ends_at = null,
    metadata = public.product_variant_releases.metadata || excluded.metadata,
    updated_at = now();

  select count(*), sum(release_capacity)
  into configured_variant_count, configured_capacity
  from public.product_variant_releases release
  join public.product_variants variant on variant.id = release.product_variant_id
  where release.release_code = 'LAUNCH_2026'
    and variant.sku in ('GIR-1000', 'GIR-500', 'MURRAH-1000', 'MURRAH-500');

  if configured_variant_count <> 4 or configured_capacity <> 240 then
    raise exception
      'Expected four launch allocations totalling 240 jars; found % variants and % jars',
      configured_variant_count,
      configured_capacity;
  end if;
end
$$;
