import type { NormalizedPaymentState } from "../types";

export function normalizeRazorpayFailure(error: Record<string, unknown> | null): NormalizedPaymentState {
  const reason = `${error?.reason ?? error?.error_reason ?? ""}`.toLowerCase();
  const description = `${error?.description ?? error?.error_description ?? ""}`.toLowerCase();
  const combined = `${reason} ${description}`;
  if (combined.includes("insufficient") || combined.includes("balance")) return "INSUFFICIENT_FUNDS";
  if (combined.includes("cancel") || combined.includes("declin")) return "CUSTOMER_CANCELLED";
  if (combined.includes("mandate") || combined.includes("token")) return "MANDATE_ACTION_REQUIRED";
  return "FAILED_RETRYABLE";
}

export function canStartRenewalCycle(status: string): boolean {
  return status === "DUE";
}
