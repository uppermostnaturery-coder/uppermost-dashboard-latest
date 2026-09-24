import { assertInventory, loadCatalogVariants } from "./catalog";
import { getCommerceEnv } from "./env";
import { loadActivePromotions, loadPromotionEntitlements, promotionVersion } from "./promotions";
import { calculateCartQuote, calculateMandateMaxAmount } from "./pricing/calculateCartQuote";
import { getShiprocketServiceability } from "./shiprocket/client";
import type { CartLineInput } from "./types";

export async function buildAuthoritativeQuote(args: {
  items: CartLineInput[];
  postalCode?: string;
  now?: string;
  customerId?: string;
  isFirstOrder?: boolean;
  isNewSubscriber?: boolean;
}) {
  const now = args.now ?? new Date().toISOString();
  const catalog = await loadCatalogVariants(args.items.map((item) => item.sku));
  assertInventory(args.items, catalog);
  const [promotions, entitlements] = await Promise.all([
    loadActivePromotions(now),
    loadPromotionEntitlements({ customerId: args.customerId, now }),
  ]);

  const provisional = calculateCartQuote({
    items: args.items,
    catalog,
    promotions,
    entitlements,
    context: {
      stage: "INITIAL",
      now,
      cycle_number: 1,
      customer_id: args.customerId,
      is_new_subscriber: args.isNewSubscriber ?? true,
      is_first_order: args.isFirstOrder ?? true,
      is_returning_customer: args.isFirstOrder === false,
      shipping_country: "IN",
    },
  });

  let shipping: Record<string, unknown> = {
    serviceable: args.postalCode ? false : null,
    estimated_delivery_from: null,
    estimated_delivery_to: null,
    shipping_amount_paise: 0,
    message: args.postalCode
      ? "Delivery availability could not be confirmed."
      : "Enter a pincode to check delivery.",
  };

  if (args.postalCode) {
    try {
      shipping = await getShiprocketServiceability({
        postalCode: args.postalCode,
        items: provisional.items,
        declaredValuePaise: provisional.total_paise,
      });
    } catch (error) {
      console.error("Shiprocket serviceability unavailable:", error);
    }
  }

  const initial = calculateCartQuote({
    items: args.items,
    catalog,
    promotions,
    entitlements,
    context: {
      stage: "INITIAL",
      now,
      cycle_number: 1,
      customer_id: args.customerId,
      is_new_subscriber: args.isNewSubscriber ?? true,
      is_first_order: args.isFirstOrder ?? true,
      is_returning_customer: args.isFirstOrder === false,
      shipping_country: "IN",
    },
    shipping_paise: Number(shipping.shipping_amount_paise ?? 0),
  });

  const subscriptionItems = args.items.filter(
    (item) => item.purchase_mode === "SUBSCRIPTION"
  );
  const recurringGroups = [];
  if (subscriptionItems.length > 0) {
    const intervalDays = subscriptionItems[0].interval_days!;
    const recurringQuote = calculateCartQuote({
      items: subscriptionItems,
      catalog,
      promotions,
      entitlements,
      context: {
        stage: "RENEWAL",
        now,
        cycle_number: 2,
        customer_id: args.customerId,
        is_new_subscriber: false,
        is_first_order: false,
        is_returning_customer: true,
        shipping_country: "IN",
      },
    });
    recurringGroups.push({
      interval_days: intervalDays,
      quote: recurringQuote,
      mandate_max_amount_paise: calculateMandateMaxAmount(
        initial.total_paise,
        recurringQuote.total_paise,
        getCommerceEnv().mandateBufferPaise
      ),
    });
  }

  return {
    catalog,
    promotions,
    promotionVersion: promotionVersion(promotions),
    snapshot: {
      initial,
      recurring_groups: recurringGroups,
      shipping,
    },
  };
}
