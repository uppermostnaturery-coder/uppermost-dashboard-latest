import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  saved: [] as Record<string, unknown>[],
  whatsapp: vi.fn(),
  bridge: vi.fn(),
  lead: { id: '11111111-1111-4111-8111-111111111111', first_name: 'Dummy', email: 'dummy@example.test', phone: '+919000000000', purpose: 'taste', segment: 'taste', consent_email: true, purposes: [], purpose_history: [], metadata: {}, lead_score: 0, status: 'new', human_followup_required: false },
}));
vi.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => state.bridge(...args),
    from(table: string) {
      const query: any = {
        select() { return query; }, eq() { return query; }, limit() { return query; },
        in() { return query; }, delete() { return query; },
        update(value: Record<string, unknown>) { if (table === 'um_leads') state.saved.push(value); return query; },
        insert(value: Record<string, unknown>) { if (table === 'um_leads') state.saved.push(value); return query; },
        maybeSingle: async () => ({ data: state.lead, error: null }),
        single: async () => ({ data: state.lead, error: null }),
        then(resolve: any) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return query;
    },
  },
}));
vi.mock('../../lib/whatsapp/legacy', () => ({ legacyWhatsAppWelcome: state.whatsapp }));
import { POST as leadPost } from '../../app/api/lead/route';
import { POST as launchPost } from '../../app/api/launch-signup/route';

