import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  delivery: {} as Record<string, any>,
  rows: {} as Record<string, any>,
  status: 'PENDING',
  updates: [] as Record<string, any>[],
  marketingAllowed:true,
}));
vi.mock('../../lib/communications/store', () => ({
  db: {
    from(table: string) {
      const query: any = {
        select() { return query; }, eq() { return query; },
        maybeSingle: async () => ({ data: state.rows[table] ?? null, error: null }),
        single: async () => ({ data: state.rows[table] ?? null, error: null }),
        update(value: Record<string, any>) {
          state.updates.push(value);
          if (table === 'message_deliveries') state.status = value.status ?? state.status;
          return query;
        },
        then(resolve: any) { return Promise.resolve({ data: [], error: null }).then(resolve); },
      };
      return query;
    },
  },
  rpc: async (name: string) => {
    if(name==='comm_whatsapp_marketing_allowed')return state.marketingAllowed;
    if (name === 'comm_claim_delivery') {
      if (state.status !== 'PENDING') return [];
      state.status = 'SENDING';
      return [state.delivery];
    }
    if (name === 'comm_accept_delivery') state.status = 'ACCEPTED';
    return true;
  },
  assertDb(result: any) { if (result.error) throw new Error(result.error.message); },
}));
import { sendDelivery } from '../../lib/communications/delivery';
import { sendProvider } from '../../lib/communications/providers/send';

