import { createCipheriv,createDecipheriv,createHmac,randomBytes,randomInt } from 'node:crypto';
function key(){const k=Buffer.from(process.env.OTP_ENCRYPTION_KEY||'','base64');if(k.length!==32)throw new Error('OTP_ENCRYPTION_KEY_MUST_BE_32_BYTES');return k;}
export function generateOtp(){return randomInt(0,1000000).toString().padStart(6,'0');}
export function hashOtp(id:string,otp:string){return createHmac('sha256',key()).update(`${id}:${otp}`).digest('hex');}
export function encryptOtp(id:string,otp:string){
 const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(id));
 const encrypted=Buffer.concat([cipher.update(otp,'utf8'),cipher.final()]);
 return [iv.toString('base64'),encrypted.toString('base64'),cipher.getAuthTag().toString('base64')].join('.');
}
export function decryptOtp(id:string,value:string){
 const [iv,ciphertext,tag]=value.split('.');const cipher=createDecipheriv('aes-256-gcm',key(),Buffer.from(iv,'base64'));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(Buffer.from(tag,'base64'));return Buffer.concat([cipher.update(Buffer.from(ciphertext,'base64')),cipher.final()]).toString('utf8');
}
