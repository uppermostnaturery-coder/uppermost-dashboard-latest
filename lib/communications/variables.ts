// Event facts remain server-owned. Campaign constants cannot override purchase facts.
export const resolvedVariableKeys=new Set(['name','message_title','message_body','order_id','order_number','total_paise','discount_paise','event_at','payment_status','shipment_status','subscription_status','interval_days','next_charge_at']);
export function resolveMessageVariables(customer:{name:string;email?:string},message:{title:string;body:string},facts:Record<string,unknown>,constants:Record<string,unknown>){
 const values:Record<string,unknown>=Object.fromEntries(Object.entries(constants).filter(([key])=>!resolvedVariableKeys.has(key)));
 Object.assign(values,{name:customer.name,message_title:message.title,message_body:message.body});
 for(const key of ['order_id','order_number','total_paise','discount_paise','interval_days','next_charge_at'])if(facts[key]!==undefined&&facts[key]!==null)values[key]=facts[key];
 if(facts.at)values.event_at=facts.at;
 const statusKey={'commerce.payment.changed':'payment_status','commerce.shipment.changed':'shipment_status','commerce.subscription.changed':'subscription_status'}[String(facts.event_type)];
 if(statusKey&&facts.status)values[statusKey]=facts.status;
 return values;
}
