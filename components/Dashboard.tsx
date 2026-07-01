"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Filler,
  Tooltip,
} from "chart.js";
import { Line } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, Filler, Tooltip);

// ─── Types ───────────────────────────────────
type Page = "overview" | "realtime" | "funnel" | "pages" | "visitors" | "events" | "sources" | "scrolldepth";

interface Metrics {
  visitors: number; online: number; sessions: number;
  pageviews: number; events: number; atc: number;
  checkouts: number; purchases: number;
}

interface EventRow {
  event_name: string; page_path: string | null;
  created_at: string; session_id?: string | null;
}

interface VisitorRow {
  visitor_id: string; is_online: boolean;
  current_session_id: string | null;
  first_seen_at?: string | null; last_seen_at: string | null;
  device_type?: string | null; browser?: string | null; os?: string | null;
}

interface BarItem { label: string; count: number; }

// ─── Helpers ─────────────────────────────────
function rangeStart(days: number) {
  // IST (India) ke hisaab se calendar-day boundaries
  const IST_OFFSET = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30

  // abhi ka IST time
  const nowIST = new Date(Date.now() + IST_OFFSET);

  // IST me aaj ki aadhi raat (00:00)
  const istMidnight = new Date(nowIST);
  istMidnight.setUTCHours(0, 0, 0, 0);

  // "days" din peeche jao (Today=1 → aaj se 0 din peeche = aaj 12 AM)
  istMidnight.setUTCDate(istMidnight.getUTCDate() - (days - 1));

  // wapas UTC me convert karke bhejo (kyunki DB UTC me hai)
  return new Date(istMidnight.getTime() - IST_OFFSET).toISOString();
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) +
    " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(iso: string) {
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function shortId(id: string | null) {
  if (!id) return "—";
  return id.substring(0, 12) + "…";
}

const BAR_COLORS = ["#c98a4b", "#8fae6b", "#8aa6a3", "#d9a441", "#c4633f", "#c98a6f"];

// ─── Sub-components ──────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
      <div style={{ width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      Loading…
    </div>
  );
}

function MetricCard({ label, value, color, badge, highlight }: { label: string; value: number | string; color: string; badge: string; highlight?: boolean }) {
  return (
    <div style={{
      background: highlight ? "var(--card2)" : "var(--card)",
      border: highlight ? "1px solid var(--border2)" : "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "14px 16px", position: "relative", overflow: "hidden", animation: "fadeIn 0.3s ease",
    }}>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: color }} />
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 8 }}>{label}</div>
      <div style={{
        fontSize: highlight ? 30 : 26,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        color: highlight ? "#ffffff" : "var(--text)",
        textShadow: highlight ? "0 0 18px rgba(255,255,255,0.18)" : "none",
      }}>{value}</div>
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, marginTop: 6,
        padding: "2px 6px", borderRadius: 4,
        background: color === "var(--green)" ? "rgba(143,174,107,0.14)" : color === "var(--blue)" ? "rgba(138,166,163,0.14)" : "rgba(201,138,75,0.14)",
        color: color,
      }}>● {badge}</div>
    </div>
  );
}

