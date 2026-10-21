import { NextResponse } from 'next/server';
import { parseFilters, projectMetrics } from '@/lib/observability/contracts';
import { readSentrySummary } from '@/lib/observability/sentry';
import { readMetrics } from '@/lib/observability/store';
import { observationEnabled } from '@/lib/observability/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const clients = new Map<string, {
    count: number;
    until: number;
}>();
function admitted(request: Request) {
    const now = Date.now(), key = (request.headers.get('x-forwarded-for')?.split(',')[0] || 'unknown').slice(0, 100);
    let bucket = clients.get(key);
    if (!bucket || bucket.until < now) {
        if (clients.size >= 1000) {
            for (const [k, v] of clients)
                if (v.until < now)
                    clients.delete(k);
            if (clients.size >= 1000)
                return false;
        }
        bucket = { count: 0, until: now + 60000 };
        clients.set(key, bucket);
    }
    return ++bucket.count <= 30;
}
const headers = { 'Cache-Control': 'public, max-age=0, s-maxage=30', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
    if (!admitted(request))
        return NextResponse.json({ state: 'rate_limited', metrics: null, error: 'Too many health requests. Retry in a minute.' }, { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } });
    let filters;
    try {
        filters = parseFilters(new URL(request.url).searchParams);
    }
    catch {
        return NextResponse.json({ error: 'Invalid health filters' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const enabled = observationEnabled();
    // Sources fail independently and run concurrently within the browser's 12s budget.
    const [app, sentry] = await Promise.allSettled([enabled ? readMetrics(filters) : Promise.resolve(null), readSentrySummary(filters.hours)]);
    const sources = { app: { state: enabled ? 'enabled' : 'disabled' }, vercel: { state: process.env.VERCEL_DRAIN_SECRET ? 'configured_unverified' : 'not_connected' }, sentry: sentry.status === 'fulfilled' ? sentry.value : { state: 'unavailable', frontend_errors: null, backend_errors: null, checked_at: null } };
    if (!enabled)
        return NextResponse.json({ state: 'disabled', metrics: null, sources, generated_at: new Date().toISOString() }, { headers });
    if (app.status === 'rejected')
        return NextResponse.json({ state: 'unavailable', metrics: null, sources, error: 'Production telemetry is unavailable. No healthy or zero-error result can be inferred.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
    const metrics = projectMetrics(app.value);
    const age = metrics.last_observed ? Date.now() - Date.parse(metrics.last_observed) : null;
    return NextResponse.json({ state: age === null ? 'no_observations' : age > 600000 ? 'no_recent_observations' : 'receiving', metrics, sources, generated_at: new Date().toISOString(), window_hours: filters.hours, coverage_note: 'Observed handler completions only. Missing observations do not prove zero traffic or uptime. Platform log entries are separate. Latency excludes network and platform startup.' }, { headers });
}
