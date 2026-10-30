import { db,rpc,assertDb } from './store';
import { deliveryPermission,isAllowedTestDestination } from './preferences';
import { sendProvider,type ProviderMessage } from './providers/send';
import { ProviderError,retryDelay } from './providers/http';
import { resolveMessageVariables } from './variables';
import {communicationSendSuppressionReason} from './sendSafety';
import {stagingWhatsAppWorkflowsEnabled} from './whatsappWorkflows';
import { stagingEmailSuppressionReason,authorizeStagingTemplateTest,type StagingTemplateTestAuthorization } from './stagingEmailSafety';
export async function sendDelivery(id:string){
 const claimed=await rpc<Record<string,unknown>[]>('comm_claim_delivery',{p_id:id});if(!claimed.length)return;
 const delivery=claimed[0];const started=Date.now();let providerAttempted=false;
 try{
  if(delivery.channel==='WHATSAPP'&&stagingWhatsAppWorkflowsEnabled()){
   const reason=await rpc<string|null>('comm_whatsapp_delivery_permission',{p_delivery_id:id});
   if(typeof reason==='string'&&reason){assertDb(await db.from('message_deliveries').update({status:'SUPPRESSED',lease_until:null,suppression_reason:reason}).eq('id',id));return;}
  }
  const sendSuppression=communicationSendSuppressionReason();
  if(sendSuppression){assertDb(await db.from('message_deliveries').update({status:'DRY_RUN',lease_until:null,next_attempt_at:null,suppression_reason:sendSuppression,latency_ms:Date.now()-started}).eq('id',id));return;}
  const emailSuppression=delivery.channel==='EMAIL'||delivery.channel==='LEMLIST'?stagingEmailSuppressionReason():null;
  const suppress=async()=>{assertDb(await db.from('message_deliveries').update({status:'DRY_RUN',lease_until:null,suppression_reason:emailSuppression,latency_ms:Date.now()-started}).eq('id',id));};
  if(emailSuppression&&!(delivery.channel==='EMAIL'&&emailSuppression==='STAGING_EMAIL_DRY_RUN'&&process.env.COMMUNICATION_STAGING_TEST_ENABLED==='true')){await suppress();return;}
  const m=await db.from('customer_messages').select('customer_id,order_id,title,body,metadata').eq('id',delivery.customer_message_id).single();assertDb(m);
  if(!m.data)throw new Error('MESSAGE_MISSING');
  if(m.data.metadata?.communication_test===true){
   const version=await db.from('communication_template_versions').select('*').eq('id',delivery.template_version_id).single();assertDb(version);
   const artifact=await db.from('communication_template_provider_artifacts').select('*').eq('template_version_id',delivery.template_version_id).maybeSingle();assertDb(artifact);
   const destination=String(m.data.metadata.test_destination||'');
   if(delivery.channel==='WHATSAPP'&&version.data.category==='MARKETING'&&!await rpc<boolean>('comm_whatsapp_phone_allowed',{p_phone:destination})){
    assertDb(await db.from('message_deliveries').update({status:'SUPPRESSED',lease_until:null,suppression_reason:'CONSENT_REQUIRED'}).eq('id',id));return;
   }
   let authorization:StagingTemplateTestAuthorization|null=null;
   if(emailSuppression){
    const template=await db.from('communication_templates').select('logical_key').eq('id',version.data.template_id).single();assertDb(template);
    authorization=authorizeStagingTemplateTest({customerId:m.data.customer_id,channel:delivery.channel,versionId:version.data.id,templateKey:template.data?.logical_key,metadata:m.data.metadata});
    if(!authorization||version.data.status!=='ACTIVE'||artifact.data?.sync_mode!=='DIRECT_CONTENT'){await suppress();return;}
   }
   if(!isAllowedTestDestination(String(delivery.channel),destination)){assertDb(await db.from('message_deliveries').update({status:'DRY_RUN',lease_until:null,suppression_reason:'TEST_DESTINATION_NOT_ALLOWLISTED'}).eq('id',id));return;}
   const variables=Object.fromEntries((version.data.parameter_schema.required||[]).map((key:string)=>[key,`TEST_${key}`]));
   providerAttempted=true;const providerId=await sendProvider(version.data,artifact.data,destination,variables,fetch,authorization);
   await rpc('comm_accept_delivery',{p_id:id,p_provider_id:providerId,p_latency:Date.now()-started});return;
  }
  if(emailSuppression){await suppress();return;}
  const customer=await db.from('customers').select('id,email,phone,name').eq('id',m.data.customer_id).single();assertDb(customer);
  if(!customer.data)throw new Error('CUSTOMER_MISSING');
  const version=await db.from('communication_template_versions').select('*').eq('id',delivery.template_version_id).single();assertDb(version);
  const a=await db.from('communication_template_provider_artifacts').select('*').eq('template_version_id',delivery.template_version_id).maybeSingle();assertDb(a);
  const r=await db.from('communication_run_recipients').select('run_id').eq('id',delivery.run_recipient_id).maybeSingle();assertDb(r);
  const run=r.data?await db.from('communication_runs').select('rule_snapshot,dry_run,event_context').eq('id',r.data.run_id).single():{data:null,error:null};assertDb(run);
  const rule=run.data?.rule_snapshot||{};const action=rule.action_config||{};
  const destination=delivery.channel==='EMAIL'||delivery.channel==='LEMLIST'?customer.data.email:customer.data.phone;
  if(!destination)throw new ProviderError('FAILED_PERMANENT',0,'INVALID_DESTINATION');
  const dry=process.env.COMMUNICATION_DRY_RUN!=='false'||run.data?.dry_run===true;
  if(dry&&!isAllowedTestDestination(String(delivery.channel),destination)){
   assertDb(await db.from('message_deliveries').update({status:'DRY_RUN',lease_until:null,suppression_reason:'RECIPIENT_NOT_ALLOWLISTED',latency_ms:Date.now()-started}).eq('id',id));return;
  }
  const reason=await deliveryPermission({deliveryId:id,customerId:customer.data.id,channel:String(delivery.channel),category:version.data.category,rule,abandoned:action.abandoned_cart===true});
  if(reason){assertDb(await db.from('message_deliveries').update({status:'SUPPRESSED',suppression_reason:reason,lease_until:null}).eq('id',id));return;}
  const facts={...run.data?.event_context};const orderId=m.data.order_id||facts.order_id;
  const required:string[]=version.data.parameter_schema?.required||[];
  // A single owned order lookup for content is bounded; audience rules never join orders.
  if(orderId&&required.some(k=>['order_number','total_paise','discount_paise'].includes(k))){
   const order=await db.from('orders').select('id,order_number,total_paise,discount_paise').eq('id',orderId).eq('customer_id',customer.data.id).single();assertDb(order);
   if(!order.data)throw new ProviderError('FAILED_PERMANENT',0,'CONTENT_ORDER_NOT_FOUND');Object.assign(facts,{...order.data,order_id:order.data.id});
  }
  const variables=resolveMessageVariables(customer.data,m.data,facts,action.variables||{});
  providerAttempted=true;const providerId=await sendProvider(version.data as ProviderMessage,a.data,destination,variables);
  await rpc('comm_accept_delivery',{p_id:id,p_provider_id:providerId,p_latency:Date.now()-started});
 }catch(error){
  const failure=error instanceof ProviderError?error:new ProviderError(providerAttempted?'RECONCILIATION_PENDING':'FAILED_PERMANENT',0,providerAttempted?'AMBIGUOUS_SEND_OR_PERSISTENCE':'CONTENT_OR_CONFIGURATION_INVALID');
  const attempt=Number(delivery.retry_count||0)+1;const state=attempt>=5&&failure.state==='FAILED_RETRYABLE'?'FAILED_PERMANENT':failure.state;
  assertDb(await db.from('message_deliveries').update({status:state,retry_count:attempt,lease_until:null,next_attempt_at:state==='FAILED_RETRYABLE'?new Date(Date.now()+retryDelay(attempt,failure.retryAfter)).toISOString():null,suppression_reason:failure.code,latency_ms:Date.now()-started}).eq('id',id).eq('status','SENDING'));
 }
}
