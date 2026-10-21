import { NextResponse } from 'next/server';
import { validDrainSignature, parseDrain, readBoundedBody } from '@/lib/observability/drain';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() { const token = process.env.VERCEL_DRAIN_VERIFY; return new Response(null, { status: token ? 200 : 503, headers: token ? { 'x-vercel-verify': token, 'Cache-Control': 'no-store' } : { 'Cache-Control': 'no-store' } }); }
export async function POST(request: Request) {
    if (process.env.VERCEL_ENV !== 'production' || !process.env.VERCEL_DRAIN_SECRET)
        return NextResponse.json({ error: 'Drain not enabled' }, { status: 503 });
    let raw: Buffer;
    try {
        raw = await readBoundedBody(request);
    }
    catch {
        return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
    }
    if (!validDrainSignature(raw, request.headers.get('x-vercel-signature'), process.env.VERCEL_DRAIN_SECRET))
        return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
    let rows;
    try {
        const value = JSON.parse(raw.toString('utf8'));
        rows = parseDrain(value, process.env.VERCEL_OBSERVABILITY_PROJECT_ID || 'prj_kO5LjprIPXhyhcGwrj4pTDKg7RUb');
    }
    catch {
        return NextResponse.json({ error: 'Invalid drain payload' }, { status: 400 });
    }
    if (!rows.length)
        return NextResponse.json({ accepted: 0 });
    try {
        const { supabaseAdmin } = await import('@/lib/supabaseAdmin');
        const { error } = await supabaseAdmin.from('observability_events').upsert(rows, { onConflict: 'event_id', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(5000));
        if (error)
            throw error;
        return NextResponse.json({ accepted: rows.length });
    }
    catch {
        return NextResponse.json({ error: 'Telemetry storage unavailable' }, { status: 503 });
    }
}
