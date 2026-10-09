import { describe, expect, it, beforeAll } from 'vitest';
import { encryptOtp, decryptOtp, hashOtp, generateOtp } from '../../lib/communications/otpCrypto';
beforeAll(()=>{process.env.OTP_ENCRYPTION_KEY=Buffer.alloc(32,7).toString('base64');});
describe('one protected OTP challenge',()=>{
 it('uses six secure digits, authenticated encryption and a challenge-bound hash',()=>{
  const code=generateOtp();expect(code).toMatch(/^\d{6}$/);
  const encrypted=encryptOtp('challenge',code);expect(encrypted).not.toContain(code);
  expect(decryptOtp('challenge',encrypted)).toBe(code);
  expect(()=>decryptOtp('other',encrypted)).toThrow();
  expect(hashOtp('challenge',code)).not.toBe(hashOtp('other',code));
 });
});
