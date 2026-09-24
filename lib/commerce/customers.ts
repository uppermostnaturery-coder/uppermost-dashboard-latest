import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CommerceError } from "./http";

export type CustomerInput = { name: string; email: string; phone: string };

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

export async function findCustomerIdentity(input: CustomerInput) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = normalizePhone(input.phone);
  const existing = await supabaseAdmin
    .from("customers")
    .select("id")
    .or(`normalized_email.eq.${normalizedEmail},normalized_phone.eq.${normalizedPhone}`)
    .limit(2);
  if (existing.error) throw new Error(`Customer identity lookup failed: ${existing.error.message}`);
  const rows = existing.data ?? [];
  if (rows.length > 1 && rows[0].id !== rows[1].id) {
    throw new CommerceError(
      "CUSTOMER_IDENTITY_CONFLICT",
      "Email and phone belong to different customer records.",
      409
    );
  }
  if (!rows[0]) return { customerId: undefined, hasOrders: false };
  const orders = await supabaseAdmin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", rows[0].id);
  if (orders.error) throw new Error(`Customer order lookup failed: ${orders.error.message}`);
  return { customerId: rows[0].id as string, hasOrders: (orders.count ?? 0) > 0 };
}

export async function resolveOrCreateCustomer(input: CustomerInput) {
  const normalizedEmail = input.email.trim().toLowerCase();
  const normalizedPhone = normalizePhone(input.phone);
  const existing = await supabaseAdmin
    .from("customers")
    .select("id, name, first_name, normalized_email, normalized_phone, razorpay_customer_id")
    .or(`normalized_email.eq.${normalizedEmail},normalized_phone.eq.${normalizedPhone}`)
    .limit(2);
  if (existing.error) throw new Error(`Customer lookup failed: ${existing.error.message}`);

  const rows = existing.data ?? [];
  if (rows.length > 1 && rows[0].id !== rows[1].id) {
    throw new CommerceError(
      "CUSTOMER_IDENTITY_CONFLICT",
      "Email and phone belong to different customer records.",
      409
    );
  }
  const current = rows[0];
  if (current) {
    const { data, error } = await supabaseAdmin
      .from("customers")
      .update({
        name: input.name,
        first_name: input.name.trim().split(/\s+/)[0],
        email: input.email,
        normalized_email: normalizedEmail,
        phone: input.phone,
        normalized_phone: normalizedPhone,
      })
      .eq("id", current.id)
      .select("id, name, first_name, normalized_email, normalized_phone, razorpay_customer_id")
      .single();
    if (error || !data) throw new Error(`Customer update failed: ${error?.message}`);
    return data;
  }

  const { data, error } = await supabaseAdmin
    .from("customers")
    .insert({
      name: input.name,
      first_name: input.name.trim().split(/\s+/)[0],
      email: input.email,
      normalized_email: normalizedEmail,
      phone: input.phone,
      normalized_phone: normalizedPhone,
    })
    .select("id, name, first_name, normalized_email, normalized_phone, razorpay_customer_id")
    .single();
  if (error || !data) throw new Error(`Customer creation failed: ${error?.message}`);
  return data;
}

export async function saveCustomerAddress(args: {
  customerId: string;
  customerName: string;
  customerPhone: string;
  address: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from("customer_addresses")
    .insert({
      customer_id: args.customerId,
      name: args.customerName,
      phone: args.customerPhone,
      line1: args.address.line1,
      line2: args.address.line2 ?? null,
      landmark: args.address.landmark ?? null,
      city: args.address.city,
      state: args.address.state,
      postal_code: args.address.postal_code,
      country: args.address.country,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Address creation failed: ${error?.message}`);
  return data.id as string;
}
