import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CommerceError } from "./http";

export type IdempotencyRecord = {
  id: string;
  request_hash: string;
  status: "PROCESSING" | "COMPLETED" | "FAILED";
  response_status: number | null;
  response_body: Record<string, unknown> | null;
};

export type IdempotencyDecision =
  | { kind: "START"; recordId: string }
  | { kind: "REPLAY"; status: number; body: Record<string, unknown> };

export function resolveExistingIdempotency(
  existing: IdempotencyRecord,
  currentRequestHash: string
): IdempotencyDecision {
  if (existing.request_hash !== currentRequestHash) {
    throw new CommerceError(
      "IDEMPOTENCY_CONFLICT",
      "This Idempotency-Key was already used with a different request.",
      409
    );
  }
  if (existing.status === "COMPLETED" && existing.response_body) {
    return {
      kind: "REPLAY",
      status: existing.response_status ?? 200,
      body: existing.response_body,
    };
  }
  throw new CommerceError(
    "REQUEST_IN_PROGRESS",
    "A request with this Idempotency-Key is already being processed.",
    409
  );
}

export async function beginIdempotentRequest(args: {
  endpoint: string;
  key: string;
  requestHash: string;
}): Promise<IdempotencyDecision> {
  const { data, error } = await supabaseAdmin
    .from("idempotency_records")
    .insert({
      endpoint: args.endpoint,
      idempotency_key: args.key,
      request_hash: args.requestHash,
    })
    .select("id, request_hash, status, response_status, response_body")
    .single();

  if (!error && data) return { kind: "START", recordId: data.id as string };
  if (error?.code !== "23505") {
    throw new Error(`Idempotency initialization failed: ${error?.message}`);
  }

  const existingResult = await supabaseAdmin
    .from("idempotency_records")
    .select("id, request_hash, status, response_status, response_body")
    .eq("endpoint", args.endpoint)
    .eq("idempotency_key", args.key)
    .single();
  if (existingResult.error || !existingResult.data) {
    throw new Error(`Idempotency lookup failed: ${existingResult.error?.message}`);
  }
  return resolveExistingIdempotency(
    existingResult.data as IdempotencyRecord,
    args.requestHash
  );
}

export async function completeIdempotentRequest(args: {
  recordId: string;
  status: number;
  body: Record<string, unknown>;
  referenceType?: string;
  referenceId?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("idempotency_records")
    .update({
      status: "COMPLETED",
      response_status: args.status,
      response_body: args.body,
      response_reference_type: args.referenceType ?? null,
      response_reference_id: args.referenceId ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", args.recordId)
    .eq("status", "PROCESSING");
  if (error) throw new Error(`Idempotency completion failed: ${error.message}`);
}

export async function failIdempotentRequest(recordId: string): Promise<void> {
  await supabaseAdmin
    .from("idempotency_records")
    .update({ status: "FAILED", completed_at: new Date().toISOString() })
    .eq("id", recordId)
    .eq("status", "PROCESSING");
}