function BarList({ items }: { items: BarItem[] }) {
  if (!items.length) return <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>No data yet</div>;
  const max = Math.max(...items.map(i => i.count)) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {items.map((item, i) => (
        <div key={item.label} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
            <span style={{ color: "var(--text)" }}>{item.label || "Unknown"}</span>
            <span style={{ color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{item.count}</span>
          </div>
          <div style={{ height: 4, background: "var(--bg3)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${Math.round(item.count / max * 100)}%`, background: BAR_COLORS[i % BAR_COLORS.length], borderRadius: 2, transition: "width 0.6s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Panel({ title, badge, children, style }: { title: string; badge?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)" }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: "rgba(34,211,160,0.12)", color: "var(--green)", border: "1px solid rgba(34,211,160,0.2)" }}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function EventFeedItem({ e }: { e: EventRow }) {
  const dotColors: Record<string, string> = {
    page_view: "var(--accent)", heartbeat: "var(--dim)",
    add_to_cart: "var(--amber)", purchase: "var(--green)", checkout: "var(--blue)",
  };
  const color = dotColors[e.event_name] || "var(--pink)";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)", animation: "fadeIn 0.2s ease" }}>
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, marginTop: 4, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{e.event_name}</div>
        <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.page_path || "—"}</div>
      </div>
      <div style={{ fontSize: 10, color: "var(--dim)", whiteSpace: "nowrap", flexShrink: 0 }}>{timeAgo(e.created_at)}</div>
    </div>
  );
}

// ══════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════
export default function Dashboard() {
  const [activePage, setActivePage] = useState<Page>("overview");
  const [range, setRange]           = useState(1);
  const [connected, setConnected]   = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterEvent, setFilterEvent] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");

  // Data states
  const [metrics, setMetrics]       = useState<Metrics>({ visitors:0, online:0, sessions:0, pageviews:0, events:0, atc:0, checkouts:0, purchases:0 });
  const [pvData, setPvData]         = useState<{ labels: string[]; values: number[] }>({ labels: [], values: [] });
  const [nowCount, setNowCount]     = useState(0);
  const [nowPages, setNowPages]     = useState({ home: 0, product: 0, checkout: 0 });
  const [devices, setDevices]       = useState<BarItem[]>([]);
  const [browsers, setBrowsers]     = useState<BarItem[]>([]);
  const [eventFeed, setEventFeed]   = useState<EventRow[]>([]);
  const [sidebarStats, setSidebarStats] = useState({ online:0, visitors:0, sessions:0, events:0 });

  // Page-specific states
  const [visitors, setVisitors]     = useState<VisitorRow[]>([]);
  const [eventsTable, setEventsTable] = useState<EventRow[]>([]);
  const [funnelData, setFunnelData] = useState<{ name: string; count: number; color: string }[]>([]);
  const [pagesData, setPagesData]   = useState<{ path: string; views: number; visitors: number; events: number }[]>([]);
  const [sources, setSources]       = useState<{ sources: BarItem[]; mediums: BarItem[]; campaigns: BarItem[]; referrers: BarItem[] }>({ sources: [], mediums: [], campaigns: [], referrers: [] });
  const [scrollDepth, setScrollDepth] = useState<{ pct: string; count: number }[]>([]);

  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // ── helpers ──
  const toBarArr = (obj: Record<string, number>): BarItem[] =>
    Object.entries(obj).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8);

  // ── CONNECTION CHECK ──
  const checkConn = useCallback(async () => {
    try {
      const { error } = await supabase.from("analytics_events").select("event_name", { count: "exact", head: true });
      setConnected(!error);
    } catch { setConnected(false); }
  }, []);

  // ── SIDEBAR ──
  const loadSidebar = useCallback(async () => {
    const [on, vis, ses, ev] = await Promise.all([
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }).eq("is_online", true),
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }),
      supabase.from("analytics_sessions").select("session_id", { count: "exact", head: true }),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).gte("created_at", rangeStart(range)),
    ]);
    setSidebarStats({ online: on.count ?? 0, visitors: vis.count ?? 0, sessions: ses.count ?? 0, events: ev.count ?? 0 });
  }, [range]);

  // ── METRICS ──
  const loadMetrics = useCallback(async () => {
    const since = rangeStart(range);
    const [v, on, s, pv, ev, atc, co, pur] = await Promise.all([
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }),
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }).eq("is_online", true),
      supabase.from("analytics_sessions").select("session_id", { count: "exact", head: true }).gte("last_seen_at", since),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).eq("event_name", "page_view").gte("created_at", since),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).gte("created_at", since),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).eq("event_name", "add_to_cart").gte("created_at", since),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).eq("event_name", "checkout_started").gte("created_at", since),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).ilike("event_name", "purchase%").gte("created_at", since),
    ]);
    setMetrics({ visitors: v.count??0, online: on.count??0, sessions: s.count??0, pageviews: pv.count??0, events: ev.count??0, atc: atc.count??0, checkouts: co.count??0, purchases: pur.count??0 });
  }, [range]);

  // ── PAGE VIEW CHART ──
  const loadPvChart = useCallback(async () => {
    const since = new Date(); since.setDate(since.getDate() - 7);
    const { data } = await supabase.from("analytics_events").select("created_at").eq("event_name", "page_view").gte("created_at", since.toISOString()).order("created_at", { ascending: true });
    const dayMap: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      dayMap[d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })] = 0;
    }
    (data || []).forEach(e => {
      const k = new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      if (k in dayMap) dayMap[k]++;
    });
    setPvData({ labels: Object.keys(dayMap), values: Object.values(dayMap) });
  }, []);

  // ── DEVICES + BROWSERS ──
  const loadDevicesBrowsers = useCallback(async () => {
    const { data } = await supabase.from("analytics_sessions").select("device_type, browser").gte("last_seen_at", rangeStart(range));
    const dMap: Record<string, number> = {}, bMap: Record<string, number> = {};
    (data || []).forEach(s => {
      const dt = s.device_type || "Unknown"; dMap[dt] = (dMap[dt] || 0) + 1;
      const br = s.browser || "Unknown";    bMap[br] = (bMap[br] || 0) + 1;
    });
    setDevices(toBarArr(dMap));
    setBrowsers(toBarArr(bMap));
  }, [range]);

  // ── RIGHT NOW ──
  const loadRightNow = useCallback(async () => {
    const { data: online } = await supabase.from("analytics_visitors").select("current_session_id").eq("is_online", true);
    setNowCount((online || []).length);
    const fiveMin = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await supabase.from("analytics_events").select("page_path").eq("event_name", "page_view").gte("created_at", fiveMin);
    let home = 0, product = 0, checkout = 0;
    (recent || []).forEach(e => {
      const p = e.page_path || "";
      if (p === "/" || p === "/home") home++;
      else if (p.includes("product") || p.includes("ghee")) product++;
      else if (p.includes("checkout") || p.includes("cart")) checkout++;
    });
    setNowPages({ home, product, checkout });
  }, []);

  // ── EVENT FEED ──
