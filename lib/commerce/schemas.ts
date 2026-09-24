import { z } from "zod";

export const cartLineSchema = z
  .object({
    line_id: z.string().trim().min(1).max(100),
    sku: z.string().trim().min(2).max(100).transform((value) => value.toUpperCase()),
    qty: z.number().int().min(1).max(20),
    purchase_mode: z.enum(["BUY_ONCE", "SUBSCRIPTION"]),
    interval_days: z.union([z.literal(15), z.literal(30), z.literal(60)]).optional(),
  })
  .superRefine((line, context) => {
    if (line.purchase_mode === "SUBSCRIPTION" && !line.interval_days) {
      context.addIssue({
        code: "custom",
        path: ["interval_days"],
        message: "interval_days is required for subscription lines.",
      });
    }
    if (line.purchase_mode === "BUY_ONCE" && line.interval_days !== undefined) {
      context.addIssue({
        code: "custom",
        path: ["interval_days"],
        message: "interval_days is only valid for subscription lines.",
      });
    }
  });

export const cartLinesSchema = z
  .array(cartLineSchema)
  .min(1)
  .max(20)
  .superRefine((items, context) => {
    const lineIds = new Set<string>();
    const intervals = new Set<number>();
    for (const item of items) {
      if (lineIds.has(item.line_id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate line_id: ${item.line_id}`,
        });
      }
      lineIds.add(item.line_id);
      if (item.purchase_mode === "SUBSCRIPTION" && item.interval_days) {
        intervals.add(item.interval_days);
      }
    }
    if (intervals.size > 1) {
      context.addIssue({
        code: "custom",
        message: "All subscription lines must use one common interval in V1.",
      });
    }
  });

export const postalCodeSchema = z.string().trim().regex(/^[0-9]{6}$/);

export const quoteRequestSchema = z.object({
  guest_session_id: z.string().trim().min(8).max(200),
  items: cartLinesSchema,
  postal_code: postalCodeSchema.optional(),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().trim().toLowerCase().email().max(320),
  phone: z.string().trim().regex(/^\+?[1-9][0-9]{7,14}$/),
});

export const addressSchema = z.object({
  line1: z.string().trim().min(3).max(240),
  line2: z.string().trim().max(240).optional().nullable(),
  landmark: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().min(2).max(120),
  state: z.string().trim().min(2).max(120),
  postal_code: postalCodeSchema,
  country: z.literal("IN"),
});

export const checkoutPrepareSchema = z.object({
  guest_session_id: z.string().trim().min(8).max(200),
  quote_id: z.string().trim().min(10).max(160),
  quote_token: z.string().trim().min(32).max(300),
  customer: customerSchema,
  shipping_address: addressSchema,
  billing_same_as_shipping: z.boolean(),
  recurring_consent: z
    .object({
      accepted: z.literal(true),
      version: z.string().trim().min(3).max(100),
    })
    .optional(),
});

export const paymentVerifySchema = z.object({
  checkout_session_id: z.string().uuid(),
  razorpay_payment_id: z.string().trim().min(3).max(160),
  razorpay_order_id: z.string().trim().min(3).max(160),
  razorpay_signature: z.string().trim().regex(/^[a-fA-F0-9]{64}$/),
});

export const shippingServiceabilitySchema = z.object({
  postal_code: postalCodeSchema,
  items: cartLinesSchema,
});

export const addressCreateSchema = addressSchema.extend({
  label: z.string().trim().max(60).optional(),
  name: z.string().trim().min(2).max(160),
  phone: z.string().trim().regex(/^\+?[1-9][0-9]{7,14}$/),
  is_default: z.boolean().optional(),
});

