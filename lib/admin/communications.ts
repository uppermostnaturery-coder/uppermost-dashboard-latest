import { z } from 'zod';
import { db,rpc,assertDb } from '../communications/store';
import { ruleSchema } from '../communications/rules';
import { nextRuns } from '../communications/schedule';
import { parseCondition } from '../communications/dsl';
import { saveTemplate,submitProvider,activateTemplate,refreshMetaArtifact } from '../communications/templates';
import { compileEmail } from '../communications/email';
import { AdminError } from './policy';
const id=z.uuid();
export const readOperations=new Set(['PREVIEW_AUDIENCE','PREVIEW_EMAIL','NEXT_RUNS']);
export async function communicationOverview(){
 const [deliveries,outbox,runs]=await Promise.all([
  db.from('message_deliveries').select('id,channel,provider,status,latency_ms,created_at').not('dedupe_key','is',null).gte('created_at',new Date(Date.now()-7*86400000).toISOString()).order('created_at',{ascending:false}).limit(1000),
  db.from('integration_outbox').select('id,status,transport_status,created_at,published_at,next_attempt_at,last_error_code').eq('provider','COMMUNICATIONS').neq('status','completed').order('created_at').limit(1000),
  db.from('communication_runs').select('id,status,query_duration_ms,batch_count,created_at').order('created_at',{ascending:false}).limit(100),
 ]);[deliveries,outbox,runs].forEach(assertDb);
 const traffic=deliveries.data||[];
 const definitions=[['META_WHATSAPP','WHATSAPP_ACCESS_TOKEN'],['BREVO','BREVO_API_KEY'],['MSG91','MSG91_AUTH_KEY'],['LEMLIST','LEMLIST_API_KEY'],['QSTASH','QSTASH_TOKEN']];
 const providers=definitions.map(([name,env])=>{
  if(name==='QSTASH'){
   const sample=outbox.data||[];const success=sample.filter(e=>e.published_at);const failed=sample.filter(e=>e.last_error_code==='QSTASH_PUBLISH_FAILED');const observed=success.length+failed.length;
   return {name,status:!process.env[env]?'UNCONFIGURED':!observed?'UNKNOWN':!success.length?'DOWN':failed.length/observed>.1?'DEGRADED':'HEALTHY',last_success:success.map(e=>e.published_at!).sort().at(-1)||null,last_failure:failed.map(e=>e.created_at).sort().at(-1)||null,success_rate:observed?Math.round(success.length/observed*100):null,latency_ms:null,pending:sample.filter(e=>e.transport_status==='PENDING').length,retrying:failed.length};
  }
  const sample=traffic.filter(d=>d.provider===name);const failures=sample.filter(d=>['FAILED_PERMANENT','FAILED_RETRYABLE','RECONCILIATION_PENDING'].includes(d.status));const successes=sample.filter(d=>['ACCEPTED','SENT','DELIVERED','READ','OPENED','CLICKED'].includes(d.status));
  const observed=successes.length+failures.length;
  return {name,status:!process.env[env]?'UNCONFIGURED':!observed?'UNKNOWN':!successes.length?'DOWN':failures.length/observed>.1?'DEGRADED':'HEALTHY',last_success:successes[0]?.created_at||null,last_failure:failures[0]?.created_at||null,success_rate:observed?Math.round(successes.length/observed*100):null,latency_ms:observed?Math.round([...successes,...failures].reduce((a,b)=>a+(b.latency_ms||0),0)/observed):null,pending:sample.filter(d=>d.status==='PENDING').length,retrying:sample.filter(d=>d.status==='FAILED_RETRYABLE').length};
 });
 const daily=Array.from({length:7},(_,i)=>{const date=new Date(Date.now()-(6-i)*86400000).toISOString().slice(0,10);const sample=traffic.filter(d=>d.created_at.startsWith(date));return {date,queued:sample.length,accepted:sample.filter(d=>['ACCEPTED','SENT','DELIVERED','READ','OPENED','CLICKED'].includes(d.status)).length,delivered:sample.filter(d=>['DELIVERED','READ','OPENED','CLICKED'].includes(d.status)).length,engaged:sample.filter(d=>['READ','OPENED','CLICKED'].includes(d.status)).length,failed:sample.filter(d=>d.status.includes('FAILED')).length};});
 const pending=(outbox.data||[]).filter(o=>['pending','processing'].includes(o.status));
 return {providers,daily,processing:traffic.filter(d=>d.status==='SENDING').length,retrying:traffic.filter(d=>d.status==='FAILED_RETRYABLE').length,dlq:traffic.filter(d=>['FAILED_PERMANENT','RECONCILIATION_PENDING'].includes(d.status)).length+(outbox.data||[]).filter(o=>o.status==='failed').length,outbox_backlog:pending.length,outbox_oldest_at:pending[0]?.created_at||null,runs:runs.data,sample_limit:1000,dry_run:process.env.COMMUNICATION_DRY_RUN!=='false'};
}
export async function communicationMutation(operation:string,input:unknown,actor:string){
 if(operation==='SAVE_PREFERENCE'){
  const v=z.object({customer_id:id,channel:z.enum(['EMAIL','WHATSAPP','SMS']),purpose:z.enum(['TRANSACTIONAL','MARKETING']),allowed:z.boolean(),evidence_reference:z.string().min(1).max(500)}).strict().parse(input);
  const {evidence_reference,...preference}=v;
  assertDb(await db.from('communication_preferences').upsert({...preference,source:'OPERATOR_EVIDENCE',evidence:{reference:evidence_reference,recorded_by:actor},updated_at:new Date().toISOString()},{onConflict:'customer_id,channel,purpose'}));return {ok:true};
 }
 if(operation==='NEXT_RUNS'){const v=z.object({expression:z.string(),timezone:z.string()}).parse(input);return nextRuns(v.expression,v.timezone);}
 if(operation==='PREVIEW_EMAIL'){const v=z.object({html:z.string().max(200000),variables:z.record(z.string(),z.unknown())}).parse(input);return compileEmail(v.html,v.variables);}
 if(operation==='PREVIEW_AUDIENCE'){const v=z.object({condition:z.unknown()}).parse(input);const data=await rpc<unknown[]>('comm_audience',{p_condition:parseCondition(v.condition),p_limit:100});return {bounded_count:data.length,is_lower_bound:data.length===100,sample_customer_ids:data.slice(0,10).map(v=>(v as {customer_id:string}).customer_id)};}
 if(operation==='SAVE_RULE'){
  const v=z.object({id:id.optional(),expected_version:z.number().int().optional(),rule:ruleSchema}).strict().parse(input);
  const versions=Object.values(v.rule.action_config.templates);const t=await db.from('communication_template_versions').select('id,status').in('id',versions);assertDb(t);
  if(v.rule.status==='ACTIVE'&&(t.data?.length!==versions.length||t.data.some(v=>v.status!=='ACTIVE')))throw new AdminError('ACTIVE_TEMPLATE_REQUIRED',400);
  const data={...v.rule,channel_strategy:Object.keys(v.rule.action_config.templates),next_run_at:v.rule.status==='ACTIVE'&&v.rule.trigger_type==='SCHEDULE'?nextRuns(v.rule.cron_expression!,v.rule.timezone,new Date(v.rule.valid_from&&Date.parse(v.rule.valid_from)>Date.now()?v.rule.valid_from:Date.now()),1)[0]:null,approved_by:v.rule.status==='ACTIVE'?actor:null,approved_at:v.rule.status==='ACTIVE'?new Date().toISOString():null,updated_at:new Date().toISOString()};
  const result=v.id?await db.from('communication_rules').update({...data,version:(v.expected_version||0)+1}).eq('id',v.id).eq('version',v.expected_version||0).select().maybeSingle():await db.from('communication_rules').insert({...data,created_by:actor}).select().single();assertDb(result);if(!result.data)throw new AdminError('RULE_VERSION_CONFLICT',409);return result.data;
 }
 if(operation==='RUN_RULE'){
  const v=z.object({id,request_key:z.uuid(),dry_run:z.boolean().default(true)}).strict().parse(input);
  return rpc('comm_start_run',{p_rule_id:v.id,p_expected_next:null,p_next:null,p_key:`manual:${v.id}:${v.request_key}`,p_dry:v.dry_run||process.env.COMMUNICATION_DRY_RUN!=='false'});
 }
 if(operation==='SAVE_TEMPLATE')return saveTemplate(input,actor);
 if(operation==='TEST_TEMPLATE'){const v=z.object({id,destination:z.string().min(3).max(254)}).strict().parse(input);return rpc('comm_queue_template_test',{p_version_id:v.id,p_destination:v.destination});}
 if(operation==='ACTIVATE_TEMPLATE'){await activateTemplate(id.parse((input as {id:unknown}).id));return {ok:true};}
 if(operation==='SUBMIT_PROVIDER'){await submitProvider(id.parse((input as {id:unknown}).id));return {ok:true};}
 if(operation==='REFRESH_PROVIDER')return refreshMetaArtifact(id.parse((input as {id:unknown}).id));
 if(operation==='MAP_PROVIDER'){
  const v=z.object({version_id:id,provider_template_name:z.string().regex(/^[a-z0-9_]{1,100}$/).optional(),provider_language:z.string().max(20).optional(),provider_template_id:z.string().max(100).optional(),sync_mode:z.enum(['DIRECT_CONTENT','PROVIDER_TEMPLATE','SEQUENCE_STEP','EXTERNAL_APPROVAL_MAPPING']).optional(),dlt_entity_id:z.string().max(100).optional(),dlt_header_id:z.string().max(100).optional(),dlt_template_id:z.string().max(100).optional(),dlt_status:z.enum(['DRAFT','PENDING','APPROVED','REJECTED']).optional(),msg91_template_id:z.string().max(100).optional(),msg91_status:z.enum(['DRAFT','READY','DISABLED']).optional(),lemlist_campaign_id:z.string().max(100).optional(),lemlist_sequence_id:z.string().max(100).optional(),lemlist_step_id:z.string().max(100).optional()}).strict().parse(input);
  const t=await db.from('communication_template_versions').select('status,channel').eq('id',v.version_id).single();assertDb(t);if(!t.data||t.data.status!=='DRAFT')throw new AdminError('IMMUTABLE_ACTIVE_ARTIFACT',409);
  const {version_id,...mapping}=v;
  if(t.data.channel==='WHATSAPP'&&('provider_template_id' in mapping||mapping.sync_mode&&mapping.sync_mode!=='PROVIDER_TEMPLATE'))throw new AdminError('PROVIDER_OWNED_APPROVAL',400);
  if(t.data.channel!=='SMS'&&Object.keys(mapping).some(k=>k.startsWith('dlt_')||k.startsWith('msg91_')))throw new AdminError('INVALID_PROVIDER_MAPPING',400);
  const result=await db.from('communication_template_provider_artifacts').update({...mapping,updated_at:new Date().toISOString()}).eq('template_version_id',version_id);
  if(result.error?.code==='23505')throw new AdminError('PROVIDER_CAMPAIGN_ALREADY_MAPPED',409);assertDb(result);return {ok:true};
 }
 if(operation==='RETRY_DELIVERY'){
  const v=z.object({id}).parse(input);const result=await db.from('message_deliveries').update({status:'FAILED_RETRYABLE',next_attempt_at:new Date().toISOString()}).eq('id',v.id).eq('status','FAILED_PERMANENT').not('dedupe_key','is',null).select('id');assertDb(result);if(!result.data?.length)throw new AdminError('AMBIGUOUS_DELIVERY_CANNOT_RETRY',409);return {ok:true};
 }
 if(operation==='RECOVER_ORDERS'){const v=z.object({reset:z.boolean().default(false)}).parse(input);return {scanned:await rpc('comm_recover_orders',{p_reset:v.reset})};}
 if(operation==='RETRY_OUTBOX'){
  const v=z.object({id}).strict().parse(input);const result=await db.from('integration_outbox').update({status:'pending',transport_status:'PENDING',attempt_count:0,lease_until:null,next_attempt_at:new Date().toISOString(),last_error_code:null,last_error_message:null}).eq('id',v.id).eq('provider','COMMUNICATIONS').eq('status','failed').eq('last_error_code','TRANSPORT_ATTEMPTS_EXHAUSTED').select('id');assertDb(result);if(!result.data?.length)throw new AdminError('OUTBOX_REPLAY_NOT_ALLOWED',409);return {ok:true};
 }
 if(operation==='RECOVER_STATE'){const v=z.object({source:z.enum(['orders','subscriptions','payments','shipments']),reset:z.boolean().default(false)}).strict().parse(input);return {scanned:await rpc('comm_recover_state',{p_source:v.source,p_reset:v.reset})};}
 throw new AdminError('UNKNOWN_OPERATION',400);
}
