import { afterEach, describe, it, expect, vi } from 'vitest';
import { createSentryReader } from '../../lib/observability/sentry';
afterEach(() => vi.unstubAllEnvs());
describe('private Sentry aggregate adapter', () => {
    it('requests only production error counts and exposes no raw diagnostics', async () => { vi.stubEnv('SENTRY_READ_TOKEN', 'private-token'); const seen: string[] = []; const read = createSentryReader(async (url: any) => { seen.push(String(url)); return Response.json({ data: [{ 'count()': 3 }], secret: 'private' }); }); const d = await read(24); expect(d).toMatchObject({ state: 'connected', frontend_errors: 3, backend_errors: 3 }); expect(JSON.stringify(d)).not.toContain('private'); expect(seen).toHaveLength(2); expect(new URL(seen[0]).searchParams.get('query')).toBe('event.type:error environment:production'); await read(24); expect(seen).toHaveLength(2); });
    it('reports unknown rather than zero on denied or malformed provider responses', async () => { vi.stubEnv('SENTRY_READ_TOKEN', 'private-token'); const read = createSentryReader(async () => Response.json({ detail: 'private' }, { status: 403 })); expect(await read(1)).toMatchObject({ state: 'unavailable', frontend_errors: null, backend_errors: null }); });
    it('does not call a provider without a configured credential', async () => { vi.stubEnv('SENTRY_READ_TOKEN', ''); const fetcher = vi.fn(); const read = createSentryReader(fetcher); expect(await read(24)).toMatchObject({ state: 'not_connected', frontend_errors: null }); expect(fetcher).not.toHaveBeenCalled(); });
});
