import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { rpc } from './store';
import {stagingEmailSuppressionReason} from './stagingEmailSafety';
export function verifyMetaSignature(body:string,signature:string|null){
 const secret=process.env.WHATSAPP_APP_SECRET;if(!secret||!signature?.startsWith('sha256='))return false;
 const expected=createHmac('sha256',secret).update(body).digest('hex');const supplied=signature.slice(7);
 return /^[0-9a-f]{64}$/i.test(supplied)&&timingSafeEqual(Buffer.from(supplied,'hex'),Buffer.from(expected,'hex'));
}
export async function recordProviderEvent(provider:string,messageId:string,status:string,timestamp:string,email?:string,correlation?:{eventId:string;campaignId?:string;stepId?:string}){
 const key=createHash('sha256').update(correlation?.eventId||`${messageId}:${status}:${timestamp}`).digest('hex');
 await rpc('comm_provider_event',{p_provider:provider,p_event_id:key,p_message_id:messageId,p_status:status,p_at:timestamp,p_email:email||null,p_campaign:correlation?.campaignId||null,p_step:correlation?.stepId||null});
}
export async function metaWebhook(payload:Record<string,unknown>){
 const staging=stagingEmailSuppressionReason()!==null;
 const waba=process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,phone=process.env.WHATSAPP_PHONE_NUMBER_ID;
 // An app signature authenticates the app, not the staging WABA or sender.
 if(staging&&(!waba||!phone))throw new Error('STAGING_WHATSAPP_IDENTITY_UNCONFIGURED');
 const entries=Array.isArray(payload.entry)?payload.entry as {id?:string;changes?:{field:string;value:Record<string,unknown>}[]}[]:[];
 for(const entry of entries)for(const change of entry.changes||[]){
  const value=change.value;
  if(staging&&entry.id!==waba)continue;
  if(staging&&change.field==='messages'&&(value.metadata as {phone_number_id?:string}|undefined)?.phone_number_id!==phone)continue;
  if(change.field==='message_template_status_update'){
   const status=String(value.event);const mapped=status==='REINSTATED'?'APPROVED':status;
   if(['APPROVED','REJECTED','PENDING','DISABLED','FLAGGED','PAUSED','DELETED'].includes(mapped))await rpc('comm_template_provider_event',{p_provider_id:String(value.message_template_id),p_status:mapped,p_at:new Date().toISOString(),p_reason:String(value.reason||'')});
  }
  if(change.field==='messages'){
   for(const status of Array.isArray(value.statuses)?value.statuses as {id:string;status:string;timestamp:string}[]:[]){
    const state=status.status.toUpperCase()==='FAILED'?'FAILED_PERMANENT':status.status.toUpperCase();
    const at=new Date(Number(status.timestamp)*1000).toISOString();
    await recordProviderEvent('META_WHATSAPP',status.id,state,at);
    await rpc('comm_whatsapp_legacy_event',{p_message_id:status.id,p_status:state,p_at:at});
   }
   for(const message of Array.isArray(value.messages)?value.messages as {from:string;text?:{body:string};button?:{text?:string;payload?:string};interactive?:{button_reply?:{id?:string;title?:string}}}[]:[]){
    const commands=[message.text?.body,message.button?.text,message.button?.payload,message.interactive?.button_reply?.id,message.interactive?.button_reply?.title];
    if(commands.some(command=>typeof command==='string'&&/^(stop|unsubscribe)$/i.test(command.trim())))await rpc('comm_phone_opt_out',{p_phone:message.from,p_channel:'WHATSAPP'});
   }
  }
 }
}
