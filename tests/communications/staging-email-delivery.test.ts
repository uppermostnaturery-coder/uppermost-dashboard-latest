import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  delivery: {} as Record<string, any>,
  rows: {} as Record<string, any>,
  status: 'PENDING',
  updates: [] as Record<string, any>[],
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
    expect(state.updates.at(-1)?.suppression_reason).toBe('STAGING_EMAIL_CONFIGURATION_INVALID');
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
    await expect(sendProvider({ channel: 'EMAIL', category: 'MARKETING' }, null, 'dummy@example.test', {})).rejects.toThrow('STAGING_EMAIL_DRY_RUN');
    expect(http).not.toHaveBeenCalled();
  });
  it('blocks a direct Lemlist enrollment provider call', async () => {
    await expect(sendProvider({ channel: 'LEMLIST', category: 'MARKETING' }, null, 'dummy@example.test', {})).rejects.toThrow('STAGING_EMAIL_DRY_RUN');
    expect(http).not.toHaveBeenCalled();
  });
  it('preserves existing production allowlisted behavior with mocked HTTP', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'main');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://production.example.test');
    vi.stubEnv('COMMUNICATION_BASE_URL', 'https://production.example.test');
    await sendDelivery('delivery');
    expect(state.status).toBe('ACCEPTED');
    expect(http).toHaveBeenCalledTimes(1);
    expect(JSON.parse(http.mock.calls[0][1]?.body as string).templateId).toBe(18);
  });
  it('preserves allowlisted WhatsApp behavior with mocked HTTP', async () => {
    fixture({ channel: 'WHATSAPP' });
    await sendDelivery('delivery');
    expect(state.status).toBe('ACCEPTED');
    expect(http).toHaveBeenCalledTimes(1);
    expect(String(http.mock.calls[0][0])).toContain('graph.facebook.com');
  });
});
