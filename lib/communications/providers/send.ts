import { providerRequest,ProviderError } from './http';
import { compileEmail,assertProviderReady } from '../email';
export type ProviderMessage={channel:string;category:string;subject?:string|null;html_content?:string|null;text_content?:string|null;structured_content?:Record<string,unknown>;parameter_schema?:Record<string,unknown>};
const required=(name:string)=>{const value=process.env[name];if(!value)throw new ProviderError('FAILED_PERMANENT',0,'PROVIDER_UNCONFIGURED');return value;};
const headers=(extra:Record<string,string>)=>({'Content-Type':'application/json',...extra});
function textVariables(source:string,variables:Record<string,unknown>){
 if(/[\r\n]/.test(source))throw new ProviderError('FAILED_PERMANENT',0,'INVALID_SUBJECT');
 return source.replace(/{{\s*(\w+)\s*}}/g,(_,key:string)=>{if(!(key in variables))throw new ProviderError('FAILED_PERMANENT',0,'MISSING_VARIABLE');return String(variables[key]).replace(/[\r\n]/g,' ');});
}
export async function sendProvider(message:ProviderMessage,artifact:Record<string,unknown>|null,destination:string,variables:Record<string,unknown>,fetcher=fetch):Promise<string>{
 assertProviderReady(message.channel,message.category,artifact);
 if(message.channel==='EMAIL'){
  const html=compileEmail(message.html_content||message.text_content||'',variables);
  const result=await providerRequest('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:headers({'api-key':required('BREVO_API_KEY')}),body:JSON.stringify({sender:{email:required('COMMUNICATION_EMAIL_FROM'),name:'Uppermost'},to:[{email:destination}],subject:textVariables(message.subject||'Uppermost',variables),...(artifact?.sync_mode==='PROVIDER_TEMPLATE'?{templateId:Number(artifact.provider_template_id),params:variables}:{htmlContent:html.html})})},fetcher);
  if(!result.messageId)throw new ProviderError('RECONCILIATION_PENDING',0,'MISSING_PROVIDER_MESSAGE_ID');return String(result.messageId);
 }
 if(message.channel==='WHATSAPP'){
  const keys=Array.isArray(message.parameter_schema?.body_parameters)?message.parameter_schema.body_parameters as string[]:[];
  const components:Record<string,unknown>[]=keys.length?[{type:'body',parameters:keys.map((key)=>{if(!(key in variables))throw new ProviderError('FAILED_PERMANENT',0,'MISSING_VARIABLE');return {type:'text',text:String(variables[key])};})}]:[];
  if(message.category==='AUTHENTICATION'){
   if(!variables.otp)throw new ProviderError('FAILED_PERMANENT',0,'MISSING_VARIABLE');
   components.push({type:'button',sub_type:'url',index:'0',parameters:[{type:'text',text:String(variables.otp)}]});
  }
  const result=await providerRequest(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION||'v25.0'}/${required('WHATSAPP_PHONE_NUMBER_ID')}/messages`,{method:'POST',headers:headers({Authorization:`Bearer ${required('WHATSAPP_ACCESS_TOKEN')}`}),body:JSON.stringify({messaging_product:'whatsapp',to:destination.replace(/\D/g,''),type:'template',template:{name:artifact?.provider_template_name,language:{code:artifact?.provider_language||'en_US'},components}})},fetcher);
  const id=(result.messages as {id?:string}[]|undefined)?.[0]?.id;if(!id)throw new ProviderError('RECONCILIATION_PENDING',0,'MISSING_PROVIDER_MESSAGE_ID');return id;
 }
 if(message.channel==='SMS'){
  const result=await providerRequest('https://control.msg91.com/api/v5/flow/',{method:'POST',headers:headers({authkey:required('MSG91_AUTH_KEY')}),body:JSON.stringify({template_id:artifact?.msg91_template_id,short_url:'0',recipients:[{mobiles:destination.replace(/\D/g,''),...variables}]})},fetcher);
  if(result.type==='error')throw new ProviderError('FAILED_PERMANENT',0,'MSG91_REJECTED');if(!result.request_id&&!result.message)throw new ProviderError('RECONCILIATION_PENDING');return String(result.request_id||result.message);
 }
 if(message.channel==='LEMLIST'){
  const campaign=encodeURIComponent(String(artifact?.lemlist_campaign_id));
  const result=await providerRequest(`https://api.lemlist.com/api/campaigns/${campaign}/leads/`,{method:'POST',headers:headers({Authorization:`Basic ${Buffer.from(':'+required('LEMLIST_API_KEY')).toString('base64')}`}),body:JSON.stringify({...variables,email:destination})},fetcher);
  if(!result._id)throw new ProviderError('RECONCILIATION_PENDING');return String(result._id);
 }
 throw new ProviderError('FAILED_PERMANENT',0,'INVALID_CHANNEL');
}
