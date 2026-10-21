import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { normalizeRoute, classifyStatus, type Observation } from './contracts';
export function validDrainSignature(raw: Buffer, signature: string | null, secret: string) { if (!secret || !signature || !/^([a-f0-9]{40})$/i.test(signature))
    return false; return timingSafeEqual(createHmac('sha1', secret).update(raw).digest(), Buffer.from(signature, 'hex')); }
export function parseDrain(input: unknown, project: string): Observation[] {
    if (!Array.isArray(input) || input.length > 500)
        throw Error('Invalid drain batch');
    const result: Observation[] = [], seen = new Set<string>();
    for (const row of input) {
        if (!row || row.environment !== 'production' || row.projectId !== project || typeof row.id !== 'string' || row.id.length > 200 || !row.id)
            continue;
        if (typeof row.timestamp !== 'number' || !Number.isFinite(row.timestamp) || row.timestamp > Date.now() + 300000 || row.timestamp < Date.now() - 30 * 86400000)
            continue;
        const rawPath = String(row.path || row.proxy?.path || '').split(/[?#]/)[0];
        if (!rawPath.startsWith('/api/') || rawPath.startsWith('/api/observability/'))
            continue;
        const crashed = row.statusCode === -1;
        const rawStatus = row.statusCode ?? row.proxy?.statusCode;
        const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : null;
        if (status === null && !crashed && row.level !== 'error')
            continue;
        const route = normalizeRoute(rawPath);
        const event_id = 'vercel_' + createHash('sha256').update(project + ':' + row.id).digest('hex');
        if (seen.has(event_id))
            continue;
        seen.add(event_id);
        const method = String(row.proxy?.method || 'OTHER');
        result.push({ event_id, at: new Date(row.timestamp).toISOString(), source: 'platform', route, method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(method) ? method : 'OTHER', status, duration_ms: null, outcome: status === null ? 'exception' : classifyStatus(status), release: null, request_id: null });
    }
    return result;
}
export async function readBoundedBody(request: Request, max = 262144) {
    const reader = request.body?.getReader();
    if (!reader)
        return Buffer.alloc(0);
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > max) {
                await reader.cancel();
                throw Error('Payload too large');
            }
            chunks.push(value);
        }
    }
    finally {
        reader.releaseLock();
    }
    return Buffer.concat(chunks);
}
