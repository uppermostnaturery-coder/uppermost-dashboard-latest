// Static labels only: no paths, IDs or query values from callers become dimensions.
export const ROUTES: Record<string, readonly string[]> = {
    "/api/analytics/dashboard": [
        "GET"
    ],
    "/api/analytics/identity": [
        "OPTIONS",
        "POST"
    ],
    "/api/analytics/journeys": [
        "GET"
    ],
    "/api/brevo/status": [
        "GET"
    ],
    "/api/brevo/webhook": [
        "POST",
        "GET"
    ],
    "/api/checkout/prepare": [
        "OPTIONS",
        "POST"
    ],
    "/api/checkout/status": [
        "OPTIONS",
        "GET"
    ],
    "/api/commerce/catalog": [
        "OPTIONS",
        "GET"
    ],
    "/api/commerce/quote": [
        "OPTIONS",
        "POST"
    ],
    "/api/customer/addresses": [
        "OPTIONS",
        "GET",
        "POST"
    ],
    "/api/experience": [
        "OPTIONS",
        "GET"
    ],
    "/api/internal/cron/renewals": [
        "GET"
    ],
    "/api/internal/renewals/run": [
        "POST"
    ],
    "/api/launch-signup": [
        "OPTIONS",
        "POST"
    ],
    "/api/lead": [
        "OPTIONS",
        "POST"
    ],
    "/api/lemlist/analytics": [
        "GET"
    ],
    "/api/meta/ads": [
        "GET"
    ],
    "/api/payments/verify": [
        "OPTIONS",
        "POST"
    ],
    "/api/shipping/serviceability": [
        "OPTIONS",
        "POST"
    ],
    "/api/webhooks/carrier-events": [
        "POST"
    ],
    "/api/webhooks/razorpay": [
        "POST"
    ],
    "/api/webhooks/shiprocket": [
        "POST"
    ],
    "/api/whatsapp/send": [
        "GET",
        "POST"
    ]
};
export const OUTCOMES = ['success', 'redirect', 'rejected', 'validation', 'rate_limit', 'server_error', 'exception', 'business_failure', 'dependency_failure'] as const;
export type Outcome = typeof OUTCOMES[number];
export type Observation = {
    event_id: string;
    at: string;
    source: 'app' | 'platform';
    route: string;
    method: string;
    status: number | null;
    duration_ms: number | null;
    outcome: Outcome;
    release: string | null;
    request_id: string | null;
};
export function normalizeRoute(path: string): string { const clean = path.split(/[?#]/)[0]; return Object.hasOwn(ROUTES, clean) ? clean : '/api/unknown'; }
export function classifyStatus(status: number): Outcome { return status >= 500 ? 'server_error' : status === 429 ? 'rate_limit' : status >= 400 ? 'rejected' : status >= 300 ? 'redirect' : 'success'; }
export function parseFilters(params: URLSearchParams) {
    if (new Set(params.keys()).size !== [...params.keys()].length)
        throw new Error('Duplicate health filter');
    if ([...params.keys()].some(k => !['hours', 'route', 'method', 'status', 'release'].includes(k)))
        throw new Error('Unknown health filter');
    const hours = Number(params.get('hours') || 24), route = params.get('route') || null, method = params.get('method') || null, status = params.get('status') || null, release = params.get('release') || null;
    if (![1, 24, 168, 720].includes(hours) || route && (normalizeRoute(route) !== route) || method && !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(method) || status && !['2xx', '3xx', '4xx', '5xx'].includes(status) || release && !/^[a-f0-9]{7,40}$/.test(release))
        throw new Error('Invalid health filters');
    return { hours, route, method, status, release };
}
const numeric = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
const nullable = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const iso = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
function metrics(v: any) { return { total: numeric(v?.total), s2xx: numeric(v?.s2xx), s3xx: numeric(v?.s3xx), s4xx: numeric(v?.s4xx), s5xx: numeric(v?.s5xx), validation: numeric(v?.validation), business_failures: numeric(v?.business_failures), slow: numeric(v?.slow), p50: nullable(v?.p50), p95: nullable(v?.p95), p99: nullable(v?.p99), last_failure: iso(v?.last_failure) }; }
type MetricGroup = ReturnType<typeof metrics>;
export type HealthMetrics = MetricGroup & {
    first_observed: string | null;
    last_observed: string | null;
    last_platform: string | null;
    platform_failures: number;
    platform_crashes:number; platform_unknown_routes:number; platform_unsupported_methods:number;
    releases: string[];
    routes: Array<MetricGroup & {
        route: string;
        method: string;
    }>;
    series: Array<MetricGroup & {
        at: string | null;
    }>;
};
export function projectMetrics(raw: any): HealthMetrics { return { ...metrics(raw), first_observed: iso(raw?.first_observed), last_observed: iso(raw?.last_observed), last_platform: iso(raw?.last_platform), platform_failures: numeric(raw?.platform_failures), platform_crashes:numeric(raw?.platform_crashes),platform_unknown_routes:numeric(raw?.platform_unknown_routes),platform_unsupported_methods:numeric(raw?.platform_unsupported_methods), releases: Array.isArray(raw?.releases) ? raw.releases.filter((x: unknown) => typeof x === 'string' && /^[a-f0-9]{7,40}$/.test(x)).slice(0, 100) : [], routes: Array.isArray(raw?.routes) ? raw.routes.slice(0, 200).map((v: any) => ({ ...metrics(v), route: normalizeRoute(String(v.route || '')), method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(v.method) ? v.method : 'OTHER' })) : [], series: Array.isArray(raw?.series) ? raw.series.slice(0, 800).map((v: any) => ({ ...metrics(v), at: iso(v.at) })).filter((v: any) => v.at) : [] }; }
