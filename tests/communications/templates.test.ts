import { describe, expect, it } from "vitest";
import { compileEmail, compileLemlistEmail, videoPoster, assertProviderReady } from "../../lib/communications/email";
import { classifyProviderFailure, retryDelay } from "../../lib/communications/providers/http";
describe("canonical delivery content", () => {
 it('preserves declared Lemlist personalization after sanitizing canonical HTML',()=>{
  expect(compileLemlistEmail('<p>Hello {{firstName}}</p>',['firstName'])).toBe('<p>Hello {{firstName}}</p>');
  expect(()=>compileLemlistEmail('<p>{{unknown}}</p>',['firstName'])).toThrow();
  expect(()=>compileLemlistEmail('<script>{{firstName}}</script>',['firstName'])).toThrow();
 });
 it("rejects active HTML, handlers, insecure assets and missing variables", () => {
  for (const html of ['<script>alert(1)</script>','<iframe src="https://x.test"></iframe>','<form></form>','<img src="https://x.test/a" onerror="alert(1)">','<img src="http://x.test/a">','<a href="javascript:alert(1)">x</a>','<p>{{missing}}</p>']) {
   expect(() => compileEmail(html,{})).toThrow();
  }
 });
 it("escapes variables and renders videos as secure poster links", () => {
  expect(compileEmail('<p>{{name}}</p>',{name:'<script>'}).html).toBe('<p>&lt;script&gt;</p>');
  const video = videoPoster('https://x.test/video','https://x.test/poster.png','Watch');
  expect(video).toContain('<a');expect(video).not.toContain('<video');
 });
 it("requires provider approval/DLT mapping and excludes Lemlist transactional traffic", () => {
  expect(() => assertProviderReady('WHATSAPP','TRANSACTIONAL',{provider_status:'PENDING'})).toThrow();
  expect(() => assertProviderReady('WHATSAPP','TRANSACTIONAL',{provider_status:'APPROVED'})).not.toThrow();
  expect(() => assertProviderReady('SMS','MARKETING',{dlt_status:'APPROVED'})).toThrow();
  expect(() => assertProviderReady('LEMLIST','TRANSACTIONAL',{lemlist_step_id:'step'})).toThrow();
 });
 it("distinguishes explicit failures from ambiguous transport outcomes", () => {
  expect(classifyProviderFailure(429,false)).toBe('FAILED_RETRYABLE');
  expect(classifyProviderFailure(400,false)).toBe('FAILED_PERMANENT');
  expect(classifyProviderFailure(undefined,true)).toBe('RECONCILIATION_PENDING');
  expect(retryDelay(2,120,0)).toBe(120000);
 });
});
