do $$
declare
  updated_variant_count integer;
begin
  update public.product_variants
  set
    price_paise = case sku
      when 'GIR-500' then 380000
      when 'MURRAH-500' then 300000
    end,
    is_active = true,
    metadata = metadata - 'requires_price_configuration'
  where sku in ('GIR-500', 'MURRAH-500');

  get diagnostics updated_variant_count = row_count;

  if updated_variant_count <> 2 then
    raise exception
      'Expected to activate 2 Uppermost 500 ml variants, updated %',
      updated_variant_count;
  end if;
end
$$;
