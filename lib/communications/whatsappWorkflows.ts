import {rpc} from './store';
import {stagingEmailSuppressionReason} from './stagingEmailSafety';

// Production keeps its existing path. New RPCs require the reviewed additive migration.
export function stagingWhatsAppWorkflowsEnabled(){
 return stagingEmailSuppressionReason()==='STAGING_EMAIL_DRY_RUN';
}
const managed=new Set(['WELCOME','CART_RECOVERY','CHECKOUT_RECOVERY','PAYMENT_FAILED','ORDER_CONFIRMATION','ORDER_SHIPPED','OUT_FOR_DELIVERY','DELIVERY_CONFIRMATION','SHIPPING_UPDATE'].map(w=>`UPPERMOST_WHATSAPP_${w}_V1`));
export function isManagedWhatsAppRule(name:string){return managed.has(name);}
export async function captureWhatsAppWorkflows(){
 if(!stagingWhatsAppWorkflowsEnabled())return;
 await rpc('comm_capture_whatsapp_workflows',{p_limit:50});
}
export async function dispatchWhatsAppWorkflows(){
 if(!stagingWhatsAppWorkflowsEnabled())return;
 await captureWhatsAppWorkflows();
 await rpc('comm_dispatch_whatsapp_workflows',{p_limit:50,p_dry:true});
}
