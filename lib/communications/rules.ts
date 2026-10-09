import { z } from "zod";
import { parseCondition } from "./dsl";
import { nextRuns } from "./schedule";
import { db,rpc,assertDb } from "./store";
import { publishOutbox } from "./transport";
export const ruleSchema = z.object({
 name:z.string().min(1).max(160),description:z.string().max(1000).default(''),status:z.enum(['DRAFT','ACTIVE','PAUSED','ARCHIVED']).default('DRAFT'),
 trigger_type:z.enum(['EVENT','SCHEDULE','MANUAL']),trigger_event_type:z.enum(['customer.message.created','commerce.order.confirmed','commerce.payment.changed','commerce.subscription.changed','commerce.shipment.changed']).nullable().optional(),
 cron_expression:z.string().max(100).nullable().optional(),timezone:z.string().max(64).default('Asia/Kolkata'),condition_config:z.unknown().transform(parseCondition),
 action_config:z.object({templates:z.record(z.enum(['EMAIL','WHATSAPP','SMS','LEMLIST']),z.uuid()).refine((v)=>Object.keys(v).length>0),variables:z.record(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),z.union([z.string().max(2048),z.number(),z.boolean()])).default({}),abandoned_cart:z.boolean().default(false),offer_id:z.uuid().optional()}).strict(),
 priority:z.number().int().min(-100).max(100).default(0),frequency_cap:z.object({weekly:z.number().int().min(1).max(10).default(3),cooldown_hours:z.number().int().min(1).max(168).default(24)}).default({weekly:3,cooldown_hours:24}),
 quiet_hours:z.object({start:z.number().int().min(0).max(23).default(21),end:z.number().int().min(0).max(23).default(9)}).default({start:21,end:9}),
 valid_from:z.iso.datetime().nullable().optional(),valid_until:z.iso.datetime().nullable().optional(),
}).strict().superRefine((v,c)=>{
 if(v.trigger_type==='SCHEDULE'){try{nextRuns(v.cron_expression||'',v.timezone);}catch{c.addIssue({code:'custom',message:'Invalid schedule'});}}
 if(v.trigger_type==='EVENT'&&!v.trigger_event_type)c.addIssue({code:'custom',message:'Event required'});
 if(v.valid_from&&v.valid_until&&v.valid_until<=v.valid_from)c.addIssue({code:'custom',message:'Invalid validity range'});
});
export async function dispatchCommunications() {
 const now=new Date();
 const result=await db.from('communication_rules').select('id,version,next_run_at,cron_expression,timezone').eq('status','ACTIVE').eq('trigger_type','SCHEDULE').lte('next_run_at',now.toISOString()).order('next_run_at').limit(20);assertDb(result);
 let runs=0;
 for(const rule of result.data||[]){
  const next=nextRuns(rule.cron_expression,rule.timezone,now,1)[0];
  const id=await rpc('comm_start_run',{p_rule_id:rule.id,p_expected_next:rule.next_run_at,p_next:next,p_key:`schedule:${rule.id}:${rule.version}:${rule.next_run_at}`,p_dry:process.env.COMMUNICATION_DRY_RUN!=='false'});if(id)runs++;
 }
 // An expired provider reservation is an ambiguous outcome, even if QStash retries its request.
 assertDb(await db.from('message_deliveries').update({status:'RECONCILIATION_PENDING',suppression_reason:'EXPIRED_SEND_RESERVATION'}).eq('status','SENDING').lt('lease_until',now.toISOString()));
 const due=await db.from('message_deliveries').select('id,provider,retry_count,template_version_id').eq('status','FAILED_RETRYABLE').lte('next_attempt_at',now.toISOString()).limit(50);assertDb(due);
 const versionIds=(due.data||[]).map(d=>d.template_version_id).filter(Boolean);
 const versions=versionIds.length?await db.from('communication_template_versions').select('id,category').in('id',versionIds):{data:[],error:null};assertDb(versions);
 for(const d of due.data||[]){const bulk=versions.data?.some(v=>v.id===d.template_version_id&&v.category==='MARKETING');
  assertDb(await db.from('integration_outbox').upsert({provider:'COMMUNICATIONS',operation:'SEND',aggregate_id:d.id,idempotency_key:`send-retry:${d.id}:${d.retry_count}`,event_type:'communication.delivery.retry',lane:bulk?'BULK':'REALTIME',payload:{delivery_id:d.id,provider:d.provider.toLowerCase()}},{onConflict:'idempotency_key',ignoreDuplicates:true}));
 }
 return {runs,...await publishOutbox()};
}
