import { db,rpc,assertDb } from "./store";
import { publishOutbox,type Outbox } from "./transport";
import { sendDelivery } from "./delivery";
export async function consumeOutbox(id:string) {
 const result=await db.from('integration_outbox').select('*').eq('id',id).eq('provider','COMMUNICATIONS').single();assertDb(result);
 const event=result.data as Outbox & {status:string};if(event.status==='completed'||event.status==='failed')return;
 try {
  if(event.operation==='EVENT'){
   await rpc('comm_apply_projection',{p_outbox_id:id});
   if(event.customer_id&&!event.payload.projection_only){
    const rules=await db.from('communication_rules').select('id,version').eq('status','ACTIVE').eq('trigger_type','EVENT').eq('trigger_event_type',event.event_type).limit(20);assertDb(rules);
    for(const r of rules.data||[])await rpc('comm_start_run',{p_rule_id:r.id,p_expected_next:null,p_next:null,p_key:`event:${event.event_id}:${r.id}:${r.version}`,p_dry:process.env.COMMUNICATION_DRY_RUN!=='false',p_subject:event.customer_id,p_message:event.payload.message_id||null,p_context:{...event.payload,event_type:event.event_type}});
   }
  }else if(event.operation==='AUDIENCE')await rpc('comm_snapshot_batch',{p_run_id:event.aggregate_id});
  else if(event.operation==='RECIPIENTS')await rpc('comm_prepare_recipients',{p_run_id:event.aggregate_id});
  else if(event.operation==='SEND')await sendDelivery(event.aggregate_id);
  else if(event.operation==='OTP'){ const {deliverOtp}=await import('./otp');await deliverOtp(event.aggregate_id); }
  else throw new Error('UNKNOWN_OUTBOX_OPERATION');
  assertDb(await db.from('integration_outbox').update({status:'completed',processed_at:new Date().toISOString(),lease_until:null}).eq('id',id));
 }catch(error){
  if(event.operation==='AUDIENCE'&&error instanceof Error&&/timeout|RULE_COMPLEXITY_LIMIT/i.test(error.message)){
   assertDb(await db.from('communication_runs').update({status:'PAUSED_PERFORMANCE_GUARD',last_error:'Audience query exceeded its safe budget'}).eq('id',event.aggregate_id));
   assertDb(await db.from('integration_outbox').update({status:'failed',transport_status:'FAILED_PERMANENT',lease_until:null,last_error_code:'PERFORMANCE_GUARD'}).eq('id',id));return;
  }
  throw error;
 }
 await publishOutbox(10);
}
