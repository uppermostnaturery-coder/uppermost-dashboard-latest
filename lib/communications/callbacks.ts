import { z } from 'zod';
const stamp=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString());
const identifier=z.string().min(1).max(200);
const status=z.enum(['SENT','DELIVERED','OPENED','CLICKED','FAILED_PERMANENT','UNSUBSCRIBED']);
const normalized=z.object({message_id:identifier,status,timestamp:stamp,email:z.email().optional()}).strict();
export type Callback={message_id:string;status:z.infer<typeof status>;timestamp:string;email?:string;correlation?:{eventId:string;campaignId?:string;stepId?:string}};
export function normalizeCallback(provider:'MSG91'|'LEMLIST',payload:unknown):Callback|null{
 if(payload&&typeof payload==='object'&&'message_id' in payload)return normalized.parse(payload);
 if(provider==='MSG91'){
  const value=z.object({requestId:identifier,status:z.union([z.string(),z.number()]),deliveryTime:stamp.optional(),ts:stamp.optional()}).parse(payload);
  const codes:Record<string,Callback['status']>={'0':'SENT','1':'DELIVERED','2':'FAILED_PERMANENT','9':'FAILED_PERMANENT','16':'FAILED_PERMANENT','25':'FAILED_PERMANENT','17':'FAILED_PERMANENT','20':'FAILED_PERMANENT'};const mapped=codes[String(value.status)];
  if(!mapped)throw new Error('UNKNOWN_SMS_STATUS');const timestamp=value.deliveryTime||value.ts;if(!timestamp)throw new Error('MISSING_EVENT_TIMESTAMP');
  return {message_id:value.requestId,status:mapped,timestamp};
 }
 const type=z.object({type:z.string().max(100)}).parse(payload).type;
 const types:Record<string,Callback['status']>={emailsSent:'SENT',emailsOpened:'OPENED',emailsClicked:'CLICKED',emailsBounced:'FAILED_PERMANENT',emailsFailed:'FAILED_PERMANENT',emailsUnsubscribed:'UNSUBSCRIBED',entityUnsubscribed:'UNSUBSCRIBED',variableUnsubscribed:'UNSUBSCRIBED'};const mapped=types[type];
 if(!mapped)return null; // An all-events webhook must acknowledge unrelated activity without attribution.
 const value=z.object({_id:identifier,type:z.string(),createdAt:stamp,leadId:identifier.optional(),campaignId:identifier.optional(),stepId:identifier.optional(),leadEmail:z.email().optional(),email:z.email().optional(),contactId:identifier.optional()}).parse(payload);
 // Native activity must match the immutable campaign AND stable step, never only an email address.
 if(mapped!=='UNSUBSCRIBED'&&(!value.leadId||!value.campaignId||!value.stepId))return null;
 return {message_id:value.leadId||value.contactId||value._id,status:mapped,timestamp:value.createdAt,email:type==='emailsFailed'?undefined:value.leadEmail||value.email,correlation:{eventId:value._id,campaignId:value.campaignId,stepId:value.stepId}};
}
