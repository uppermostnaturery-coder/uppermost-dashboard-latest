import { timingSafeEqual } from 'node:crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
    if (process.env.VERCEL_ENV !== 'production')
        return Response.json({ error: 'Production only' }, { status: 503 });
    const expected = process.env.CRON_SECRET || process.env.OBSERVABILITY_CRON_SECRET, actual = request.headers.get('authorization');
    const value = `Bearer ${expected}`;
    if (!expected || !actual || Buffer.byteLength(value) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(value), Buffer.from(actual)))
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    try {
        const { supabaseAdmin } = await import('@/lib/supabaseAdmin');
        const { error } = await supabaseAdmin.from('observability_events').delete().lt('at', new Date(Date.now() - 30 * 86400000).toISOString()).abortSignal(AbortSignal.timeout(8000));
        if (error)
            throw error;
        return Response.json({ ok: true });
    }
    catch {
        return Response.json({ error: 'Retention unavailable' }, { status: 503 });
    }
}