const loadEventFeed = useCallback(async () => {
    const since = rangeStart(range);
    const { data } = await supabase
      .from("analytics_events")
      .select("event_name, page_path, created_at, session_id")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);
    setEventFeed(data || []);
  }, [range]);

  // ── VISITORS ──
  // FIX: was missing `first_seen_at` in the select, so the "First Seen"
  // column in the table always rendered "—".
  const loadVisitors = useCallback(async () => {
    const { data } = await supabase.from("analytics_visitors").select("visitor_id, is_online, current_session_id, first_seen_at, last_seen_at").order("last_seen_at", { ascending: false }).limit(50);
    if (!data) return;
    const sids = Array.from(new Set(data.map(v => v.current_session_id).filter(Boolean))) as string[];
    let sessionMap: Record<string, { device_type?: string; browser?: string; os?: string }> = {};
    if (sids.length) {
      const { data: sd } = await supabase.from("analytics_sessions").select("session_id, device_type, browser, os").in("session_id", sids);
      (sd || []).forEach(s => { sessionMap[s.session_id] = s; });
    }
    setVisitors(data.map(v => ({ ...v, ...(sessionMap[v.current_session_id || ""] || {}) })));
  }, []);

  // ── EVENTS TABLE ──
  const loadEventsTable = useCallback(async () => {
    const { data } = await supabase.from("analytics_events").select("event_name, page_path, session_id, created_at").gte("created_at", rangeStart(range)).order("created_at", { ascending: false }).limit(100);
    setEventsTable(data || []);
  }, [range]);

  // ── FUNNEL ──
  // FIX: last stage was "buy_now_click", inconsistent with the "Purchases"
  // metric card on Overview (which counts event_name ILIKE 'purchase%').
  // Aligned both to use the same purchase event family.
  const loadFunnel = useCallback(async () => {
    const since = rangeStart(range);
    const steps = [
      { name: "Page Views",  match: (q: any) => q.eq("event_name", "page_view"),        color: "#c98a4b" },
      { name: "Add to Cart", match: (q: any) => q.eq("event_name", "add_to_cart"),      color: "#8aa6a3" },
      { name: "Checkout",    match: (q: any) => q.eq("event_name", "checkout_started"), color: "#d9a441" },
      { name: "Purchase",    match: (q: any) => q.ilike("event_name", "purchase%"),     color: "#8fae6b" },
    ];
    const counts = await Promise.all(steps.map(s => {
      const q = supabase.from("analytics_events").select("event_name", { count: "exact", head: true });
      return s.match(q).gte("created_at", since);
    }));
    setFunnelData(steps.map((s, i) => ({ name: s.name, count: counts[i].count ?? 0, color: s.color })));
  }, [range]);

  // ── PAGES ──
  const loadPages = useCallback(async () => {
    const { data } = await supabase.from("analytics_events").select("page_path, visitor_id, event_name").gte("created_at", rangeStart(range));
    const map: Record<string, { views: number; visitors: Set<string>; events: number }> = {};
    (data || []).forEach(e => {
      const p = e.page_path || "/";
      if (!map[p]) map[p] = { views: 0, visitors: new Set(), events: 0 };
      map[p].events++;
      if (e.event_name === "page_view") map[p].views++;
      if (e.visitor_id) map[p].visitors.add(e.visitor_id);
    });
    setPagesData(Object.entries(map).map(([path, d]) => ({ path, views: d.views, visitors: d.visitors.size, events: d.events })).sort((a, b) => b.views - a.views).slice(0, 20));
  }, [range]);

  // ── SOURCES ──
  const loadSources = useCallback(async () => {
    const { data } = await supabase.from("analytics_events").select("metadata").gte("created_at", rangeStart(range));
    const agg = (key: string) => {
      const m: Record<string, number> = {};
      (data || []).forEach((e) => {
        const meta = e.metadata as Record<string, string | null> | null;
        const val = meta?.[key];
        if (val) m[val] = (m[val] || 0) + 1;
      });
      return toBarArr(m);
    };
    setSources({ sources: agg("utm_source"), mediums: agg("utm_medium"), campaigns: agg("utm_campaign"), referrers: agg("referrer") });
  }, [range]);

  // ── SCROLL DEPTH ──
  // FIX: the tracker emits discrete events named "scroll_depth_25",
  // "scroll_depth_50", "scroll_depth_75", "scroll_depth_100" — it does NOT
  // store a numeric `metadata.depth` field. The old code read
  // `metadata.depth`, which never existed, so this page was always empty.
  // Now we bucket by the milestone encoded in the event name itself.
  const loadScrollDepth = useCallback(async () => {
    const { data } = await supabase.from("analytics_events").select("event_name").ilike("event_name", "scroll_depth_%").gte("created_at", rangeStart(range));
    const buckets: Record<string, number> = { "25%": 0, "50%": 0, "75%": 0, "100%": 0 };
    (data || []).forEach(e => {
      const milestone = e.event_name.replace("scroll_depth_", "").trim();
      const key = `${milestone}%`;
      if (key in buckets) buckets[key]++;
    });
    setScrollDepth(Object.entries(buckets).reverse().map(([pct, count]) => ({ pct, count })));
  }, [range]);

  // ── REALTIME SUBSCRIPTION ──
  // FIX: was subscribed to table "events", which doesn't exist in this
  // schema — the real table is "analytics_events". Because of this, the
  // realtime channel silently received zero INSERTs and the live feed /
  // online counter never updated outside of the 30s poll.
  const subscribe = useCallback(() => {
    if (subRef.current) supabase.removeChannel(subRef.current);
    subRef.current = supabase.channel("dashboard-events")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "analytics_events" }, payload => {
        const e = payload.new as EventRow;
        setEventFeed(prev => [e, ...prev].slice(0, 40));
        setNowCount(prev => e.event_name === "page_view" ? prev + 1 : prev);
        loadSidebar();
        loadRightNow();
      })
      .subscribe();
  }, [loadSidebar, loadRightNow]);

  // ── LOAD ALL ──
 const loadAll = useCallback(async () => {
  setRefreshing(true);
  try {
    await Promise.all([loadMetrics(), loadPvChart(), loadDevicesBrowsers(), loadRightNow(), loadEventFeed(), loadSidebar()]);
  } finally {
    setRefreshing(false);
  }
}, [loadMetrics, loadPvChart, loadDevicesBrowsers, loadRightNow, loadEventFeed, loadSidebar]);
  // ── INIT ──
  useEffect(() => {
    checkConn();
    loadAll();
    subscribe();
    // FIX: poll also refreshes the event feed now, so the feed still moves
    // even if the realtime channel ever drops/reconnects.
    const t = setInterval(() => { loadMetrics(); loadRightNow(); loadSidebar(); loadEventFeed(); }, 30000);
    return () => { clearInterval(t); if (subRef.current) supabase.removeChannel(subRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadAll(); }, [range, loadAll]);

  // ── PAGE SWITCH ──
  useEffect(() => {
    if (activePage === "visitors")    loadVisitors();
    if (activePage === "events")      loadEventsTable();
    if (activePage === "funnel")      loadFunnel();
    if (activePage === "pages")       loadPages();
    if (activePage === "sources")     loadSources();
    if (activePage === "scrolldepth") loadScrollDepth();
    if (activePage === "realtime")    loadEventFeed();
  }, [activePage, loadVisitors, loadEventsTable, loadFunnel, loadPages, loadSources, loadScrollDepth, loadEventFeed]);

  // ── Chart config ──
  const chartData = {
    labels: pvData.labels,
    datasets: [{
      data: pvData.values, borderColor: "#c98a4b", backgroundColor: "rgba(201,138,75,0.10)",
      borderWidth: 2, pointRadius: 3, pointBackgroundColor: "#c98a4b", tension: 0.4, fill: true,
    }],
  };
  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx: { parsed: { y: number } }) => ` ${ctx.parsed.y} views` } } },
    scales: {
      x: { grid: { color: "rgba(232,210,184,0.06)" }, ticks: { color: "#a89280", font: { size: 10 } } },
      y: { grid: { color: "rgba(232,210,184,0.06)" }, ticks: { color: "#a89280", font: { size: 10 }, stepSize: 1 }, beginAtZero: true },
    },
  };

  const funnelMax = Math.max(...funnelData.map(f => f.count)) || 1;
  const scrollMax = Math.max(...(scrollDepth.map(s => s.count))) || 1;

  // ══════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════
  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>

      {/* ── SIDEBAR (left) ── */}
      <aside style={{ order: 0, width: 200, minWidth: 200, background: "var(--bg2)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
        <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/uppermost-logo.png" alt="Uppermost" style={{ width: 40, height: 40, objectFit: "cover", borderRadius: 8, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 500, fontFamily: "Georgia, 'Times New Roman', serif", color: "var(--text)", lineHeight: 1.2 }}>Uppermôst.</div>
            <div style={{ fontSize: 9, color: "var(--muted)", letterSpacing: "0.05em", marginTop: 2, textTransform: "uppercase" }}>Analytics Intelligence</div>
          </div>
        </div>

        <nav style={{ padding: "12px 0", flex: 1, overflowY: "auto" }}>
          {([
            ["overview", "Overview"], ["realtime", "Real-Time"], ["funnel", "Funnel"],
            ["pages", "Pages"], ["visitors", "Visitors"], ["events", "Events"],
            ["sources", "Sources"], ["scrolldepth", "Scroll Depth"],
          ] as [Page, string][]).map(([page, label]) => (
            <div key={page} onClick={() => setActivePage(page)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 18px",
              cursor: "pointer", color: activePage === page ? "var(--text)" : "var(--muted)",
              background: activePage === page ? "rgba(124,106,247,0.12)" : "transparent",
              fontSize: 13, position: "relative", userSelect: "none", transition: "all 0.15s",
            }}>
              {activePage === page && <div style={{ position: "absolute", left: 0, top: 4, bottom: 4, width: 2, background: "var(--accent)", borderRadius: "0 2px 2px 0" }} />}
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: activePage === page ? "var(--accent)" : "var(--dim)", flexShrink: 0 }} />
              {label}
            </div>
          ))}
        </nav>

        <div style={{ padding: "14px 18px 18px", borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--green)", animation: "pulse 2s ease-in-out infinite" }} />
            Live Status
          </div>
          {[
            ["Online Now", sidebarStats.online],
            ["Visitors", sidebarStats.visitors],
            ["Sessions", sidebarStats.sessions],
            ["Events", sidebarStats.events],
          ].map(([label, val]) => (
            <div key={String(label)} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
              <span style={{ fontSize: 11, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{val}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* ── MAIN (right) ── */}
      <div style={{ order: 1, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Topbar */}
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", background: "var(--bg2)" }}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em" }}>Analytics Overview</div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>uppermost.store — Live tracking dashboard</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {[{ d: 1, l: "Today" }, { d: 2, l: "48H" }, { d: 7, l: "7D" }, { d: 30, l: "30D" }, { d: 90, l: "90D" }].map(({ d, l }) => (
                <button key={d} onClick={() => setRange(d)} style={{
                  padding: "5px 11px", fontSize: 11, borderRadius: 6,
                  border: `1px solid ${range === d ? "var(--accent)" : "var(--border2)"}`,
                  background: range === d ? "var(--accent2)" : "transparent",
                  color: range === d ? "#fff" : "var(--muted)", cursor: "pointer", transition: "all 0.15s",
                }}>{l}</button>
              ))}
            </div>

            <button
              onClick={() => loadAll()}
              disabled={refreshing}
              title="Refresh"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: 32,
                height: 32,
                borderRadius: 8,
                border: "1px solid var(--border)",
                background: "var(--border2)",
                color: "var(--muted)",
                cursor: refreshing ? "default" : "pointer",
                transition: "all 0.15s",
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                style={{ animation: refreshing ? "uppermost-spin 0.7s linear infinite" : "none" }}>
                <path d="M21 12a9 9 0 1 1-2.64-6.36" />
                <path d="M21 3v6h-6" />
              </svg>
            </button>

            <div style={{
              display: "flex", alignItems: "center", gap: 5, fontSize: 11, padding: "5px 10px",
              borderRadius: 6,
              background: connected === true ? "rgba(34,211,160,0.1)" : "rgba(244,63,94,0.1)",
              color: connected === true ? "var(--green)" : connected === false ? "var(--red)" : "var(--muted)",
              border: `1px solid ${connected === true ? "rgba(34,211,160,0.2)" : connected === false ? "rgba(244,63,94,0.2)" : "var(--border)"}`,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
              {connected === null ? "Connecting…" : connected ? "Connected" : "Error"}
            </div>
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>

          {/* ══ OVERVIEW ══ */}
          {activePage === "overview" && <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px,1fr))", gap: 12 }}>
              <MetricCard label="Total Visitors"  value={metrics.visitors}  color="var(--accent)" badge="Live" highlight />
              <MetricCard label="Online Now"       value={metrics.online}    color="var(--green)"  badge="Real-time" highlight />
              <MetricCard label="Sessions"          value={metrics.sessions}  color="var(--blue)"   badge="Live" highlight />
              <MetricCard label="Page Views"        value={metrics.pageviews} color="var(--amber)"  badge="Live" />
              <MetricCard label="Total Events"      value={metrics.events}    color="var(--accent)" badge="Live" />
              <MetricCard label="Add to Cart"       value={metrics.atc}       color="var(--amber)"  badge="Live" />
              <MetricCard label="Checkouts"         value={metrics.checkouts} color="var(--blue)"   badge="Live" />
              <MetricCard label="Purchases"         value={metrics.purchases} color="var(--green)"  badge="Live" />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
              <Panel title="Page Views — Last 7 Days" badge="Live">
                <div style={{ position: "relative", height: 180 }}>
                  <Line data={chartData} options={chartOptions as Parameters<typeof Line>[0]["options"]} />
                </div>
              </Panel>
              <Panel title="⚡ Right Now" badge="● Live">
                <div style={{ fontSize: 56, fontWeight: 800, letterSpacing: "-0.04em", color: "var(--green)", lineHeight: 1, textAlign: "center", padding: "10px 0", fontVariantNumeric: "tabular-nums" }}>{nowCount}</div>
                <div style={{ textAlign: "center", fontSize: 11, color: "var(--muted)", marginBottom: 14 }}>Visitors on site</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[["Homepage", nowPages.home], ["Product", nowPages.product], ["Checkout", nowPages.checkout]].map(([label, val]) => (
                    <div key={String(label)} style={{ background: "var(--bg3)", borderRadius: "var(--radius-sm)", padding: "10px 8px", textAlign: "center", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{val}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 14 }}>
              <Panel title="Devices"><BarList items={devices} /></Panel>
              <Panel title="Browsers"><BarList items={browsers} /></Panel>
              <Panel title="Live Event Feed" badge="● Live">
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {eventFeed.length === 0
                    ? <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>Waiting for events…</div>
                    : eventFeed.map((e, i) => <EventFeedItem key={i} e={e} />)}
                </div>
              </Panel>
            </div>
          </>}

          {/* ══ REAL-TIME ══ */}
          {activePage === "realtime" && <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
              <MetricCard label="Online Right Now" value={metrics.online}    color="var(--green)"  badge="Real-time" />
              <MetricCard label="Active Sessions"   value={metrics.sessions}  color="var(--blue)"   badge="Live" />
              <MetricCard label="Page Views Today"  value={metrics.pageviews} color="var(--accent)" badge="Live" />
            </div>
            <Panel title="Live Activity Stream" badge="● Live">
              <div style={{ maxHeight: 500, overflowY: "auto" }}>
                {eventFeed.length === 0
                  ? <div style={{ textAlign: "center", padding: 32, color: "var(--dim)", fontSize: 12 }}>Waiting for events…</div>
                  : eventFeed.map((e, i) => <EventFeedItem key={i} e={e} />)}
              </div>
            </Panel>
          </>}

          {/* ══ FUNNEL ══ */}
          {activePage === "funnel" && (
            <Panel title="Conversion Funnel">
              {funnelData.length === 0 ? <Spinner /> :
                <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
                  {funnelData.map((step, i) => {
                    const pct = Math.round(step.count / funnelMax * 100);
                    const convPct = i === 0 ? 100 : funnelData[0].count ? Math.round(step.count / funnelData[0].count * 100) : 0;
                    return (
                      <div key={step.name} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <div style={{ width: 90, fontSize: 12, color: "var(--muted)", textAlign: "right" }}>{step.name}</div>
                        <div style={{ flex: 1, height: 36, background: "var(--bg3)", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border)" }}>
                          <div style={{ height: "100%", width: `${pct}%`, background: step.color, borderRadius: "var(--radius-sm)", display: "flex", alignItems: "center", padding: "0 12px", fontSize: 12, fontWeight: 600, color: "#fff", transition: "width 0.8s ease" }}>{step.count}</div>
                        </div>
                        <div style={{ width: 90, textAlign: "right" }}>
                          <div style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{step.count}</div>
                          <div style={{ fontSize: 11, color: "var(--dim)" }}>{convPct}% of views</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              }
            </Panel>
          )}

          {/* ══ PAGES ══ */}
          {activePage === "pages" && (
            <Panel title="Top Pages">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>{["Page", "Views", "Unique Visitors", "Events"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {pagesData.length === 0
                      ? <tr><td colSpan={4}><div style={{ padding: 24 }}><Spinner /></div></td></tr>
                      : pagesData.map(row => (
                        <tr key={row.path} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 12px" }}>{row.path}</td>
                          <td style={{ padding: "9px 12px", fontVariantNumeric: "tabular-nums" }}>{row.views}</td>
                          <td style={{ padding: "9px 12px", fontVariantNumeric: "tabular-nums" }}>{row.visitors}</td>
                          <td style={{ padding: "9px 12px", fontVariantNumeric: "tabular-nums" }}>{row.events}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ══ VISITORS ══ */}
          {activePage === "visitors" && (
            <Panel title="Visitor Log">
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>{["Visitor ID", "Status", "Device", "Browser", "OS", "First Seen", "Last Seen"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {visitors.length === 0
                      ? <tr><td colSpan={7}><div style={{ padding: 24 }}><Spinner /></div></td></tr>
                      : visitors.map(v => {
                        const dt = v.device_type || "unknown";
                        const deviceColors: Record<string, string> = { mobile: "var(--blue)", desktop: "var(--accent)", tablet: "var(--amber)", unknown: "var(--muted)" };
                        return (
                          <tr key={v.visitor_id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11 }}>{shortId(v.visitor_id)}</td>
                            <td style={{ padding: "9px 12px" }}>
                              <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: v.is_online ? "rgba(34,211,160,0.15)" : "rgba(107,107,128,0.15)", color: v.is_online ? "var(--green)" : "var(--muted)" }}>{v.is_online ? "Online" : "Offline"}</span>
                            </td>
                            <td style={{ padding: "9px 12px" }}>
                              <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${deviceColors[dt]}22`, color: deviceColors[dt] }}>{dt}</span>
                            </td>
                            <td style={{ padding: "9px 12px" }}>{v.browser || "—"}</td>
                            <td style={{ padding: "9px 12px" }}>{v.os || "—"}</td>
                            <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{fmt(v.first_seen_at ?? null)}</td>
                            <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{fmt(v.last_seen_at)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ══ EVENTS ══ */}
          {activePage === "events" && (
            <Panel title="All Events">

              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <select value={filterEvent} onChange={(ev) => setFilterEvent(ev.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12 }}>
                  <option value="all">All events</option>
                  {Array.from(new Set(eventsTable.map((e) => e.event_name))).map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <input value={filterSearch} onChange={(ev) => setFilterSearch(ev.target.value)}
                  placeholder="Search page / session..."
                  style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12, flex: 1, minWidth: 160 }} />
              </div>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>{["Event", "Page", "Device", "Session", "Time"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {eventsTable.length === 0
                      ? <tr><td colSpan={5}><div style={{ padding: 24 }}><Spinner /></div></td></tr>
                      
                      : eventsTable.filter((e) => {
                        const matchEvent = filterEvent === "all" || e.event_name === filterEvent;
                        const q = filterSearch.toLowerCase();
                        const matchSearch = !q || e.event_name?.toLowerCase().includes(q) || e.page_path?.toLowerCase().includes(q) || e.session_id?.toLowerCase().includes(q);
                        return matchEvent && matchSearch;
                      }).map((e, i) => (
                        
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 12px" }}>{e.event_name}</td>
                          <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{e.page_path || "—"}</td>
                          <td style={{ padding: "9px 12px", color: "var(--muted)" }}>—</td>
                          <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11 }}>{shortId(e.session_id || null)}</td>
                          <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{fmt(e.created_at)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}

          {/* ══ SOURCES ══ */}
          {activePage === "sources" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Panel title="UTM Sources"><BarList items={sources.sources} /></Panel>
              <Panel title="UTM Mediums"><BarList items={sources.mediums} /></Panel>
              <Panel title="UTM Campaigns"><BarList items={sources.campaigns} /></Panel>
              <Panel title="Referrers"><BarList items={sources.referrers} /></Panel>
            </div>
          )}

          {/* ══ SCROLL DEPTH ══ */}
          {activePage === "scrolldepth" && (
            <Panel title="Scroll Depth Distribution">
              {scrollDepth.every(s => s.count === 0)
                ? <div style={{ textAlign: "center", padding: 32, color: "var(--dim)", fontSize: 12, lineHeight: 1.6 }}>
                    No scroll_depth events yet.<br />
                    Track them from your storefront as discrete milestone events:<br />
                    <code style={{ fontSize: 11, color: "var(--muted)", background: "var(--bg3)", padding: "4px 8px", borderRadius: 4, marginTop: 8, display: "inline-block" }}>trackEvent(&quot;scroll_depth_75&quot;)</code>
                  </div>
                : <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {scrollDepth.map(({ pct, count }) => (
                    <div key={pct} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ fontSize: 12, color: "var(--muted)", width: 36, flexShrink: 0 }}>{pct}</div>
                      <div style={{ flex: 1, height: 10, background: "var(--bg3)", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
                        <div style={{ height: "100%", width: `${Math.round(count / scrollMax * 100)}%`, background: "linear-gradient(90deg,var(--accent),var(--blue))", borderRadius: 5, transition: "width 0.8s ease" }} />
                      </div>
                      <div style={{ fontSize: 11, color: "var(--dim)", width: 32, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{count}</div>
                    </div>
                  ))}
                </div>
              }
            </Panel>
          )}

        </div>{/* /content */}
      </div>{/* /main */}
    </div>
  );
}
