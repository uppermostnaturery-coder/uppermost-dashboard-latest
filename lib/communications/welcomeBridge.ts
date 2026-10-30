import { rpc } from './store';
import { stagingEmailSuppressionReason } from './stagingEmailSafety';

type BridgeStatus='connected'|'already_connected'|'opted_out'|'ineligible'|'configuration_invalid'|'failed';
export type SignupWelcomeResult={status:'dry_run';bridgeStatus:BridgeStatus;message:string};

// null means this environment retains its existing legacy ownership.
// The staging path never calls a provider, including after an RPC failure.
export async function connectSignupWelcome(leadId:string,stage:string):Promise<SignupWelcomeResult|null>{
 const staging=stagingEmailSuppressionReason();
 if(!staging)return null;
 if(staging!=='STAGING_EMAIL_DRY_RUN')return {status:'dry_run',bridgeStatus:'configuration_invalid',message:'Welcome connection disabled: staging configuration needs attention. No email was sent.'};
 if(stage!=='completed')return {status:'dry_run',bridgeStatus:'ineligible',message:'Welcome connection waits for completed signup. No email was sent.'};
 try{
  const result=await rpc<{status:string}>('comm_connect_lead_welcome',{p_lead_id:leadId});
  const status=result?.status;
  if(status!=='connected'&&status!=='already_connected'&&status!=='opted_out'&&status!=='ineligible')throw new Error('INVALID_BRIDGE_RESULT');
  return {status:'dry_run',bridgeStatus:status,message:status==='opted_out'?'Existing email opt-out preserved. No Welcome event was created.':status==='ineligible'?'Signup is not eligible for a Welcome event. No email was sent.':'Welcome signup connection recorded. Email sending remains disabled.'};
 }catch{
  return {status:'dry_run',bridgeStatus:'failed',message:'Signup saved, but the Welcome connection needs attention. No email was sent.'};
 }
}
