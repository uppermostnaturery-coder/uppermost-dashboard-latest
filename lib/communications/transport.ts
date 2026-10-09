import { Client, Receiver } from "@upstash/qstash";
import { db, rpc, assertDb } from "./store";
import { retryDelay } from "./providers/http";
export type Outbox = { id:string;event_id:string;event_type:string;operation:string;aggregate_id:string;customer_id:string|null;payload:Record<string,unknown>;lane:"REALTIME"|"BULK";attempt_count:number };
export function consumerUrl() {
  const base = process.env.COMMUNICATION_BASE_URL;
  if (!base || new URL(base).protocol!=="https:") throw new Error("COMMUNICATION_BASE_URL_REQUIRED");
  return new URL("/api/internal/communications/consume",base).href;
}
export async function verifyTransport(request: Request, body: string, url?:string) {
  const signature = request.headers.get("upstash-signature");
  if (!signature || !process.env.QSTASH_CURRENT_SIGNING_KEY || !process.env.QSTASH_NEXT_SIGNING_KEY) return false;
  try { return await new Receiver({currentSigningKey:process.env.QSTASH_CURRENT_SIGNING_KEY,nextSigningKey:process.env.QSTASH_NEXT_SIGNING_KEY}).verify({signature,body,url:url||consumerUrl()}); } catch { return false; }
}
export async function publishOutbox(limit=50) {
  if (!process.env.QSTASH_TOKEN) return {published:0,status:"UNCONFIGURED"};
  const url = consumerUrl(); const client = new Client({token:process.env.QSTASH_TOKEN});
  const entries = await rpc<Outbox[]>("comm_claim_outbox",{p_limit:Math.min(limit,50)});
  // UPDATE RETURNING does not preserve the claim CTE's ordering.
  entries.sort((a,b)=>Number(b.lane==='REALTIME')-Number(a.lane==='REALTIME'));
  let published=0;const started=Date.now();
  // Bounded sequential publication gives REALTIME first access; providers have separate lane budgets.
  for (const entry of entries) {
    if(Date.now()-started>10000)break; // Unpublished claims expire and recover; one dispatcher never drains the whole backlog.
    try {
      const provider = String(entry.payload.provider || "orchestration");
      const result = await client.publishJSON({url,body:{outbox_id:entry.id},deduplicationId:entry.event_id,retries:3,
        flowControl:{key:`uppermost:${provider}:${entry.lane.toLowerCase()}`,parallelism:entry.lane==='REALTIME'?4:1,rate:entry.lane==='REALTIME'?10:2,period:"1s"},
      });
      assertDb(await db.from("integration_outbox").update({transport_status:"PUBLISHED",qstash_message_id:result.messageId,published_at:new Date().toISOString(),lease_until:new Date(Date.now()+600000).toISOString()}).eq("id",entry.id).neq("status","completed"));published++;
    } catch {
      assertDb(await db.from("integration_outbox").update({status:"pending",transport_status:"FAILED_RETRYABLE",lease_until:null,next_attempt_at:new Date(Date.now()+retryDelay(entry.attempt_count)).toISOString(),last_error_code:"QSTASH_PUBLISH_FAILED",last_error_message:"Queue publication unavailable"}).eq("id",entry.id).neq("status","completed"));
    }
  }
  return {published,status:"READY"};
}
