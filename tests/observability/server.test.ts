import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ rows: [] as any[], pending: [] as Promise<unknown>[], fail: false }));
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => state.pending.push(p) }));
vi.mock('../../lib/observability/store', () => ({ persistObservation: async (row: any) => { if (state.fail)
        throw Error('private db failure'); state.rows.push(row); } }));
import { withObservation, markOutcome } from '../../lib/observability/server';
beforeEach(() => { vi.stubEnv('OBSERVABILITY_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production'); state.rows = []; state.pending = []; state.fail = false; });
afterEach(() => vi.unstubAllEnvs());
const req = () => new Request('https://test/api/experience?token=private');
const flush = () => Promise.all(state.pending);
describe('request observation isolates commerce from telemetry', () => {
    it('preserves the exact response and does not consume the request body', async () => { const body = new Request('https://test/api/checkout/prepare', { method: 'POST', body: 'private' }); const response = new Response('original', { status: 201 }); const out = await withObservation('/api/checkout/prepare', async (r) => { expect(await r.text()).toBe('private'); return response; })(body); expect(out).toBe(response); expect(await out.text()).toBe('original'); await flush(); expect(state.rows).toHaveLength(1); expect(JSON.stringify(state.rows)).not.toContain('private'); });
    it('retains thrown failures for framework handling and records a 500', async () => { const error = Error('private'); await expect(withObservation('/api/experience', async () => { throw error; })(req())).rejects.toBe(error); await flush(); expect(state.rows[0]).toMatchObject({ status: 500, outcome: 'exception' }); });
    it('does not double count an alias calling another observed route', async () => { const inner = withObservation('/api/webhooks/shiprocket', async () => new Response(null, { status: 204 })); await withObservation('/api/webhooks/carrier-events', inner)(req()); await flush(); expect(state.rows).toHaveLength(1); expect(state.rows[0].route).toBe('/api/webhooks/carrier-events'); });
    it('isolates concurrent request annotations', async () => { await Promise.all([withObservation('/api/experience', async () => { markOutcome('validation'); await Promise.resolve(); return new Response(null, { status: 400 }); })(req()), withObservation('/api/experience', async () => new Response(null, { status: 200 }))(req())]); await flush(); expect(state.rows.map(r => r.outcome).sort()).toEqual(['success', 'validation']); });
    it('does not replace a successful response if persistence fails', async () => { state.fail = true; const out = await withObservation('/api/experience', async () => new Response('ok'))(req()); await flush(); expect(out.status).toBe(200); });
    it('requires explicit production activation and excludes self-monitoring', async () => { vi.stubEnv('VERCEL_ENV', 'preview'); await withObservation('/api/experience', async () => new Response('ok'))(req()); vi.stubEnv('VERCEL_ENV', 'production'); await withObservation('/api/observability/health', async () => new Response('ok'))(req()); await flush(); expect(state.rows).toHaveLength(0); });
});
