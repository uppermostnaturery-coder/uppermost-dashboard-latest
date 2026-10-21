import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { classifyStatus, normalizeRoute, type Outcome, type Observation } from './contracts';
import * as Sentry from '@sentry/nextjs';
import { persistObservation } from './store';
const scope = new AsyncLocalStorage<{
    outcome?: Outcome;
    route: string;
    request_id: string;
    reported?: boolean;
}>();
let lastWriteFailureReport = 0;
export function captureObservedError(error: unknown) { const current = scope.getStore(); try {
    Sentry.captureException(error, { tags: { route: current?.route, request_id: current?.request_id } });
    if (current)
        current.reported = true;
}
catch { } }
export function markOutcome(outcome: Outcome) { const current = scope.getStore(); if (current)
    current.outcome = outcome; }
export function observationEnabled() { return process.env.OBSERVABILITY_ENABLED === 'true' && process.env.VERCEL_ENV === 'production'; }
export function withObservation(route: string, handler: (request: Request, ...rest: any[]) => Promise<Response>): (request: Request, ...rest: any[]) => Promise<Response> {
    return (async (...args: [
        Request,
        ...any[]
    ]) => {
        if (!observationEnabled() || route.startsWith('/api/observability/') || scope.getStore())
            return handler(...args);
        return scope.run({ route: normalizeRoute(route), request_id: randomUUID() }, async () => {
            const start = performance.now();
            let status = 500;
            try {
                const response = await handler(...args);
                status = response.status;
                return response;
            }
            catch (error) {
                markOutcome('exception');
                captureObservedError(error);
                throw error;
            }
            finally {
                const row: Observation = { event_id: randomUUID(), at: new Date().toISOString(), source: 'app', route: normalizeRoute(route), method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(args[0]?.method) ? args[0].method : 'OTHER', status, duration_ms: Math.min(86400000, Math.max(0, performance.now() - start)), outcome: scope.getStore()?.outcome || classifyStatus(status), release: /^[a-f0-9]{7,40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA || '') ? process.env.VERCEL_GIT_COMMIT_SHA! : null, request_id: scope.getStore()!.request_id };
                try {
                    if (status >= 500) {
                        Sentry.logger.warn('api_failure', { route: row.route, status: row.status, duration_ms: row.duration_ms, request_id: row.request_id });
                        if (!scope.getStore()?.reported)
                            Sentry.captureEvent({ level: 'error', message: 'Uppermost API server failure', tags: { route: row.route, request_id: row.request_id } });
                    }
                }
                catch { }
                // No response/body mutation. waitUntil extends the Vercel lifecycle; failures are safe categories only.
                try {
                    waitUntil(Promise.all([persistObservation(row).catch(async () => {
                        console.warn(JSON.stringify({ event: 'observability_write_failed', route: row.route }));
                        if (Date.now()-lastWriteFailureReport>60000) {
                            lastWriteFailureReport=Date.now();
                            try { Sentry.logger.warn('observability_write_failed', {route:row.route}); Sentry.captureEvent({level:'warning',message:'Uppermost telemetry storage unavailable',tags:{route:row.route,outcome:'dependency_failure'}}); await Sentry.flush(1000); } catch {}
                        }
                    }), Sentry.flush(1500).catch(() => false)]));
                }
                catch {
                    console.warn('{"event":"observability_lifecycle_unavailable"}');
                }
            }
        });
    });
}
