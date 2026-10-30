import {supabaseAdmin} from '../../supabaseAdmin';
import {CommerceError} from '../http';
import {stagingShippingSimulation} from './simulationConfig';

export async function ensureSimulatedShipment(orderId:string):Promise<void>{
 const config=stagingShippingSimulation();
 if(!config)throw new CommerceError('SHIPPING_SIMULATION_DISABLED','Staging shipping simulation is disabled.',409);
 const {data,error}=await supabaseAdmin.rpc('comm_create_simulated_shipment',{p_order_id:orderId,p_context:config.context});
 if(error||!data?.simulated||typeof data.shipment_id!=='string')throw new Error('SIMULATED_SHIPMENT_UNAVAILABLE');
}

export async function transitionSimulatedShipment(input:{order_id:string;shipment_id:string;event_id:string;status:'SHIPPED'|'OUT_FOR_DELIVERY'|'DELIVERED'},actorId:string){
 const config=stagingShippingSimulation();
 if(!config)throw new CommerceError('SHIPPING_SIMULATION_DISABLED','Staging shipping simulation is disabled.',409);
 const {data,error}=await supabaseAdmin.rpc('comm_transition_simulated_shipment',{
  p_order_id:input.order_id,p_shipment_id:input.shipment_id,p_status:input.status,p_event_id:input.event_id,p_actor_id:actorId,p_context:config.context,
 });
 if(error)throw new CommerceError('SIMULATION_TRANSITION_REJECTED','The simulated shipment transition was rejected.',409);
 if(!data||data.simulated!==true)throw new Error('SIMULATED_SHIPMENT_UNAVAILABLE');
 return data;
}
