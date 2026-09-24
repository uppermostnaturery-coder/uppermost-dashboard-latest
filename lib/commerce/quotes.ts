import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCommerceEnv } from "./env";
import { createPublicToken, requestHash, safeEqual, tokenHash } from "./crypto";
import { CommerceError } from "./http";
import type { CartLineInput, CartQuote } from "./types";

export const PRICING_VERSION = "commerce-v1";

export type QuoteSnapshot = {
  initial: CartQuote;
  recurring_groups: Array<{
    interval_days: number;
    quote: CartQuote;
    mandate_max_amount_paise: number;
  }>;
  shipping: Record<string, unknown>;
};

export type StoredQuote = {
  id: string;
  public_id: string;
  token_hash: string;
  guest_session_id: string | null;
  customer_id: string | null;
  cart_fingerprint: string;
  items: CartLineInput[];
  shipping_context: Record<string, unknown>;
  price_snapshot: QuoteSnapshot;
  pricing_version: string;
  promotion_version: string;
  status: "OPEN" | "CONSUMED" | "EXPIRED" | "REVOKED";
  valid_until: string;
  consumed_by_idempotency_key: string | null;
};

export function cartFingerprint(args: {
  guest_session_id: string;
  items: CartLineInput[];
  postal_code?: string;
}): string {
  return requestHash({
    guest_session_id: args.guest_session_id,
    postal_code: args.postal_code ?? null,
    items: [...args.items]
      .map((item) => ({ ...item, sku: item.sku.toUpperCase() }))
      .sort((left, right) => left.line_id.localeCompare(right.line_id)),
  });
}

export function quotePricingFingerprint(snapshot: QuoteSnapshot): string {
  return requestHash({
    initial: {
      items: snapshot.initial.items.map((item) => ({
        line_id: item.line_id,
        sku: item.sku,
        qty: item.qty,
        purchase_mode: item.purchase_mode,
        interval_days: item.interval_days ?? null,
        unit_price_paise: item.unit_price_paise,
        line_total_paise: item.line_total_paise,
      })),
      adjustments: snapshot.initial.adjustments,
      benefits: snapshot.initial.benefits,
      subtotal_paise: snapshot.initial.subtotal_paise,
      discount_paise: snapshot.initial.discount_paise,
      shipping_paise: snapshot.initial.shipping_paise,
      tax_paise: snapshot.initial.tax_paise,
      total_paise: snapshot.initial.total_paise,
    },
    recurring_groups: snapshot.recurring_groups.map((group) => ({
      interval_days: group.interval_days,
      items: group.quote.items.map((item) => ({
        line_id: item.line_id,
        sku: item.sku,
        qty: item.qty,
        unit_price_paise: item.unit_price_paise,
      })),
      adjustments: group.quote.adjustments,
      benefits: group.quote.benefits,
      total_paise: group.quote.total_paise,
      mandate_max_amount_paise: group.mandate_max_amount_paise,
    })),
    shipping: {
      serviceable: snapshot.shipping.serviceable ?? null,
      shipping_amount_paise: Number(snapshot.shipping.shipping_amount_paise ?? 0),
    },
  });
}

export async function persistQuote(args: {
  guestSessionId: string;
  items: CartLineInput[];
  postalCode?: string;
  snapshot: QuoteSnapshot;
  promotionVersion: string;
}) {
  const env = getCommerceEnv();
  const quoteId = createPublicToken("quo");
  const quoteToken = createPublicToken("qt");
  const validUntil = new Date(Date.now() + env.quoteTtlSeconds * 1000).toISOString();
  const fingerprint = cartFingerprint({
    guest_session_id: args.guestSessionId,
    items: args.items,
    postal_code: args.postalCode,
  });

  const { data, error } = await supabaseAdmin
    .from("commerce_quotes")
    .insert({
      public_id: quoteId,
      token_hash: tokenHash(quoteToken, env.tokenPepper),
      guest_session_id: args.guestSessionId,
      cart_fingerprint: fingerprint,
      items: args.items,
      shipping_context: {
        postal_code: args.postalCode ?? null,
        ...args.snapshot.shipping,
      },
      price_snapshot: args.snapshot,
      pricing_version: PRICING_VERSION,
      promotion_version: args.promotionVersion,
      valid_until: validUntil,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Quote persistence failed: ${error?.message}`);
  return { internalId: data.id as string, quoteId, quoteToken, validUntil, fingerprint };
}

export async function loadQuote(publicId: string): Promise<StoredQuote | null> {
  const { data, error } = await supabaseAdmin
    .from("commerce_quotes")
    .select(
      "id, public_id, token_hash, guest_session_id, customer_id, cart_fingerprint, items, shipping_context, price_snapshot, pricing_version, promotion_version, status, valid_until, consumed_by_idempotency_key"
    )
    .eq("public_id", publicId)
    .maybeSingle();
  if (error) throw new Error(`Quote lookup failed: ${error.message}`);
  return data as StoredQuote | null;
}

export type QuoteValidationCode =
  | "VALID"
  | "INVALID_QUOTE"
  | "QUOTE_EXPIRED"
  | "QUOTE_CONSUMED"
  | "QUOTE_REVOKED"
  | "QUOTE_CONTEXT_MISMATCH";

export function validateQuoteRecord(args: {
  quote: StoredQuote | null;
  token: string;
  guestSessionId: string;
  fingerprint?: string;
  now?: Date;
}): QuoteValidationCode {
  if (!args.quote) return "INVALID_QUOTE";
  const suppliedHash = tokenHash(args.token, getCommerceEnv().tokenPepper);
  if (!safeEqual(suppliedHash, args.quote.token_hash)) return "INVALID_QUOTE";
  if (args.quote.guest_session_id !== args.guestSessionId) return "QUOTE_CONTEXT_MISMATCH";
  if (args.fingerprint && args.quote.cart_fingerprint !== args.fingerprint) {
    return "QUOTE_CONTEXT_MISMATCH";
  }
  if (args.quote.status === "CONSUMED") return "QUOTE_CONSUMED";
  if (args.quote.status === "REVOKED") return "QUOTE_REVOKED";
  if (
    args.quote.status === "EXPIRED" ||
    new Date(args.quote.valid_until).getTime() <= (args.now ?? new Date()).getTime()
  ) {
    return "QUOTE_EXPIRED";
  }
  return "VALID";
}

export function assertValidQuote(code: QuoteValidationCode): void {
  if (code === "VALID") return;
  if (code === "QUOTE_EXPIRED") {
    throw new CommerceError("QUOTE_EXPIRED", "This quote has expired.", 409);
  }
  if (code === "QUOTE_CONSUMED") {
    throw new CommerceError("QUOTE_CONSUMED", "This quote has already been used.", 409);
  }
  if (code === "QUOTE_REVOKED") {
    throw new CommerceError("INVALID_QUOTE", "This quote is no longer valid.", 409);
  }
  throw new CommerceError("INVALID_QUOTE", "Quote validation failed.", 400);
}
