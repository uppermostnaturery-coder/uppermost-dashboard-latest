import { z } from 'zod';
import { db,rpc,assertDb } from './store';
import { compileEmail,compileLemlistEmail,assertProviderReady } from './email';
import { AdminError } from '../admin/policy';
import { providerRequest } from './providers/http';
export const templateVersionSchema=z.object({
 template_id:z.uuid().optional(),logical_key:z.string().regex(/^[A-Z0-9_]{1,80}$/),name:z.string().min(1).max(160),
 channel:z.enum(['EMAIL','WHATSAPP','SMS','LEMLIST']),category:z.enum(['TRANSACTIONAL','MARKETING','AUTHENTICATION']),
 subject:z.string().max(400).default(''),html_content:z.string().max(200000).default(''),text_content:z.string().max(20000).default(''),
 structured_content:z.record(z.string(),z.unknown()).default({}),parameter_schema:z.object({required:z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/)).max(30).default([]),body_parameters:z.array(z.string()).max(30).default([])}).default({required:[],body_parameters:[]}),change_reason:z.string().min(1).max(500),
}).strict();
export async function saveTemplate(input:unknown,actor:string){
 const v=templateVersionSchema.parse(input);
 const variables=Object.fromEntries(v.parameter_schema.required.map(key=>[key,`[${key}]`]));
 if(v.channel==='EMAIL'||v.channel==='LEMLIST')compileEmail(v.html_content,variables);
 if(v.channel==='LEMLIST'&&v.category!=='MARKETING')throw new AdminError('LEMLIST_IS_NURTURE_ONLY',400);
 const result=await rpc('comm_create_template_version',{p_input:v,p_actor:actor});return result;
}
export async function submitProvider(versionId:string){
 if(process.env.COMMUNICATION_PROVIDER_MUTATIONS_ENABLED!=='true')throw new AdminError('PROVIDER_MUTATIONS_DISABLED',409);
 const v=await db.from('communication_template_versions').select('*').eq('id',versionId).eq('status','DRAFT').single();assertDb(v);
 const a=await db.from('communication_template_provider_artifacts').select('*').eq('template_version_id',versionId).single();assertDb(a);
 if(v.data.channel==='WHATSAPP'){
  assertDb(await db.from('communication_template_provider_artifacts').update({provider_status:'SUBMITTING'}).eq('id',a.data.id));
  try{
   const result=await providerRequest(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION||'v25.0'}/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`,{method:'POST',headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify({name:a.data.provider_template_name,language:a.data.provider_language,category:v.data.category==='AUTHENTICATION'?'AUTHENTICATION':v.data.category==='MARKETING'?'MARKETING':'UTILITY',components:v.data.structured_content.components})});
   if(!result.id)throw new Error('MISSING_ARTIFACT_ID');
   assertDb(await db.from('communication_template_provider_artifacts').update({provider_template_id:String(result.id),provider_status:result.status==='APPROVED'?'APPROVED':'PENDING',submitted_at:new Date().toISOString(),last_synced_at:new Date().toISOString()}).eq('id',a.data.id));
  }catch{assertDb(await db.from('communication_template_provider_artifacts').update({provider_status:'SYNC_FAILED',last_error:'Provider submission unavailable; reconcile before resubmission'}).eq('id',a.data.id));throw new AdminError('PROVIDER_SYNC_FAILED',502);}
 }else if(v.data.channel==='LEMLIST'){
  const auth={Authorization:`Basic ${Buffer.from(':'+(process.env.LEMLIST_API_KEY||'')).toString('base64')}`,'Content-Type':'application/json'};
  const campaign=await providerRequest(`https://api.lemlist.com/api/campaigns/${encodeURIComponent(a.data.lemlist_campaign_id)}`,{headers:auth});
  // Pausing remains an explicit operator action; never pause another live campaign implicitly.
  if(campaign.status==='running')throw new AdminError('CAMPAIGN_MUST_BE_PAUSED',409);
  const html=compileLemlistEmail(v.data.html_content,v.data.parameter_schema.required||[]);
  await providerRequest(`https://api.lemlist.com/api/sequences/${encodeURIComponent(a.data.lemlist_sequence_id)}/steps/${encodeURIComponent(a.data.lemlist_step_id)}`,{method:'PATCH',headers:auth,body:JSON.stringify({type:'email',subject:v.data.subject,message:html})});
  assertDb(await db.from('communication_template_provider_artifacts').update({provider_status:'NOT_REQUIRED',last_synced_at:new Date().toISOString()}).eq('id',a.data.id));
 }else throw new AdminError('PROVIDER_SYNC_NOT_REQUIRED',400);
}
export async function activateTemplate(id:string){
 const v=await db.from('communication_template_versions').select('*').eq('id',id).single();assertDb(v);
 const a=await db.from('communication_template_provider_artifacts').select('*').eq('template_version_id',id).maybeSingle();assertDb(a);
 assertProviderReady(v.data.channel,v.data.category,a.data);await rpc('comm_activate_template',{p_version_id:id});
}
export async function refreshMetaArtifact(id:string){
 const a=await db.from('communication_template_provider_artifacts').select('*').eq('template_version_id',id).eq('provider','META_WHATSAPP').single();assertDb(a);
 const response=await providerRequest(`https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION||'v25.0'}/${process.env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates?name=${encodeURIComponent(a.data.provider_template_name)}&fields=id,name,status,language,category,components&limit=5`,{headers:{Authorization:`Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`}});
 const artifact=(Array.isArray(response.data)?response.data:[]).find((v:{name:string;language:string})=>v.name===a.data.provider_template_name&&v.language===a.data.provider_language);
 if(!artifact)throw new AdminError('PROVIDER_TEMPLATE_NOT_FOUND',404);
 const version=await db.from('communication_template_versions').select('structured_content,status').eq('id',id).single();assertDb(version);
 if(!version.data)throw new AdminError('TEMPLATE_NOT_FOUND',404);
 if(version.data.status==='DRAFT'&&JSON.stringify(artifact.components)!==JSON.stringify(version.data.structured_content.components))throw new AdminError('PROVIDER_CONTENT_MISMATCH',409);
 assertDb(await db.from('communication_template_provider_artifacts').update({provider_template_id:String(artifact.id),provider_status:String(artifact.status),provider_payload_snapshot:artifact,last_synced_at:new Date().toISOString()}).eq('id',a.data.id));
 return {status:artifact.status};
}
