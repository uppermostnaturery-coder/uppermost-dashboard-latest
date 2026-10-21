"use client";
import { useEffect, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { ROUTES, type HealthMetrics } from '@/lib/observability/contracts';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);
type Snapshot = {
    state: string;
    metrics: HealthMetrics | null;
    sources: Record<string, {
        state: string;
        frontend_errors?: number | null;
        backend_errors?: number | null;
        checked_at?: string | null;
    }>;
    generated_at?: string;
    error?: string;
    coverage_note?: string;
};
const date = (v: string | null | undefined) => v ? new Date(v).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'No observations';
const ms = (v: number | null | undefined) => v == null ? '—' : `${Math.round(v).toLocaleString('en-IN')} ms`;
export default function ProductionHealth() {
    const [hours, setHours] = useState(24), [route, setRoute] = useState(''), [status, setStatus] = useState(''), [method, setMethod] = useState(''), [release, setRelease] = useState(''), [refresh, setRefresh] = useState(0), [snapshot, setSnapshot] = useState<Snapshot | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
    useEffect(() => { const interval = window.setInterval(() => setRefresh(v => v + 1), 60000); return () => window.clearInterval(interval); }, []);
    useEffect(() => {
        let current = true;
        const controller = new AbortController();
        setLoading(true);
        setError('');
        setSnapshot(null);
        const timeout = window.setTimeout(() => controller.abort(), 12000);
        const params = new URLSearchParams({ hours: String(hours) });
        for (const [key, value] of Object.entries({ route, status, method, release }))
            if (value)
                params.set(key, value);
        fetch('/api/observability/health?' + params, { signal: controller.signal, cache: 'no-store' }).then(async (r) => { const d = await r.json(); if (current) {
            setSnapshot(d);
            if (!r.ok)
                setError(d.error || 'Telemetry unavailable');
        } }).catch(() => { if (current)
            setError('Telemetry could not be loaded. No zero-error or uptime conclusion can be drawn.'); }).finally(() => { clearTimeout(timeout); if (current)
            setLoading(false); });
        return () => { current = false; controller.abort(); clearTimeout(timeout); };
    }, [hours, route, status, method, release, refresh]);
    const sentry = snapshot?.sources.sentry;
    const m = snapshot?.metrics, observed = !!m && m.total > 0, labels = (m?.series || []).map(v => new Date(v.at!).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
    const options = { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#c7b49c' } } }, scales: { x: { ticks: { color: '#a99884', maxTicksLimit: 8 }, grid: { color: 'rgba(255,255,255,.04)' } }, y: { beginAtZero: true, ticks: { color: '#a99884' }, grid: { color: 'rgba(255,255,255,.07)' } } } };
    const traffic = { labels, datasets: [['s2xx', '2xx', '#8ba767'], ['s3xx', '3xx', '#91aaa5'], ['s4xx', '4xx', '#d8a741'], ['s5xx', '5xx', '#e67250']].map(([key, label, color]) => ({ label, data: (m?.series || []).map(v => (v as any)[key]), borderColor: color, backgroundColor: color, tension: .2, pointRadius: 0 })) };
    const latency = { labels, datasets: [['p50', '#91aaa5'], ['p95', '#d8a741'], ['p99', '#e67250']].map(([key, color]) => ({ label: key + ' (ms)', data: (m?.series || []).map(v => (v as any)[key]), borderColor: color, pointRadius: 0, tension: .2 })) };
    return <section className="production-health" data-production-health>
  <div className="health-heading"><div><h2>Production Health</h2><p>API traffic, response failures and handler latency · production only</p></div><button onClick={() => setRefresh(v => v + 1)} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button></div>
  <div className="health-filters"><label>Window<select value={hours} onChange={e => setHours(Number(e.target.value))}>{[[1, 'Last hour'], [24, '24 hours'], [168, '7 days'], [720, '30 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
   <label>Endpoint<select value={route} onChange={e => setRoute(e.target.value)}><option value="">All endpoints</option>{Object.keys(ROUTES).map(r => <option key={r}>{r}</option>)}</select></label>
   <label>Method<select value={method} onChange={e => setMethod(e.target.value)}><option value="">All methods</option>{['GET', 'POST', 'OPTIONS', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map(v => <option key={v}>{v}</option>)}</select></label>
   <label>Status<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All responses</option>{['2xx', '3xx', '4xx', '5xx'].map(v => <option key={v}>{v}</option>)}</select></label>
   <label>Release<select value={release} onChange={e => setRelease(e.target.value)}><option value="">All releases</option>{(m?.releases || []).map(v => <option key={v} value={v}>{v.slice(0, 7)}</option>)}</select></label></div>
  {error && <p className="health-notice" role="alert">{error}</p>}
  <p className="health-notice" role="status">{loading ? 'Loading production telemetry…' : snapshot?.state === 'disabled' ? 'Collection is not enabled. No production health data is available yet.' : snapshot?.state === 'no_observations' ? 'No observations received. This does not establish zero traffic or zero errors.' : snapshot?.state === 'no_recent_observations' ? 'No API observations in the last 10 minutes. Traffic may be quiet or collection interrupted.' : snapshot?.state === 'receiving' ? 'Receiving API observations. This is not an uptime guarantee.' : 'Collection health is unknown.'}</p>
  <div className="health-stats">{[['Observed requests', m ? m.total.toLocaleString('en-IN') : '—'], ['5xx failures', m ? String(m.s5xx) : '—'], ['5xx error rate', observed ? ((m!.s5xx / m!.total) * 100).toFixed(2) + '%' : '—'], ['Validation failures', m ? String(m.validation) : '—'], ['p95 handler latency', ms(m?.p95)], ['Slow requests ≥2s', m ? String(m.slow) : '—'], ['Sentry storefront errors', sentry?.frontend_errors == null ? '—' : String(sentry.frontend_errors)], ['Sentry backend errors', sentry?.backend_errors == null ? '—' : String(sentry.backend_errors)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
  {m && <><div className="health-charts"><article><h3>HTTP response trends</h3><div className="health-chart">{observed ? <Line options={options} data={traffic}/> : <p>No request samples in this window.</p>}</div></article><article><h3>Handler latency percentiles</h3><div className="health-chart">{observed ? <Line options={options} data={latency}/> : <p>No latency samples in this window.</p>}</div></article></div>
   <div className="health-table-wrap"><table><caption>Endpoint health · selected filters</caption><thead><tr>{['Endpoint', 'Method', 'Requests', '4xx', '5xx', 'Validation', 'Business failures', 'p50', 'p95', 'p99', 'Last failure (IST)'].map(v => <th key={v}>{v}</th>)}</tr></thead><tbody>{m.routes.map((r, i) => <tr key={r.route + r.method + i}><td>{r.route}</td><td>{r.method}</td><td>{r.total}</td><td>{r.s4xx}</td><td>{r.s5xx}</td><td>{r.validation}</td><td>{r.business_failures}</td><td>{ms(r.p50)}</td><td>{ms(r.p95)}</td><td>{ms(r.p99)}</td><td>{date(r.last_failure)}</td></tr>)}</tbody></table>{!m.routes.length && <p>No observations match these filters.</p>}</div>
   <div className="health-notice">{m.s4xx} responses were 4xx; expected validation/rejections are distinct from server defects. {m.business_failures} explicitly observed business failures. Observed platform log entries across this whole time window: {m.platform_failures} failures, {m.platform_crashes} pre-response exceptions, {m.platform_unknown_routes} unknown API paths and {m.platform_unsupported_methods} method rejections. These are log-entry counts, separate from request totals and endpoint filters.{m.s5xx >= 3 && m.total >= 20 && m.s5xx / m.total >= .05 && <p>Investigation signal: at least 3 server failures and a 5xx rate ≥5%. No automatic blocking or notifications are enabled.</p>}</div></>}
  <div className="health-sources">{Object.entries(snapshot?.sources || { app: { state: 'unknown' }, vercel: { state: 'unknown' }, sentry: { state: 'unknown' } }).map(([name, source]) => <article key={name}><h3>{name === 'app' ? 'API instrumentation' : name === 'vercel' ? 'Vercel platform logs' : 'Sentry diagnostics'}</h3><p>{source.state.replaceAll('_', ' ')}</p><small>{name === 'app' ? 'Last observation: ' + date(m?.last_observed) : name === 'vercel' ? 'Last retained platform record: ' + date(m?.last_platform) : 'Reporting checked: ' + date(source.checked_at) + '. Counts cover production errors in the selected time window, across endpoints. Reporting access does not prove that every browser is instrumented.'}</small></article>)}</div>
  <p className="health-footnote">Observed coverage starts {date(m?.first_observed)}. Retention target: 30 days. Missing time buckets contain no observed samples; they are not confirmed zero-traffic periods. Latency measures handler completion, excluding network and platform startup. Requests that fail before the handler runs require separate platform evidence. Raw diagnostics remain private.</p>
 </section>;
}
