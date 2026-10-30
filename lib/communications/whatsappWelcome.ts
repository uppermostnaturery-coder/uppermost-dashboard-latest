import {rpc} from './store';
import {stagingEmailSuppressionReason} from './stagingEmailSafety';

export type WhatsAppWelcomeResult={status:'dry_run'|'skipped'|'failed';welcomeState:string;message?:string};
// Only the verified staging environment owns this path. It records intent, never sends.
export async function connectWhatsAppWelcome(leadId:string):Promise<WhatsAppWelcomeResult|null>{
 const staging=stagingEmailSuppressionReason();
 if(staging===null)return null;
 if(staging!=='STAGING_EMAIL_DRY_RUN')return {status:'skipped',welcomeState:'configuration_invalid'};
 try{
  const result=await rpc<{status:string}>('comm_connect_whatsapp_welcome',{p_lead_id:leadId});
  if(['pending','already_connected'].includes(result?.status))return {status:'dry_run',welcomeState:result.status};
  if(['opted_out','ineligible'].includes(result?.status))return {status:'skipped',welcomeState:result.status};
  throw new Error('INVALID_WELCOME_RESULT');
 }catch{return {status:'failed',welcomeState:'connection_failed',message:'Signup saved. WhatsApp welcome needs attention.'};}
}
