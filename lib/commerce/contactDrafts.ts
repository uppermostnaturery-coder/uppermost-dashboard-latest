import { z } from "zod";
import { tokenHash } from "./crypto";
const normalizePhone = (phone: string) => { const digits = phone.replace(/\D/g, ""); return digits.length === 10 ? `+91${digits}` : digits ? `+${digits}` : "pending"; };

const field = (limit: number) => z.string().trim().max(limit).default("");
const customer = z.object({ name: field(160), email: field(254), phone: field(24) }).strict();
const address = z.object({ line1: field(250), line2: field(250), landmark: field(180), city: field(100), state: field(100), postal_code: field(12), country: z.literal("IN").default("IN") }).strict();
const identity = { guest_session_id: z.string().regex(/^gs_[a-zA-Z0-9_-]{16,100}$/), draft_token: z.string().regex(/^[a-f0-9]{64}$/), phone: field(24) };
export const contactDraftSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), ...identity }).strict(),
  z.object({ action: z.literal("save"), ...identity, revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), customer, shipping_address: address }).strict(),
]);
export function contactDraftBinding(guest: string, token: string, phone: string, pepper: string) {
  return { browser_hash: tokenHash(`checkout-draft:${guest}:${token}`, pepper), phone_hash: tokenHash(`checkout-phone:${normalizePhone(phone) || "pending"}`, pepper) };
}
export function projectContactDraft(row: { customer: unknown; shipping_address: unknown; updated_at: string }) {
  return { customer: customer.parse(row.customer), shipping_address: address.parse(row.shipping_address), updated_at: row.updated_at };
}
