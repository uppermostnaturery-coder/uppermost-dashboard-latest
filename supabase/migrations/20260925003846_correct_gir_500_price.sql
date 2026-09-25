do $$
declare
  updated_variant_count integer;
begin
  update public.product_variants
  set
    price_paise = 375000,
    is_active = true,
    metadata = metadata - 'requires_price_configuration'
  where sku = 'GIR-500';

  get diagnostics updated_variant_count = row_count;

  if updated_variant_count <> 1 then
    raise exception
      'Expected to update 1 Uppermost GIR-500 variant, updated %',
      updated_variant_count;
  end if;
end
$$;
