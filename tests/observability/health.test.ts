import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
const mock = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../lib/observability/store', () => ({ readMetrics: mock.read }));
import { GET } from '../../app/api/observability/health/route';
beforeEach(() => { vi.stubEnv('OBSERVABILITY_ENABLED', 'true'); vi.stubEnv('VERCEL_ENV', 'production'); mock.read.mockResolvedValue({ total: 4, p95: 30, secret: 'private', routes: [], series: [] }); });
afterEach(() => vi.unstubAllEnvs());
describe('public production health', () => {
    it('projects aggregates only and never raw diagnostics', async () => { const r = await GET(new Request('https://test/api/observability/health')); expect(r.status).toBe(200); const d = await r.json(); expect(d.metrics.total).toBe(4); expect(JSON.stringify(d)).not.toContain('private'); expect(d.sources.sentry.state).not.toBe('healthy'); });
    it('returns disabled coverage without invented zeroes', async () => { vi.stubEnv('OBSERVABILITY_ENABLED', 'false'); const d = await (await GET(new Request('https://test/api/observability/health'))).json(); expect(d.metrics).toBeNull(); expect(d.state).toBe('disabled'); });
    it('bounds filters before querying and reports storage outages', async () => { expect((await GET(new Request('https://test/api/observability/health?hours=9999'))).status).toBe(400); mock.read.mockRejectedValue(Error('private error')); const r = await GET(new Request('https://test/api/observability/health')); expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain('private error'); });
});
