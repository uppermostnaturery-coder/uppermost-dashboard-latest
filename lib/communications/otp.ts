import { randomUUID,createHmac } from 'node:crypto';
import { generateOtp,encryptOtp,decryptOtp,hashOtp } from './otpCrypto';
import { db,rpc,assertDb } from './store';
import { publishOutbox } from './transport';
import { sendProvider } from './providers/send';
import { isAllowedTestDestination } from './preferences';
import { ProviderError } from './providers/http';
export async function createOtp(phone:string|null,email:string|null,ip:string){
 const id=randomUUID();const otp=generateOtp();const digest=(v:string)=>createHmac('sha256',process.env.OTP_ENCRYPTION_KEY!).update(v).digest('hex');
 await rpc('comm_create_otp',{p_id:id,p_phone:phone,p_email:email,p_hash:hashOtp(id,otp),p_encrypted:encryptOtp(id,otp),p_ip_key:digest(ip),p_identity_key:digest(phone||email!),p_ttl:Math.min(600,Math.max(60,Number(process.env.OTP_TTL_SECONDS)||300))});
 await publishOutbox(5).catch(()=>{});return {challenge_id:id,expires_in_seconds:Math.min(600,Math.max(60,Number(process.env.OTP_TTL_SECONDS)||300))};
}
export async function verifyOtp(id:string,code:string){return rpc<boolean>('comm_verify_otp',{p_id:id,p_hash:hashOtp(id,code)});}
export async function deliverOtp(id:string){
 const challenges=await rpc<Record<string,unknown>[]>('comm_claim_otp',{p_id:id});if(!challenges.length){
  const state=await db.from('communication_otp_challenges').select('send_state').eq('id',id).maybeSingle();assertDb(state);
  if(state.data?.send_state==='SENDING')throw new Error('OTP_RESERVATION_IN_PROGRESS');
  return;
 }
 const c=challenges[0];const channels=['WHATSAPP','SMS','EMAIL'];const index=Number(c.send_channel_index);const channel=channels[index];
 const destination=String(channel==='EMAIL'?c.email||'':c.phone||'');
 let attempted=false;
 try{
  if(!destination)throw new Error('DESTINATION_UNAVAILABLE');
  if(process.env.COMMUNICATION_DRY_RUN!=='false'&&!isAllowedTestDestination(channel,destination)){await rpc('comm_finish_otp',{p_id:id,p_success:true,p_state:'DRY_RUN'});return;}
  const versionId=process.env[`OTP_${channel}_TEMPLATE_VERSION`];if(!versionId)throw new Error('OTP_TEMPLATE_UNCONFIGURED');
  const v=await db.from('communication_template_versions').select('*').eq('id',versionId).eq('category','AUTHENTICATION').eq('status','ACTIVE').single();assertDb(v);
  const a=await db.from('communication_template_provider_artifacts').select('*').eq('template_version_id',versionId).maybeSingle();assertDb(a);
  const otp=decryptOtp(id,String(c.encrypted_otp));
  const reserve=await db.from('communication_otp_challenges').update({provider_attempted_at:new Date().toISOString()}).eq('id',id).eq('send_state','SENDING').is('verified_at',null).gt('expires_at',new Date().toISOString()).select('id');assertDb(reserve);
  if(!reserve.data?.length)return;
  attempted=true;await sendProvider(v.data,a.data,destination,{otp});
  await rpc('comm_finish_otp',{p_id:id,p_success:true,p_state:'ACCEPTED'});
 }catch(error){
  if(attempted&&(!(error instanceof ProviderError)||error.state==='RECONCILIATION_PENDING')){
   await rpc('comm_finish_otp',{p_id:id,p_success:true,p_state:'RECONCILIATION_PENDING'});return;
  }
  await rpc('comm_finish_otp',{p_id:id,p_success:false,p_state:'FALLBACK'});
 }
}
