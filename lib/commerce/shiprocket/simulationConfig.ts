import {CommerceError} from '../http';

const unavailable=()=>new CommerceError('SHIPPING_SIMULATION_CONFIGURATION_INVALID','Staging shipping simulation is unavailable.',503);

export function shippingSimulationSelected():boolean{
 const value=process.env.SHIPROCKET_STAGING_SIMULATION_ENABLED;
 return value!==undefined&&value!==''&&value!=='false';
}

export function stagingShippingSimulation(){
 if(!shippingSimulationSelected())return null;
 const sha=process.env.VERCEL_GIT_COMMIT_SHA||'';
 if(process.env.SHIPROCKET_STAGING_SIMULATION_ENABLED!=='true'
  ||process.env.SHIPROCKET_API_ENABLED!=='false'||process.env.VERCEL_ENV!=='preview'
  ||process.env.VERCEL_GIT_COMMIT_REF!=='staging'
  ||process.env.NEXT_PUBLIC_SUPABASE_URL!=='https://jwsivyxapfnyaafdcdos.supabase.co'
  ||process.env.COMMUNICATION_BASE_URL!=='https://staging.uppermost.store'
  ||process.env.COMMUNICATION_DRY_RUN!=='true'
  ||!/^rzp_test_[A-Za-z0-9]+$/.test(process.env.RAZORPAY_KEY_ID||'')||!/^[0-9a-f]{40}$/.test(sha))throw unavailable();
 const pincodes=(process.env.SHIPROCKET_STAGING_TEST_PINCODES||'').split(',').map(p=>p.trim());
 if(pincodes.length===0||pincodes.length>20||pincodes.some(p=>!/^[1-9][0-9]{5}$/.test(p)))throw unavailable();
 return {pincodes,context:{project_ref:'jwsivyxapfnyaafdcdos',base_url:'https://staging.uppermost.store',environment:'preview',branch:'staging',dry_run:true,api_enabled:false,simulation_enabled:true,razorpay_test_key:true,build_sha:sha,test_pincodes:pincodes}};
}

export function simulatedServiceability(postalCode:string){
 const config=stagingShippingSimulation();
 if(!config)throw unavailable();
 const allowed=config.pincodes.includes(postalCode);
 return {serviceable:allowed,
  estimated_delivery_from:allowed?new Date(Date.now()+3*86400000).toISOString():null,
  estimated_delivery_to:allowed?new Date(Date.now()+5*86400000).toISOString():null,
  shipping_amount_paise:0,
  message:allowed?'SIMULATED staging shipping: test delivery estimate in 3–5 days; no carrier shipment or delivery promise.':'SIMULATED staging shipping: this pincode is not configured for testing.',
  simulated:true,simulation_project_ref:config.context.project_ref,simulation_postal_code:postalCode};
}

// Live quotes retain their existing comparison. Simulation provenance must not
// silently disappear (or appear) when checkout reprices an already-issued quote.
export function simulationQuoteMismatch(stored:Record<string,unknown>,current:Record<string,unknown>):boolean{
 if(stored.simulated!==true&&current.simulated!==true)return false;
 return stored.simulated!==true||current.simulated!==true
  ||stored.simulation_project_ref!=='jwsivyxapfnyaafdcdos'||current.simulation_project_ref!==stored.simulation_project_ref
  ||typeof stored.simulation_postal_code!=='string'||!/^[1-9][0-9]{5}$/.test(stored.simulation_postal_code)
  ||current.simulation_postal_code!==stored.simulation_postal_code;
}
