import type { NormalizedPaymentState } from "../types";

export function normalizeRazorpayFailure(error: Record<string, unknown> | null): NormalizedPaymentState {
  const reason = `${error?.reason ?? error?.error_reason ?? ""}`.toLowerCase();
  const description = `${error?.description ?? error?.error_description ?? ""}`.toLowerCase();
  const combined = `${reason} ${description}`;
  if (combined.includes("insufficient") || combined.includes("balance")) return "INSUFFICIENT_FUNDS";
  if (combined.includes("mandate") && combined.includes("paused")) return "MANDATE_PAUSED";
  if (combined.includes("mandate") && combined.includes("reject")) return "MANDATE_REJECTED";
  if (combined.includes("mandate") && combined.includes("cancel")) return "MANDATE_CANCELLED";
  if (combined.includes("mandate") && combined.includes("expir")) return "MANDATE_EXPIRED";
  if (combined.includes("reauth") || combined.includes("re-author")) return "REAUTH_REQUIRED";
  if (combined.includes("cancel") || combined.includes("declin")) return "CUSTOMER_CANCELLED";
  if (combined.includes("mandate") || combined.includes("token")) return "MANDATE_ACTION_REQUIRED";
  return "FAILED_RETRYABLE";
}

export function canStartRenewalCycle(status: string): boolean {
  return status === "DUE";
}
