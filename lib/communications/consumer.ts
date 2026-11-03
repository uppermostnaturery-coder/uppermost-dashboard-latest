import { db,rpc,assertDb } from "./store";
import { publishOutbox,type Outbox } from "./transport";
import { sendDelivery } from "./delivery";
import {enqueueWhatsAppPreparation,prepareWhatsAppWorkflows,isManagedWhatsAppRule,stagingWhatsAppWorkflowsEnabled} from './whatsappWorkflows';
import {retryDelay} from './providers/http';
export async function consumeOutbox(id:string) {
 const result=await db.from('integration_outbox').select('*').eq('id',id).eq('provider','COMMUNICATIONS').single();assertDb(result);
 const event=result.data as Outbox & {status:string;next_attempt_at?:string|null};if(event.status==='completed'||event.status==='failed')return;
 // QStash can redeliver before the database retry is due. Keep its backoff intact.
 if(event.operation==='WHATSAPP_WORKFLOWS'&&event.next_attempt_at&&Date.parse(event.next_attempt_at)>Date.now())throw new Error('WHATSAPP_PREPARATION_RETRY_NOT_DUE');
 try {
  if(event.operation==='EVENT'){
   await rpc('comm_apply_projection',{p_outbox_id:id});
   if(event.customer_id&&!event.payload.projection_only){
    const rules=await db.from('communication_rules').select('id,version,name').eq('status','ACTIVE').eq('trigger_type','EVENT').eq('trigger_event_type',event.event_type).limit(20);assertDb(rules);
    for(const r of rules.data||[]){
     if(stagingWhatsAppWorkflowsEnabled()&&isManagedWhatsAppRule(r.name))continue;
     await rpc('comm_start_run',{p_rule_id:r.id,p_expected_next:null,p_next:null,p_key:`event:${event.event_id}:${r.id}:${r.version}`,p_dry:process.env.COMMUNICATION_DRY_RUN!=='false',p_subject:event.customer_id,p_message:event.payload.message_id||null,p_context:{...event.payload,event_type:event.event_type}});
    }
   }
   // Route generic rules first. If saving the independent handoff fails, leave
   // the source unfinished; its stable run keys make the retry safe for EMAIL.
   await enqueueWhatsAppPreparation('CAPTURE',event.event_id);
  }else if(event.operation==='WHATSAPP_WORKFLOWS'){
   if(!stagingWhatsAppWorkflowsEnabled()){
    assertDb(await db.from('integration_outbox').update({status:'completed',processed_at:new Date().toISOString(),lease_until:null,next_attempt_at:null,last_error_code:'WHATSAPP_WORKFLOWS_DISABLED',last_error_message:'WhatsApp workflow preparation disabled; no automatic replay'}).eq('id',id));
    return;
   }
   await prepareWhatsAppWorkflows(event.payload.phase);
  }else if(event.operation==='AUDIENCE')await rpc('comm_snapshot_batch',{p_run_id:event.aggregate_id});
  else if(event.operation==='RECIPIENTS')await rpc('comm_prepare_recipients',{p_run_id:event.aggregate_id});
  else if(event.operation==='SEND')await sendDelivery(event.aggregate_id);
  else if(event.operation==='OTP'){ const {deliverOtp}=await import('./otp');await deliverOtp(event.aggregate_id); }
  else throw new Error('UNKNOWN_OUTBOX_OPERATION');
  assertDb(await db.from('integration_outbox').update({status:'completed',processed_at:new Date().toISOString(),lease_until:null,...event.operation==='WHATSAPP_WORKFLOWS'?{next_attempt_at:null,last_error_code:null,last_error_message:null}:{}}).eq('id',id));
 }catch(error){
  if(event.operation==='WHATSAPP_WORKFLOWS'){
   // These RPCs only prepare idempotent database work; they never send providers.
   // Keep failures on this channel's record, using the existing transport budget.
   const exhausted=event.attempt_count>=20;
   assertDb(await db.from('integration_outbox').update({status:exhausted?'failed':'pending',transport_status:exhausted?'FAILED_PERMANENT':'FAILED_RETRYABLE',lease_until:null,
    next_attempt_at:exhausted?null:new Date(Date.now()+retryDelay(event.attempt_count)).toISOString(),last_error_code:'WHATSAPP_WORKFLOW_PREPARATION_FAILED',last_error_message:'WhatsApp preparation unavailable; inspect workflow RPCs and configuration'}).eq('id',id).neq('status','completed'));
  }
  if(event.operation==='AUDIENCE'&&error instanceof Error&&/timeout|RULE_COMPLEXITY_LIMIT/i.test(error.message)){
   assertDb(await db.from('communication_runs').update({status:'PAUSED_PERFORMANCE_GUARD',last_error:'Audience query exceeded its safe budget'}).eq('id',event.aggregate_id));
   assertDb(await db.from('integration_outbox').update({status:'failed',transport_status:'FAILED_PERMANENT',lease_until:null,last_error_code:'PERFORMANCE_GUARD'}).eq('id',id));return;
  }
  throw error;
 }
 await publishOutbox(10);
}