const staging = {
  VERCEL_ENV: 'preview',
  VERCEL_GIT_COMMIT_REF: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://jwsivyxapfnyaafdcdos.supabase.co',
  COMMUNICATION_BASE_URL: 'https://staging.uppermost.store',
};
function fixture({ template = false, channel = 'EMAIL', allowed = true, runDry = true } = {}) {
  state.marketingAllowed=true;
  state.status = 'PENDING';
  state.updates = [];
  state.delivery = { customer_message_id: 'message', template_version_id: 'version', run_recipient_id: 'recipient', channel, retry_count: 0 };
  state.rows = {
    customer_messages: { customer_id: 'customer', order_id: null, title: 'Welcome', body: 'Welcome', metadata: template ? { communication_test: true, test_destination: 'dummy@example.test' } : {} },
    customers: { id: 'customer', name: 'Dummy Person', email: 'dummy@example.test', phone: '+919000000000' },
    communication_template_versions: { id: 'version', channel, category: 'MARKETING', subject: 'Welcome', html_content: '<p>{{name}}</p>', parameter_schema: { required: ['name'] } },
    communication_template_provider_artifacts: channel === 'WHATSAPP' ? { provider_status: 'APPROVED', provider_template_name: 'test', provider_language: 'en_US' } : { sync_mode: 'PROVIDER_TEMPLATE', provider_template_id: '18' },
    communication_run_recipients: { run_id: 'run' },
    communication_runs: { dry_run: runDry, rule_snapshot: { quiet_hours: { start: 0, end: 0 } }, event_context: {} },
    communication_preferences: { allowed: true },
    communication_customer_features: {},
  };
  vi.stubEnv('COMMUNICATION_ALLOWED_TEST_EMAILS', allowed ? 'dummy@example.test' : '');
  vi.stubEnv('COMMUNICATION_ALLOWED_TEST_PHONES', '919000000000');
}
let http: ReturnType<typeof vi.fn>;
function liveFixture(channel='EMAIL'){
  for(const [key,value] of Object.entries({VERCEL_ENV:'production',VERCEL_GIT_COMMIT_REF:'main',NEXT_PUBLIC_SUPABASE_URL:'https://production.example.test',COMMUNICATION_BASE_URL:'https://production.example.test',COMMUNICATION_DRY_RUN:'false'}))vi.stubEnv(key,value);
  fixture({channel,runDry:false});
}
beforeEach(() => {
  for (const [key, value] of Object.entries(staging)) vi.stubEnv(key, value);
  vi.stubEnv('COMMUNICATION_DRY_RUN', 'true');
  vi.stubEnv('BREVO_API_KEY', 'FAKE_TEST_ONLY');
  vi.stubEnv('COMMUNICATION_EMAIL_FROM', 'fake@example.test');
  vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'FAKE_TEST_ONLY');
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'FAKE_TEST_ONLY');
  http = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => Response.json({ messageId: 'FAKE_EMAIL', messages: [{ id: 'FAKE_WHATSAPP' }] }));
  vi.stubGlobal('fetch', http);
  fixture();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('strict staging email dry-run at real delivery/provider boundaries', () => {
  it('suppresses WhatsApp marketing after STOP even for an allowlisted recipient',async()=>{
    liveFixture('WHATSAPP');state.marketingAllowed=false;
    await sendDelivery('delivery');expect(state.status).toBe('SUPPRESSED');expect(http).not.toHaveBeenCalled();
  });
  it.each([[401,'FAILED_PERMANENT'],[429,'FAILED_RETRYABLE']])('persists WhatsApp rejection %s without claiming acceptance',async(status,expected)=>{
    liveFixture('WHATSAPP');http.mockResolvedValue(new Response('',{status:Number(status)}));
    await sendDelivery('delivery');expect(state.status).toBe(expected);expect(http).toHaveBeenCalledTimes(1);
  });
  it('quarantines an ambiguous WhatsApp send and never repeats it on queue redelivery',async()=>{
    liveFixture('WHATSAPP');http.mockRejectedValue(new Error('timeout'));
    await sendDelivery('delivery');await sendDelivery('delivery');expect(state.status).toBe('RECONCILIATION_PENDING');expect(http).toHaveBeenCalledTimes(1);
  });
  it('blocks an audited dedicated test even when its window and allowlist are armed',async()=>{
    fixture({template:true});const version='26000000-0000-4000-8000-000000000001',expires=new Date(Date.now()+15*60000).toISOString();
    for(const [key,value] of Object.entries({COMMUNICATION_STAGING_TEST_ENABLED:'true',COMMUNICATION_STAGING_TEST_EMAIL:'dummy@example.test',COMMUNICATION_STAGING_TEST_VERSION_ID:version,COMMUNICATION_STAGING_TEST_EXPIRES_AT:expires}))vi.stubEnv(key,value);
    state.delivery.template_version_id=version;state.rows.customer_messages.customer_id=null;
    Object.assign(state.rows.customer_messages.metadata,{test_actor_id:'27000000-0000-4000-8000-000000000001',test_request_key:'28000000-0000-4000-8000-000000000001',staging_test_window:expires});
    Object.assign(state.rows.communication_template_versions,{id:version,template_id:'dedicated',status:'ACTIVE'});state.rows.communication_templates={logical_key:'EMAIL_QSTASH_INTEGRATION_TEST'};state.rows.communication_template_provider_artifacts={sync_mode:'DIRECT_CONTENT'};
    await sendDelivery('delivery');await sendDelivery('delivery');expect(http).not.toHaveBeenCalled();expect(state.status).toBe('DRY_RUN');
  });
  it.each([false,true])('keeps ordinary and legacy test mail blocked even with the test switch on, template=%s',async template=>{
    fixture({template});vi.stubEnv('COMMUNICATION_STAGING_TEST_ENABLED','true');await sendDelivery('delivery');expect(http).not.toHaveBeenCalled();expect(state.status).toBe('DRY_RUN');
  });
  it.each([false, true])('suppresses normal email, allowlisted=%s, and persists DRY_RUN', async allowed => {
    fixture({ allowed });
    await sendDelivery('delivery');
    expect(http).not.toHaveBeenCalled();
    expect(state.status).toBe('DRY_RUN');
  });
  it.each([false, true])('suppresses template-test email, allowlisted=%s', async allowed => {
    fixture({ template: true, allowed });
    await sendDelivery('delivery');
    expect(http).not.toHaveBeenCalled();
    expect(state.status).toBe('DRY_RUN');
  });
  it.each(['false', '', 'TRUE', undefined])('fails closed with staging dry flag %s', async value => {
    vi.stubEnv('COMMUNICATION_DRY_RUN', value);
    fixture({ runDry: false });
    await sendDelivery('delivery');
    expect(http).not.toHaveBeenCalled();
    expect(state.status).toBe('DRY_RUN');
    expect(state.updates.at(-1)?.suppression_reason).toBe(value==='TRUE'?'COMMUNICATION_DRY_RUN':'STAGING_EMAIL_CONFIGURATION_INVALID');
  });
  it.each([
    ['NEXT_PUBLIC_SUPABASE_URL', 'https://wrong-project.example.test'],
    ['COMMUNICATION_BASE_URL', 'https://wrong-consumer.example.test'],
    ['VERCEL_ENV', undefined],
    ['VERCEL_GIT_COMMIT_REF', undefined],
  ])('fails closed when staging setting %s is wrong/missing', async (key, value) => {
    vi.stubEnv(key, value);
    await sendDelivery('delivery');
    expect(http).not.toHaveBeenCalled();
    expect(state.status).toBe('DRY_RUN');
  });
  it('does not turn a repeated suppressed delivery into a send', async () => {
    await sendDelivery('delivery');
    await sendDelivery('delivery');
    expect(state.status).toBe('DRY_RUN');
    expect(http).not.toHaveBeenCalled();
  });
  it('blocks a direct EMAIL provider call before credentials/content are used', async () => {
    vi.stubEnv('BREVO_API_KEY', undefined);
    await expect(sendProvider({ channel: 'EMAIL', category: 'MARKETING' }, null, 'dummy@example.test', {})).rejects.toThrow('COMMUNICATION_DRY_RUN');
    expect(http).not.toHaveBeenCalled();
  });
  it('blocks a direct Lemlist enrollment provider call', async () => {
    await expect(sendProvider({ channel: 'LEMLIST', category: 'MARKETING' }, null, 'dummy@example.test', {})).rejects.toThrow('COMMUNICATION_DRY_RUN');
    expect(http).not.toHaveBeenCalled();
  });
  it('preserves production live-mode delivery with mocked HTTP', async () => {
    liveFixture();
    await sendDelivery('delivery');
    expect(state.status).toBe('ACCEPTED');
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.parse(http.mock.calls[0][1]?.body as string).templateId).toBe(18);
  });
  it.each([false,true])('preserves legacy Production unset-flag allowlist semantics, runDry=%s',async runDry=>{
    liveFixture();vi.stubEnv('COMMUNICATION_DRY_RUN',undefined);state.rows.communication_runs.dry_run=runDry;
    await sendDelivery('delivery');expect(state.status).toBe('ACCEPTED');expect(http).toHaveBeenCalledTimes(1);
  });
  it('blocks allowlisted WhatsApp while staging dry-run is enabled', async () => {
    fixture({ channel: 'WHATSAPP' });
    await sendDelivery('delivery');
    expect(state.status).toBe('DRY_RUN');
    expect(http).not.toHaveBeenCalled();
  });
});
