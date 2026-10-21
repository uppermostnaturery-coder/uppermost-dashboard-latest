// Rebuild diagnostics from safe fields; never serialize arbitrary application data.
import { normalizeRoute, OUTCOMES } from './contracts';
export const SENTRY_DATA_COLLECTION = { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, graphQL: { document: false, variables: false }, genAI: { inputs: false, outputs: false }, databaseQueryData: false, queues: false, stackFrameVariables: false, frameContextLines: 0 };
const EVENTS = new Set(['api_failure', 'api_slow', 'checkout_navigation_failed', 'sdk_ready', 'observability_write_failed']);
const cleanFile = (value: unknown) => { try {
    const u = new URL(String(value));
    if (u.protocol !== 'https:')
        return undefined;
    if ((u.hostname === 'framerusercontent.com' && u.pathname.startsWith('/sites/') || u.hostname === 'uppermost-dashboard-latest-orcin.vercel.app' && u.pathname.startsWith('/_next/static/')) && /\.(m?js)$/.test(u.pathname))
        return 'app://first-party-javascript';
}
catch { } return undefined; };
export function sanitizeSentryEvent(event: any): any {
    return { event_id: typeof event.event_id === 'string' && /^[a-f0-9]{32}$/.test(event.event_id) ? event.event_id : undefined, platform: 'javascript', level: ['error', 'warning', 'fatal', 'info'].includes(event.level) ? event.level : 'error', environment: 'production', release: typeof event.release === 'string' && /^[a-f0-9]{7,40}$/.test(event.release) ? event.release : undefined, message: 'Uppermost application diagnostic', tags: { request_id: typeof event.tags?.request_id === 'string' && /^[a-f0-9-]{36}$/.test(event.tags.request_id) ? event.tags.request_id : undefined, route: typeof event.tags?.route === 'string' ? normalizeRoute(event.tags.route) : undefined, outcome: OUTCOMES.includes(event.tags?.outcome) ? event.tags.outcome : undefined }, exception: event.exception ? { values: (event.exception.values || []).slice(0, 5).map((v: any) => ({ type: ['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'UnhandledRejection'].includes(v.type) ? v.type : 'Error', value: 'Application error (details redacted)', stacktrace: v.stacktrace ? { frames: (v.stacktrace.frames || []).slice(-30).map((f: any) => ({ filename: cleanFile(f.filename), lineno: Number.isInteger(f.lineno) ? f.lineno : undefined, colno: Number.isInteger(f.colno) ? f.colno : undefined, in_app: typeof f.in_app === 'boolean' ? f.in_app : undefined })) } : undefined })) } : undefined };
}
export function sanitizeLog(log: any): any | null {
    if (!EVENTS.has(log.message))
        return null;
    const a = log.attributes || {}, attributes: Record<string, unknown> = {};
    if (typeof a.route === 'string')
        attributes.route = normalizeRoute(a.route);
    if (Number.isInteger(a.status) && a.status >= 100 && a.status <= 599)
        attributes.status = a.status;
    if (typeof a.duration_ms === 'number' && Number.isFinite(a.duration_ms) && a.duration_ms >= 0)
        attributes.duration_ms = Math.min(a.duration_ms, 86400000);
    if (typeof a.request_id === 'string' && /^[a-f0-9-]{36}$/.test(a.request_id))
        attributes.request_id = a.request_id;
    return { message: log.message, attributes };
}
