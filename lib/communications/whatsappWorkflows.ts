import {rpc,db,assertDb} from './store';
import {stagingEmailSuppressionReason} from './stagingEmailSafety';

// Production keeps its existing path. New RPCs require the reviewed additive migration.
export function stagingWhatsAppWorkflowsEnabled(){
 return stagingEmailSuppressionReason()==='STAGING_EMAIL_DRY_RUN';
}
const managed=new Set(['WELCOME','CART_RECOVERY','CHECKOUT_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION','SHIPPING_UPDATE'].map(w=>`UPPERMOST_WHATSAPP_${w}_V1`));
export function isManagedWhatsAppRule(name:string){return managed.has(name);}
export async function captureWhatsAppWorkflows(){
 if(!stagingWhatsAppWorkflowsEnabled())return;
 await rpc('comm_capture_whatsapp_workflows',{p_limit:50});
}
export async function dispatchWhatsAppWorkflows(){
 if(!stagingWhatsAppWorkflowsEnabled())return;
 await captureWhatsAppWorkflows();
 await rpc('comm_dispatch_whatsapp_workflows',{p_limit:50,p_dry:true});
}

// Preparation uses the same durable outbox/transport as all communications work.
// A failed WhatsApp RPC must never hold the source event's EMAIL routing hostage.
export async function enqueueWhatsAppPreparation(phase:'CAPTURE'|'DISPATCH'|'WELCOME',key:string){
 if(!stagingWhatsAppWorkflowsEnabled())return;
 assertDb(await db.from('integration_outbox').upsert({
  provider:'COMMUNICATIONS',operation:'WHATSAPP_WORKFLOWS',aggregate_id:key,
  idempotency_key:`whatsapp-preparation:${phase}:${key}`,event_type:'communication.whatsapp.prepare',
  lane:'REALTIME',priority:-100,payload:{phase,provider:'whatsapp'},
 },{onConflict:'idempotency_key',ignoreDuplicates:true}));
}

export async function prepareWhatsAppWorkflows(phase:unknown){
 if(phase==='CAPTURE')await captureWhatsAppWorkflows();
 else if(phase==='DISPATCH')await dispatchWhatsAppWorkflows();
 else if(phase==='WELCOME')await rpc('comm_dispatch_whatsapp_welcomes',{p_limit:50,p_dry:true});
 else throw new Error('INVALID_WHATSAPP_PREPARATION_PHASE');
}
