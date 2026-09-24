import type { QuoteSnapshot } from "./quotes";

export function publicQuoteShape(args: {
  quoteId: string;
  quoteToken: string;
  validUntil: string;
  snapshot: QuoteSnapshot;
}) {
  const { initial, recurring_groups: recurringGroups, shipping } = args.snapshot;
  return {
    ok: true,
    quote_id: args.quoteId,
    quote_token: args.quoteToken,
    currency: initial.currency,
    valid_until: args.validUntil,
    items: initial.items,
    promotions: initial.adjustments.map((adjustment) => ({
      promotion_id: adjustment.promotion_id,
      code: adjustment.code,
      label: adjustment.label,
      type: adjustment.type,
      amount_paise: adjustment.amount_paise,
      scope: "INITIAL",
      applies_to_line_ids: adjustment.applies_to_line_ids,
    })),
    benefits: initial.benefits,
    initial: {
      subtotal_paise: initial.subtotal_paise,
      discount_paise: initial.discount_paise,
      shipping_paise: initial.shipping_paise,
      tax_paise: initial.tax_paise,
      total_paise: initial.total_paise,
    },
    recurring_groups: recurringGroups.map((group) => ({
      interval_days: group.interval_days,
      items: group.quote.items,
      projected_subtotal_paise: group.quote.subtotal_paise,
      projected_discount_paise: group.quote.discount_paise,
      projected_total_paise: group.quote.total_paise,
      mandate_max_amount_paise: group.mandate_max_amount_paise,
    })),
    shipping: {
      serviceable: shipping.serviceable ?? null,
      estimated_delivery_from: shipping.estimated_delivery_from ?? null,
      estimated_delivery_to: shipping.estimated_delivery_to ?? null,
      ...(shipping.best_courier_internal_reference
        ? { best_courier_internal_reference: shipping.best_courier_internal_reference }
        : {}),
      shipping_amount_paise: Number(shipping.shipping_amount_paise ?? 0),
      display: shipping.message ?? "Delivery details are unavailable.",
    },
  };
}

