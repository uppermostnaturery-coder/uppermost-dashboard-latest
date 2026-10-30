import {rpc} from './store';
import {stagingEmailSuppressionReason} from './stagingEmailSafety';

// Dormant service-only operations. No route, dispatcher, sender or flag calls
// these operations. A reservation records a spent budget, never a send bypass.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function assertId(id:string){if(!uuid.test(id))throw new Error('E2E_IDENTIFIER_INVALID');}
function assertStaging(){
 if(stagingEmailSuppressionReason()!=='STAGING_EMAIL_DRY_RUN')throw new Error('E2E_CONTEXT_INVALID');
}
function serverContext(){
 assertStaging();
 const build=process.env.VERCEL_GIT_COMMIT_SHA;
 const reviewed=process.env.COMMUNICATION_E2E_REVIEWED_BUILD_SHA;
 const app=process.env.WHATSAPP_APP_ID,waba=process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,sender=process.env.WHATSAPP_PHONE_NUMBER_ID;
 if(!build||!/^[0-9a-f]{40}$/.test(build)||reviewed!==build||![app,waba,sender].every(v=>typeof v==='string'&&/^[0-9]+$/.test(v)))throw new Error('E2E_CONTEXT_INVALID');
 return {project_ref:'jwsivyxapfnyaafdcdos',base_url:'https://staging.uppermost.store',environment:'preview',branch:'staging',dry_run:true,
  build_sha:build,reviewed_build_sha:reviewed,app_id:app,waba_id:waba,sender_id:sender};
}
export type WhatsAppE2EAuthorizationInput={deliveryId:string;approvalRef:string;approvedBy:string;consentId:string;expiresAt:string};
export async function authorizeWhatsAppE2E(input:WhatsAppE2EAuthorizationInput):Promise<string>{
 const context=serverContext();
 for(const id of [input.deliveryId,input.approvalRef,input.approvedBy,input.consentId])assertId(id);
 const expiry=Date.parse(input.expiresAt),remaining=expiry-Date.now();
 if(!Number.isFinite(remaining)||remaining<=0||remaining>15*60000)throw new Error('E2E_EXPIRY_INVALID');
 try{
  const id=await rpc<unknown>('comm_authorize_whatsapp_e2e',{p_delivery_id:input.deliveryId,p_context:context,p_approval_ref:input.approvalRef,p_approved_by:input.approvedBy,p_consent_id:input.consentId,p_expires_at:new Date(expiry).toISOString()});
  if(typeof id!=='string'||!uuid.test(id))throw new Error('INVALID_RESPONSE');
  return id;
 }catch{throw new Error('E2E_AUTHORIZATION_UNAVAILABLE');}
}
export async function reserveWhatsAppE2E(authorizationId:string):Promise<boolean>{
 const context=serverContext();assertId(authorizationId);
 // Never retry this RPC: a lost response can mean the budget was consumed.
 try{return await rpc<unknown>('comm_reserve_whatsapp_e2e',{p_id:authorizationId,p_context:context})===true;}
 catch{throw new Error('E2E_RESERVATION_UNAVAILABLE');}
}
export async function revokeWhatsAppE2E(authorizationId:string):Promise<void>{
 // Rollback does not depend on a still-current build or working Meta credentials.
 assertStaging();assertId(authorizationId);
 try{await rpc('comm_revoke_whatsapp_e2e',{p_id:authorizationId});}
 catch{throw new Error('E2E_REVOCATION_UNAVAILABLE');}
}
