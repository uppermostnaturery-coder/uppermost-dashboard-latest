import { requireAdmin,assertSameOrigin,adminErrorResponse } from '@/lib/admin/auth';
import { communicationMutation,communicationOverview,readOperations } from '@/lib/admin/communications';
import { db,assertDb } from '@/lib/communications/store';
import { readJsonBody } from '@/lib/commerce/http';
import { z,ZodError } from 'zod';
export const dynamic='force-dynamic';
const resources={rules:'communication_rules',runs:'communication_runs',templates:'communication_templates',versions:'communication_template_versions',artifacts:'communication_template_provider_artifacts',deliveries:'message_deliveries',dlq:'message_deliveries',outbox_dlq:'integration_outbox',assets:'communication_assets'} as const;
export async function GET(request:Request){try{
 const operator=await requireAdmin(request);const params=new URL(request.url).searchParams;const resource=params.get('resource')||'overview';
 if(resource==='overview'||resource==='providers')return Response.json({data:await communicationOverview(),role:operator.role});
 const table=resources[resource as keyof typeof resources];if(!table)return Response.json({error:'INVALID_RESOURCE'},{status:400});
 const cursor=params.get('cursor');if(cursor)z.uuid().parse(cursor);
 const columns=resource==='outbox_dlq'?'id,event_type,operation,lane,attempt_count,transport_status,last_error_code,last_error_message,created_at':resource==='deliveries'||resource==='dlq'?'id,customer_message_id,channel,provider,provider_message_id,status,template_version_id,retry_count,next_attempt_at,latency_ms,suppression_reason,created_at':resource==='artifacts'?'id,template_id,template_version_id,provider,provider_status,provider_status_reason,provider_template_id,provider_template_name,provider_language,sync_mode,dlt_entity_id,dlt_header_id,dlt_template_id,dlt_status,msg91_template_id,msg91_status,lemlist_campaign_id,lemlist_sequence_id,lemlist_step_id,last_synced_at,last_error':'*';
 let query=db.from(table).select(columns).order('id').limit(100);if(cursor)query=query.gt('id',cursor);
 if(resource==='deliveries'||resource==='dlq')query=query.not('dedupe_key','is',null);if(resource==='dlq')query=query.in('status',['FAILED_PERMANENT','RECONCILIATION_PENDING']);
 if(resource==='outbox_dlq')query=query.eq('provider','COMMUNICATIONS').eq('status','failed');
 const result=await query;assertDb(result);const rows=result.data as unknown as {id:string}[];return Response.json({data:rows,role:operator.role,next_cursor:rows.length===100?rows[99].id:null});
}catch(error){return adminErrorResponse(error);}}
export async function POST(request:Request){try{
 assertSameOrigin(request);const body=z.object({operation:z.string().max(50),input:z.unknown()}).strict().parse(await readJsonBody(request));
 const operator=await requireAdmin(request,!readOperations.has(body.operation));return Response.json({data:await communicationMutation(body.operation,body.input,operator.userId)});
}catch(error){if(error instanceof ZodError)return Response.json({error:'INVALID_CONFIGURATION',issues:error.issues},{status:400});return adminErrorResponse(error);}}
