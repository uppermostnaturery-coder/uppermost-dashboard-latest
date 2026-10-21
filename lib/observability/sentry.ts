export type SentrySummary = {
    state: 'connected' | 'not_connected' | 'unavailable';
    frontend_errors: number | null;
    backend_errors: number | null;
    checked_at: string | null;
};
export function createSentryReader(fetcher: typeof fetch = fetch) {
    const cache = new Map<number, {
        until: number;
        value: SentrySummary;
    }>(), pending = new Map<number, Promise<SentrySummary>>();
    return async function read(hours: number): Promise<SentrySummary> {
        if (![1, 24, 168, 720].includes(hours))
            throw Error('Invalid Sentry range');
        if (!process.env.SENTRY_READ_TOKEN)
            return { state: 'not_connected', frontend_errors: null, backend_errors: null, checked_at: null };
        const saved = cache.get(hours);
        if (saved && saved.until > Date.now())
            return saved.value;
        if (pending.has(hours))
            return pending.get(hours)!;
        const task = (async () => {
            try {
                const org = process.env.SENTRY_ORG || 'uppermost-naturery-pvt-ltd';
                if (!/^[a-z0-9-]{1,100}$/.test(org))
                    throw Error('Invalid organization');
                const readCount = async (project: string) => {
                    const params = new URLSearchParams({ project, field: 'count()', query: 'event.type:error environment:production', statsPeriod: `${hours}h` });
                    const response = await fetcher(`https://de.sentry.io/api/0/organizations/${org}/events/?${params}`, { headers: { Authorization: `Bearer ${process.env.SENTRY_READ_TOKEN}` }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
                    if (!response.ok)
                        throw Error('Sentry unavailable');
                    const body = await response.json(), count = body?.data?.[0]?.['count()'];
                    if (!Number.isInteger(count) || count < 0)
                        throw Error('Invalid Sentry aggregate');
                    return count;
                };
                const [frontend_errors, backend_errors] = await Promise.all([readCount('4512291428434000'), readCount('4512291436298320')]);
                return { state: 'connected' as const, frontend_errors, backend_errors, checked_at: new Date().toISOString() };
            }
            catch {
                return { state: 'unavailable' as const, frontend_errors: null, backend_errors: null, checked_at: null };
            }
        })();
        pending.set(hours, task);
        try {
            const value = await task;
            cache.set(hours, { value, until: Date.now() + 60000 });
            return value;
        }
        finally {
            pending.delete(hours);
        }
    };
}
export const readSentrySummary = createSentryReader();
