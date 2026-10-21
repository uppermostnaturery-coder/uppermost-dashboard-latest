import type { Observation } from './contracts';
// Lazy server-only import keeps disabled telemetry independent of DB configuration.
export async function persistObservation(row: Observation) {
    const { supabaseAdmin } = await import('../supabaseAdmin');
    const { error } = await supabaseAdmin.from('observability_events').upsert(row, { onConflict: 'event_id', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(2000));
    if (error)
        throw new Error('Telemetry write unavailable');
}
export async function readMetrics(filters: {
    hours: number;
    route: string | null;
    method: string | null;
    status: string | null;
    release: string | null;
}) {
    const { supabaseAdmin } = await import('../supabaseAdmin');
    const { data, error } = await supabaseAdmin.rpc('observability_health', { p_hours: filters.hours, p_route: filters.route, p_method: filters.method, p_status: filters.status, p_release: filters.release }).abortSignal(AbortSignal.timeout(8000));
    if (error)
        throw new Error('Telemetry read unavailable');
    return data;
}
