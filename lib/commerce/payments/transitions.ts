import type { NormalizedPaymentState } from "../types";

const PAYMENT_TERMINAL_STATES = new Set(["CAPTURED", "CONFIRMED"]);

export function canApplyPaymentStatus(current: string, incomingProviderStatus: string): boolean {
  if (PAYMENT_TERMINAL_STATES.has(current.toUpperCase())) {
    return incomingProviderStatus.toLowerCase() === "captured";
  }
  return true;
}

export function normalizedStateForProviderStatus(
  status: string,
  failureState: NormalizedPaymentState
): NormalizedPaymentState {
  if (status === "captured") return "CONFIRMED";
  if (status === "authorized" || status === "created") return "PENDING";
  return failureState;
}

export class PaymentReconciliationMismatchError extends Error {
  readonly code = "PAYMENT_RECONCILIATION_MISMATCH";
  constructor(readonly mismatches: string[]) {
    super(`Provider payment does not match the stored attempt: ${mismatches.join(", ")}.`);
    this.name = "PaymentReconciliationMismatchError";
  }
}

export function validateProviderPaymentIdentity(args: {
  expectedProviderOrderId: string;
  existingProviderPaymentId?: string | null;
  expectedAmountPaise: number;
  expectedCurrency: string;
  payment: {
    id: string;
    order_id?: string;
    amount: number;
    currency: string;
  };
}) {
  const mismatches: string[] = [];
  if (args.payment.order_id !== args.expectedProviderOrderId) mismatches.push("provider_order_id");
  if (
    args.existingProviderPaymentId &&
    args.payment.id !== args.existingProviderPaymentId
  ) mismatches.push("provider_payment_id");
  if (Number(args.payment.amount) !== Number(args.expectedAmountPaise)) mismatches.push("amount_paise");
  if (args.payment.currency.toUpperCase() !== args.expectedCurrency.toUpperCase()) mismatches.push("currency");
  if (mismatches.length) throw new PaymentReconciliationMismatchError(mismatches);
}