let http: ReturnType<typeof vi.fn>;
beforeEach(() => {
  state.saved = [];
  state.bridge.mockReset().mockResolvedValue({data:{status:"connected",customer_id:"internal-customer",outbox_id:"internal-outbox"},error:null});
  state.whatsapp.mockReset().mockResolvedValue(Response.json({ success: true, metaMessageId: 'FAKE_WHATSAPP' }));
  for (const [key, value] of Object.entries({
    VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'staging',
    NEXT_PUBLIC_SUPABASE_URL: 'https://jwsivyxapfnyaafdcdos.supabase.co',
    COMMUNICATION_BASE_URL: 'https://staging.uppermost.store',
    COMMUNICATION_DRY_RUN: 'true', COMMUNICATION_ALLOWED_TEST_EMAILS: 'dummy@example.test',
    BREVO_API_KEY: 'FAKE_TEST_ONLY', BREVO_MARKETING_LIST_ID: '1', BREVO_WELCOME_TEMPLATE_ID: '18',
    LEMLIST_API_KEY: 'FAKE_TEST_ONLY',
  })) vi.stubEnv(key, value);
  http = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ messageId: 'FAKE_EMAIL', id: 1 }));
  vi.stubGlobal('fetch', http);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function request(path: string, extra: Record<string, unknown> = {}) {
  return new Request('https://staging.uppermost.store' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstName: 'Dummy', email: 'dummy@example.test', phone: '9000000000', purpose: 'taste', stage: 'completed', marketingConsent: true, emailConsent: true, consentWhatsApp: false, whatsappConsent: false, ...extra }),
  });
}
describe('staging lead routes preserve saving while blocking email automation', () => {
  it('connects the saved completed signup through the bridge and does not expose internal customer IDs', async () => {
    const body=await (await leadPost(request('/api/lead',{metadata:{customer_id:'forged',lead_stage:'completed'}}))).json();
    expect(state.bridge).toHaveBeenCalledWith('comm_connect_lead_welcome',{p_lead_id:state.lead.id});
    expect(body.integrations.welcomeEmail.bridgeStatus).toBe('connected');
    expect(JSON.stringify(body)).not.toContain('internal-customer');
    expect(http).not.toHaveBeenCalled();
  });
  it('keeps signup saved on bridge failure and never falls back to direct Brevo', async () => {
    state.bridge.mockResolvedValue({data:null,error:{message:'PRIVATE_DATABASE_ERROR'}});
    const body=await (await leadPost(request('/api/lead'))).json();
    expect(body.leadSaved).toBe(true);
    expect(body.integrations.welcomeEmail.bridgeStatus).toBe('failed');
    expect(body.warnings.join(' ')).toContain('Welcome connection needs attention');
    expect(JSON.stringify(body)).not.toContain('PRIVATE_DATABASE_ERROR');
    expect(http).not.toHaveBeenCalled();
  });
  it.each(['true', 'false', undefined])('lead route sends no email/contact/enrollment requests with dry flag %s', async value => {
    vi.stubEnv('COMMUNICATION_DRY_RUN', value);
    const response = await leadPost(request('/api/lead'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.leadSaved).toBe(true);
    expect(state.saved).toHaveLength(1);
    expect(body.integrations.welcomeEmail.status).toBe('dry_run');
    expect(body.integrations.brevo.status).toBe('dry_run');
    expect(body.integrations.lemlist.status).toBe('dry_run');
    expect(http).not.toHaveBeenCalled();
  });
  it('cannot bypass staging email suppression through request metadata', async () => {
    const response = await leadPost(request('/api/lead', { metadata: { communication_mode: 'LIVE' } }));
    expect((await response.json()).integrations.welcomeEmail.status).toBe('dry_run');
    expect(http).not.toHaveBeenCalled();
  });
  it('records the consented WhatsApp intent without invoking the legacy sender', async () => {
    state.bridge.mockImplementation(async(name:string)=>({data:{status:name==='comm_connect_whatsapp_welcome'?'pending':'connected'},error:null}));
    const response = await leadPost(request('/api/lead', { consentWhatsApp: true }));
    const body = await response.json();
    expect(body.integrations.whatsappWelcome.status).toBe('dry_run');
    expect(state.bridge).toHaveBeenCalledWith('comm_connect_whatsapp_welcome',{p_lead_id:state.lead.id});
    expect(state.whatsapp).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
  });
  it('does not infer launch WhatsApp permission from phone and email consent',async()=>{
    const body=await(await launchPost(request('/api/launch-signup',{whatsappConsent:undefined,consentWhatsApp:undefined}))).json();
    expect(body.leadSaved).toBe(true);expect((state.saved[0].metadata as any).consent_whatsapp).toBe(false);
    expect(state.bridge.mock.calls.some(c=>c[0]==='comm_connect_whatsapp_welcome')).toBe(false);
  });
  it('connects explicitly consented launch signup using its persisted lead ID',async()=>{
    state.bridge.mockResolvedValue({data:{status:'pending'},error:null});
    const body=await(await launchPost(request('/api/launch-signup',{whatsappConsent:true}))).json();
    expect(state.saved[0].consent_whatsapp).toBe(true);expect(body.integrations.whatsappWelcome).toMatchObject({status:'dry_run',welcomeState:'pending'});
    expect(state.whatsapp).not.toHaveBeenCalled();expect(http).not.toHaveBeenCalled();
  });
  it('synchronizes explicit launch WhatsApp withdrawal without invoking a sender',async()=>{
    state.bridge.mockResolvedValue({data:{status:'opted_out'},error:null});
    const body=await(await launchPost(request('/api/launch-signup',{whatsappConsent:false}))).json();
    expect(state.bridge).toHaveBeenCalledWith('comm_connect_whatsapp_welcome',{p_lead_id:state.lead.id});
    expect(body.integrations.whatsappWelcome).toMatchObject({status:'skipped',welcomeState:'opted_out'});expect(state.whatsapp).not.toHaveBeenCalled();
  });
  it('preserves the existing form contract when required email consent is omitted',async()=>{
    state.bridge.mockResolvedValue({data:{status:'pending'},error:null});
    const response=await leadPost(request('/api/lead',{marketingConsent:undefined,emailConsent:undefined,consentWhatsApp:true}));
    expect(response.status).toBe(400);expect(state.saved).toHaveLength(0);expect(state.whatsapp).not.toHaveBeenCalled();
  });
  it('launch-signup saves successfully but never reports a send or Brevo sync in dry-run', async () => {
    const response = await launchPost(request('/api/launch-signup'));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.leadSaved).toBe(true);
    expect(body.emailSent).toBe(false);
    expect(body.brevoSynced).toBe(false);
    expect(body.integrations.brevo.status).toBe('dry_run');
    expect(http).not.toHaveBeenCalled();
  });
  it('preserves the non-staging direct welcome/Brevo behavior through fake HTTP', async () => {
    vi.stubEnv('COMMUNICATION_DRY_RUN','false');
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://production.example.test');
    vi.stubEnv('COMMUNICATION_BASE_URL', 'https://production.example.test');
    vi.stubEnv('LEMLIST_API_KEY', undefined);
    const response = await leadPost(request('/api/lead'));
    const body = await response.json();
    expect(body.integrations.welcomeEmail.status).toBe('sent');
    expect(body.integrations.brevo.status).toBe('synced');
    expect(http.mock.calls.some(call => String(call[0]).endsWith('/smtp/email'))).toBe(true);
  });
});
