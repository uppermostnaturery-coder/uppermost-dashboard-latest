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
  Legend,
  ArcElement,
} from "chart.js";
import { Line, Doughnut, Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

// ─── Types ───────────────────────────────────
type Page = "overview" | "realtime" | "funnel" | "pages" | "visitors" | "events" | "sources" | "scrolldepth";

interface Metrics {
  visitors: number; online: number; sessions: number;
  pageviews: number; events: number; atc: number;
  checkouts: number; purchases: number;
}

interface EventRow {
  event_name: string;
  page_path: string | null;
  page_url?: string | null;
  created_at: string;
  session_id?: string | null;
  device_type?: string | null;
  metadata?: {
    text?: string | null;
    href?: string | null;
    destination_url?: string | null;
    id?: string | null;
    class_name?: string | null;
    action_type?: string | null;
    source?: string | null;
    from_path?: string | null;
    last_page?: string | null;
    depth?: number | string | null;
  } | null;
}

interface VisitorRow {
  visitor_id: string; is_online: boolean;
  current_session_id: string | null;
  first_seen_at?: string | null; last_seen_at: string | null;
  device_type?: string | null; browser?: string | null; os?: string | null;
  city?: string | null; country?: string | null;
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

function prettyPath(path?: string | null): string {
  if (!path || path === "/") return "Homepage";
  const map: Record<string, string> = {
    "/gir-cow-ghee": "Gir Cow Ghee",
    "/murrah-buffalo-ghee": "Murrah Buffalo Ghee",
  };
  return map[path] || path;
}

function getEventLabel(e: EventRow): string {
  const meta = e.metadata || {};
  const from = meta.from_path;
  const path = e.page_path || "/";

  switch (e.event_name) {
    case "page_view":
      return from && from !== path
        ? `From ${prettyPath(from)} → ${prettyPath(path)}`
        : `Page opened: ${prettyPath(path)}`;
    case "product_view":
      return `Viewed ${prettyPath(path)} page`;
    case "add_to_cart":
      return `Added to cart${meta.text ? " — " + meta.text : ""}`;
    case "remove_from_cart":
      return `Removed from cart${meta.text ? " — " + meta.text : ""}`;
    case "buy_now_click":
      return `Clicked Buy Now — ${prettyPath(path)}`;
    case "checkout_started":
    case "checkout_open":
      return `Opened checkout — from ${prettyPath(from || path)}`;
    case "checkout_exit":
      return `Returned from checkout → ${prettyPath(path)}`;
    case "session_end":
      return `Left site — last page: ${prettyPath(meta.last_page || path)}`;
    case "button_click":
      return `Clicked: ${meta.text || "button"}`;
    case "scroll_depth_25":
    case "scroll_depth_50":
    case "scroll_depth_75":
    case "scroll_depth_100": {
      const depth = meta.depth ?? e.event_name.replace("scroll_depth_", "");
      return `Scrolled ${depth}% — ${prettyPath(path)}`;
    }
    default:
      return `Page: ${prettyPath(path)}`;
  }
}

const BAR_COLORS = ["#c98a4b", "#8fae6b", "#8aa6a3", "#d9a441", "#c4633f", "#c98a6f"];
const BROWSER_OS_GRAPH_DATA: BarItem[] = [
  { label: "Chrome", count: 15 },
  { label: "Android", count: 4 },
  { label: "MacOS", count: 1 },
];

// ─── Sub-components ──────────────────────────

function Spinner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
      <div style={{ width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      Loading…
    </div>
  );
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div style={{ height: 24 }} />;
  const max = Math.max(...data) || 1;
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100, h = 24;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(" ");
  const area = `${pts[0].split(",")[0]},${h} ${line} ${w},${h}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: "100%", height: 24, marginTop: 6 }}>
      <polygon points={area} fill={color} opacity="0.12" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function MetricCard({ label, value, color, badge, highlight, spark }: { label: string; value: number | string; color: string; badge: string; highlight?: boolean; spark?: number[] }) {
  return (
    <div style={{
      background: highlight ? "var(--card2)" : "var(--card)",
      border: highlight ? "1px solid var(--border2)" : "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "14px 16px", position: "relative", overflow: "hidden", animation: "fadeIn 0.3s ease",
    }}>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: color }} />
      <div
  style={{
    fontSize: 18,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.09em",
    color: "#d9b48a",
    marginBottom: 10,
  }}
>
  {label}
</div>
      <div style={{
        fontSize: highlight ? 30 : 26,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        fontVariantNumeric: "tabular-nums",
        lineHeight: 1,
        color: highlight ? "#ffffff" : "var(--text)",
        textShadow: highlight ? "0 0 18px rgba(255,255,255,0.18)" : "none",
      }}>{value}</div>
      {spark && spark.length > 1 && <Sparkline data={spark} color={color === "var(--green)" ? "#8fae6b" : color === "var(--blue)" ? "#8aa6a3" : color === "var(--amber)" ? "#d9a441" : "#c98a4b"} />}
      <div style={{
        display: "inline-flex", alignItems: "center", gap: 4, fontSize: 10, marginTop: 6,
        padding: "2px 6px", borderRadius: 4,
        background: color === "var(--green)" ? "rgba(143,174,107,0.14)" : color === "var(--blue)" ? "rgba(138,166,163,0.14)" : "rgba(201,138,75,0.14)",
        color: color,
      }}>● {badge} </div>
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
function PremiumVerticalBarGraph({
  items,
  compact = false,
}: {
  items: BarItem[];
  compact?: boolean;
}) {
  if (!items.length) {
    return (
      <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>
        No data yet
      </div>
    );
  }

  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  const max = Math.max(...items.map((item) => item.count)) || 1;

  const colors = ["#c98a4b", "#8fae6b", "#8aa6a3", "#d9a441", "#c4633f"];

  return (
    <div style={{ width: "100%", padding: "4px 8px 0" }}>
      <div
        style={{
          height: 230,
          display: "flex",
          alignItems: "flex-end",
          gap: 34,
          padding: "18px 34px 38px",
          borderLeft: "1px solid rgba(232,210,184,0.16)",
          borderBottom: "1px solid rgba(232,210,184,0.16)",
          background:
            "linear-gradient(to top, rgba(232,210,184,0.045) 1px, transparent 1px)",
          backgroundSize: "100% 46px",
        }}
      >
        {items.map((item, index) => {
          const percent = Math.round((item.count / total) * 100);
          const height = Math.max(26, Math.round((item.count / max) * 165));

          return (
            <div
              key={item.label}
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
                minWidth: 70,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#ffffff",
                  marginBottom: 8,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {item.count}
                <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 4 }}>
                  {percent}%
                </span>
              </div>

              <div
                style={{
                  width: 62,
                  height,
                  borderRadius: "7px 7px 2px 2px",
                  background: `linear-gradient(to top, ${colors[index % colors.length]}aa, ${
                    colors[index % colors.length]
                  })`,
                  boxShadow: "0 12px 24px rgba(0,0,0,0.35)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  transition: "height 0.6s ease",
                }}
              />

              <div
                style={{
                  marginTop: 13,
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--text)",
                  transform: "rotate(-35deg)",
                  transformOrigin: "top center",
                  whiteSpace: "nowrap",
                  width: 92,
                  textAlign: "right",
                }}
              >
                {item.label}
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          gap: 18,
          marginTop: 12,
          fontSize: 11,
          color: "var(--muted)",
        }}
      >
        <span>
          Total: <b style={{ color: "var(--text)" }}>{total}</b>
        </span>

        {items.map((item) => (
          <span key={item.label}>
            {item.label}: <b style={{ color: "var(--text)" }}>{item.count}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function Panel({ title, badge, children, style }: { title: string; badge?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
        <span style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>{title}</span>
        {badge && (
          <span style={{ fontSize: 18, padding: "4px 10px", borderRadius: 6, background: "rgba(34,211,160,0.12)", color: "var(--green)", border: "1px solid rgba(34,211,160,0.2)" }}>{badge}</span>
        )}
      </div>
      {children}
    </div>
  );
} 

function EventFeedItem({ e }: { e: EventRow }) {
  const dotColors: Record<string, string> = {
    page_view: "var(--accent)",
    product_view: "var(--pink)",
    scroll_depth_25: "var(--blue)",
    scroll_depth_50: "var(--blue)",
    scroll_depth_75: "var(--blue)",
    scroll_depth_100: "var(--blue)",
    button_click: "var(--amber)",
    add_to_cart: "var(--amber)",
    remove_from_cart: "var(--red)",
    checkout_started: "var(--blue)",
    checkout_open: "var(--blue)",
    checkout_exit: "var(--accent)",
    buy_now_click: "var(--green)",
    purchase: "var(--green)",
    session_end: "var(--dim)",
  };

  const color = dotColors[e.event_name] || "var(--pink)";

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "11px 0", borderBottom: "1px solid var(--border)", animation: "fadeIn 0.2s ease" }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", background: color, marginTop: 6, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: "var(--text)" }}>
          {e.event_name}
        </div>
        <div style={{ fontSize: 12, color: "#d9b48a", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {getEventLabel(e)}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
        {timeAgo(e.created_at)}
      </div>
    </div>
  );
}

interface LiveVisitor {
  visitor_id: string;
  current_session_id: string | null;
  last_seen_at: string | null;
  device_type?: string | null;
  browser?: string | null;
}
function LiveUserActivity({ visitors, selected, onSelect, events }: {
  visitors: LiveVisitor[]; selected: string | null;
  onSelect: (id: string) => void; events: EventRow[];
}) {
  const cur = visitors.find(v => v.visitor_id === selected);
  const dotColors: Record<string, string> = {
    page_view: "var(--accent)", heartbeat: "var(--dim)", add_to_cart: "var(--amber)",
    purchase: "var(--green)", checkout_started: "var(--blue)", product_view: "var(--pink)",
    button_click: "var(--amber)", session_end: "var(--red)",
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <select value={selected ?? ""} onChange={(e) => onSelect(e.target.value)}
          style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12 }}>
          {visitors.length === 0
            ? <option value="">No users online</option>
            : visitors.map(v => (
              <option key={v.visitor_id} value={v.visitor_id}>
                {shortId(v.visitor_id)} · {v.device_type || "?"} · {v.browser || "?"}
              </option>
            ))}
        </select>
        <span style={{ fontSize: 10, color: "var(--muted)", whiteSpace: "nowrap" }}>{visitors.length} online</span>
      </div>

      {cur && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 11, color: "var(--muted)", marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
          <span>Session <b style={{ fontFamily: "monospace", color: "var(--text)" }}>{shortId(cur.current_session_id)}</b></span>
          <span>Last seen <b style={{ color: "var(--text)" }}>{cur.last_seen_at ? timeAgo(cur.last_seen_at) : "—"}</b></span>
        </div>
      )}

      <div style={{ maxHeight: 260, overflowY: "auto" }}>
        {(!cur || events.length === 0)
          ? <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>
              {visitors.length === 0 ? "Koi user abhi online nahi hai" : "Is user ke abhi events nahi"}
            </div>
          : events.map((e, i) => (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border)", animation: "fadeIn 0.2s ease" }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: dotColors[e.event_name] || "var(--pink)", marginTop: 5, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{e.event_name}</div>
                <div style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{getEventLabel(e)}</div>
              </div>
              <div style={{ fontSize: 10, color: "var(--dim)", whiteSpace: "nowrap", flexShrink: 0 }}>{timeAgo(e.created_at)}</div>
            </div>
          ))}
      </div>
    </div>
  );
}
function MetaAdsPanel({ stats }: { stats: { instagram: number; facebook: number; whatsapp: number; paid: number; organic: number } }) {
  const realTotal = stats.instagram + stats.facebook + stats.whatsapp;
  const isDemo = realTotal === 0;

  // Demo data — jab tak Meta connect nahi hota
  const demo = { instagram: 14, facebook: 9, whatsapp: 6 };
  const d = isDemo ? demo : stats;

  const rows = [
    { label: "Instagram", count: d.instagram, color: "#c98a4b" },
    { label: "Facebook",  count: d.facebook,  color: "#8fae6b" },
    { label: "WhatsApp",  count: d.whatsapp,  color: "#8aa6a3" },
  ];
  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...rows.map(r => r.count)) || 1;

  const barData = {
    labels: rows.map(r => r.label),
    datasets: [{
      data: rows.map(r => r.count),
      backgroundColor: rows.map(r => r.color),
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 52,
    }],
  };
  const barOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number } }) => {
            const pct = total ? Math.round((ctx.parsed.y / total) * 100) : 0;
            return ` ${ctx.parsed.y} sessions (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#a89280", font: { size: 11 } } },
      y: { grid: { color: "rgba(232,210,184,0.06)" }, ticks: { color: "#a89280", font: { size: 10 }, stepSize: 1 }, beginAtZero: true },
    },
  };

  return (
    <div>
      {isDemo && (
        <div style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, padding: "3px 8px", borderRadius: 4, background: "rgba(217,164,65,0.14)", color: "#d9a441", marginBottom: 10 }}>
          ● Sample data — Meta not connected yet
        </div>
      )}
      <div style={{ position: "relative", height: 200 }}>
        <Bar data={barData} options={barOptions as Parameters<typeof Bar>[0]["options"]} />
      </div>
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "center", gap: 18, fontSize: 11, color: "var(--muted)" }}>
        <span>Total: <b style={{ color: "var(--text)" }}>{total}</b></span>
        {rows.map(r => (
          <span key={r.label}>{r.label}: <b style={{ color: "var(--text)" }}>{r.count}</b></span>
        ))}
      </div>
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
  const [filterSession, setFilterSession] = useState("all");
  const [visStatus, setVisStatus]   = useState("all");
  const [visDevice, setVisDevice]   = useState("all");
  const [visSearch, setVisSearch]   = useState("");

  // Data states
  const [metrics, setMetrics]       = useState<Metrics>({ visitors:0, online:0, sessions:0, pageviews:0, events:0, atc:0, checkouts:0, purchases:0 });
  const [pvData, setPvData]         = useState<{ labels: string[]; values: number[] }>({ labels: [], values: [] });
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [nowCount, setNowCount]     = useState(0);
  const [nowPages, setNowPages]     = useState({ home: 0, product: 0, checkout: 0 });
  const [devices, setDevices]       = useState<BarItem[]>([]);
  const [browsers, setBrowsers]     = useState<BarItem[]>([]);
  const [metaStats, setMetaStats] = useState({ instagram: 0, facebook: 0, whatsapp: 0, paid: 0, organic: 0 });
  const [osData, setOsData]         = useState<BarItem[]>([]);
  const [eventFeed, setEventFeed]   = useState<EventRow[]>([]);
  const [liveVisitors, setLiveVisitors]           = useState<LiveVisitor[]>([]);
  const [selectedLiveVisitor, setSelectedLiveVisitor] = useState<string | null>(null);
  const [liveUserEvents, setLiveUserEvents]       = useState<EventRow[]>([]);
  const [sidebarStats, setSidebarStats] = useState({ online:0, visitors:0, sessions:0, events:0 });

  // Page-specific states
  const [visitors, setVisitors]     = useState<VisitorRow[]>([]);
  const [eventsTable, setEventsTable] = useState<EventRow[]>([]);
  const [funnelData, setFunnelData] = useState<{ name: string; count: number; color: string }[]>([]);
  const [pagesData, setPagesData]   = useState<{ path: string; views: number; visitors: number; events: number }[]>([]);
  const [sources, setSources]       = useState<{ sources: BarItem[]; mediums: BarItem[]; campaigns: BarItem[]; referrers: BarItem[] }>({ sources: [], mediums: [], campaigns: [], referrers: [] });
  const [scrollDepth, setScrollDepth] = useState<{ pct: string; count: number }[]>([]);

  const subRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const selectedSessionRef = useRef<string | null>(null);

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
     supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }).gte("last_seen_at", new Date(Date.now() - 3 * 60 * 1000).toISOString()),
    supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }),
     supabase.from("analytics_sessions").select("session_id", { count: "exact", head: true }).eq("is_active", true).gt("last_seen_at", new Date(Date.now() - 90 * 1000).toISOString()),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).gte("created_at", rangeStart(range)),
    ]);
    setSidebarStats({ online: on.count ?? 0, visitors: vis.count ?? 0, sessions: ses.count ?? 0, events: ev.count ?? 0 });
  }, [range]);

  // ── METRICS ──
  const loadMetrics = useCallback(async () => {
    const since = rangeStart(range);
    const [v, on, s, pv, ev, atc, co, pur] = await Promise.all([
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }).gte("last_seen_at", since),
     supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }).gte("last_seen_at", new Date(Date.now() - 3 * 60 * 1000).toISOString()),
    supabase
  .from("analytics_sessions")
  .select("session_id", { count: "exact", head: true })
  .eq("is_active", true)
  .gt("last_seen_at", new Date(Date.now() - 90 * 1000).toISOString()),
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
   // ── SPARKLINES (7-day daily trend per metric) ──
  const loadSparks = useCallback(async () => {
    const since = new Date(); since.setDate(since.getDate() - 6); since.setHours(0, 0, 0, 0);
    const { data } = await supabase
      .from("analytics_events")
      .select("event_name, created_at")
      .gte("created_at", since.toISOString());
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      days.push(d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }));
    }
    const blank = () => days.reduce((o, k) => ({ ...o, [k]: 0 }), {} as Record<string, number>);
    const pv = blank(), ev = blank(), atc = blank(), co = blank(), pur = blank();
    (data || []).forEach(e => {
      const k = new Date(e.created_at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
      if (!(k in ev)) return;
      ev[k]++;
      if (e.event_name === "page_view") pv[k]++;
      else if (e.event_name === "add_to_cart") atc[k]++;
      else if (e.event_name === "checkout_started") co[k]++;
      else if (e.event_name.startsWith("purchase")) pur[k]++;
    });
    setSparks({
      pageviews: Object.values(pv),
      events: Object.values(ev),
      atc: Object.values(atc),
      checkouts: Object.values(co),
      purchases: Object.values(pur),
    });
  }, []);

  // ── DEVICES + BROWSERS ──
  const loadDevicesBrowsers = useCallback(async () => {
    const { data } = await supabase.from("analytics_sessions").select("device_type, browser, os").gte("last_seen_at", rangeStart(range));
    const dMap: Record<string, number> = {}, bMap: Record<string, number> = {}, oMap: Record<string, number> = {};
    (data || []).forEach(s => {
      const dt = s.device_type || "Unknown"; dMap[dt] = (dMap[dt] || 0) + 1;
      const br = s.browser || "Unknown";    bMap[br] = (bMap[br] || 0) + 1;
      const o = s.os || "Unknown";          oMap[o] = (oMap[o] || 0) + 1;
    });
    setDevices(toBarArr(dMap));
    setBrowsers(toBarArr(bMap));
    setOsData(toBarArr(oMap));
  }, [range]);

  // ── RIGHT NOW ──
  const loadRightNow = useCallback(async () => {
    const { data: online } = await supabase.from("analytics_visitors").select("current_session_id").gte("last_seen_at", new Date(Date.now() - 3 * 60 * 1000).toISOString());
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
      .select("event_name, page_path, page_url, created_at, session_id, metadata")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(40);
    setEventFeed(data || []);
  }, [range]);
// ── LIVE USERS (online, selectable) ──
  const loadLiveUsers = useCallback(async () => {
    const cutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("analytics_visitors")
      .select("visitor_id, current_session_id, last_seen_at")
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
      .limit(20);
    if (!data) return;
    const sids = Array.from(new Set(data.map(v => v.current_session_id).filter(Boolean))) as string[];
    const sMap: Record<string, { device_type?: string; browser?: string }> = {};
    if (sids.length) {
      const { data: sd } = await supabase.from("analytics_sessions").select("session_id, device_type, browser").in("session_id", sids);
      (sd || []).forEach(s => { sMap[s.session_id] = s; });
    }
    const merged = data.map(v => ({ ...v, ...(sMap[v.current_session_id || ""] || {}) }));
    setLiveVisitors(merged);
    setSelectedLiveVisitor(prev => (prev && merged.some(v => v.visitor_id === prev)) ? prev : (merged[0]?.visitor_id ?? null));
  }, []);

  // ── EK LIVE USER KI ACTIVITY ──
  const loadLiveUserActivity = useCallback(async (visitorId: string | null) => {
    const v = liveVisitors.find(x => x.visitor_id === visitorId);
    const sid = v?.current_session_id;
    if (!sid) { setLiveUserEvents([]); return; }
    const { data } = await supabase
      .from("analytics_events")
      .select("event_name, page_path, created_at, session_id, metadata")
      .eq("session_id", sid)
      .order("created_at", { ascending: false })
      .limit(30);
    setLiveUserEvents(data || []);
  }, [liveVisitors]);
  // ── VISITORS ──
  // FIX: was missing `first_seen_at` in the select, so the "First Seen"
  // column in the table always rendered "—".
  const loadVisitors = useCallback(async () => {
    const { data } = await supabase.from("analytics_visitors").select("visitor_id, is_online, current_session_id, first_seen_at, last_seen_at, city, country").order("last_seen_at", { ascending: false }).limit(50);
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
    if (!data) { setEventsTable([]); return; }
    const sids = Array.from(new Set(data.map(e => e.session_id).filter(Boolean))) as string[];
    const dMap: Record<string, string | null> = {};
    if (sids.length) {
      const { data: sd } = await supabase.from("analytics_sessions").select("session_id, device_type").in("session_id", sids);
      (sd || []).forEach(s => { dMap[s.session_id] = s.device_type; });
    }
    setEventsTable(data.map(e => ({ ...e, device_type: dMap[e.session_id || ""] ?? null })));
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
      // ── META ADS TRAFFIC ──
  const loadMetaTraffic = useCallback(async () => {
    const { data } = await supabase
      .from("analytics_events")
      .select("metadata, session_id")
      .eq("event_name", "page_view")
      .gte("created_at", rangeStart(range));

    const seen = new Set<string>();
    const s = { instagram: 0, facebook: 0, whatsapp: 0, paid: 0, organic: 0 };

    (data || []).forEach((e) => {
      const sid = e.session_id || "";
      if (seen.has(sid)) return;
      const meta = e.metadata as Record<string, string | null> | null;
      const r = (meta?.referrer || "").toLowerCase();
      const u = (meta?.utm_source || "").toLowerCase();
      const m = (meta?.utm_medium || "").toLowerCase();

      let platform: "instagram" | "facebook" | "whatsapp" | null = null;
      if (u.includes("instagram") || r.includes("instagram")) platform = "instagram";
      else if (u.includes("whatsapp") || u === "wa" || r.includes("whatsapp")) platform = "whatsapp";
      else if (u.includes("facebook") || u === "fb" || r.includes("facebook") || r.includes("fb.com")) platform = "facebook";

      if (!platform) return;
      seen.add(sid);
      s[platform]++;
      if (m === "paid" || m === "cpc" || m === "ppc") s.paid++;
      else s.organic++;
    });

    setMetaStats(s);
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
        if (selectedSessionRef.current && e.session_id === selectedSessionRef.current) {
          setLiveUserEvents(prev => [e, ...prev].slice(0, 30));
        }
      })
      .subscribe();
  }, [loadSidebar, loadRightNow]);

  // ── LOAD ALL ──
 const loadAll = useCallback(async () => {
  setRefreshing(true);
  try {
    await Promise.all([loadMetrics(), loadPvChart(), loadDevicesBrowsers(), loadRightNow(), loadEventFeed(), loadSidebar(), loadMetaTraffic()]);
  } finally {
    setRefreshing(false);
  }
}, [loadMetrics, loadPvChart, loadDevicesBrowsers, loadRightNow, loadEventFeed, loadSidebar]);
  // ── INIT ──
  useEffect(() => {
    checkConn();
    loadAll();
    subscribe();
    loadLiveUsers();
    loadSparks();
    // FIX: poll also refreshes the event feed now, so the feed still moves
    // even if the realtime channel ever drops/reconnects.
    const t = setInterval(() => { loadMetrics(); loadRightNow(); loadSidebar(); loadEventFeed(); loadSparks(); }, 30000);
    return () => { clearInterval(t); if (subRef.current) supabase.removeChannel(subRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadAll(); }, [range, loadAll]);
   useEffect(() => {
    const v = liveVisitors.find(x => x.visitor_id === selectedLiveVisitor);
    selectedSessionRef.current = v?.current_session_id ?? null;
    loadLiveUserActivity(selectedLiveVisitor);
  }, [selectedLiveVisitor, liveVisitors, loadLiveUserActivity]);
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
    data: pvData.values,
    borderColor: "#8fae6b",
    backgroundColor: "rgba(143,174,107,0.22)",
    borderWidth: 2,
    pointRadius: 3,
    pointBackgroundColor: "#8fae6b",
    tension: 0.4,
    fill: true,
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
// ── Device Donut config ──
  const deviceTotal = devices.reduce((sum, d) => sum + d.count, 0);
  const donutColors = ["#c98a4b", "#8fae6b", "#8aa6a3", "#d9a441", "#c4633f"];
  const donutData = {
    labels: devices.map(d => d.label || "Unknown"),
    datasets: [{
      data: devices.map(d => d.count),
      backgroundColor: donutColors,
      borderColor: "var(--card)",
      borderWidth: 3,
      hoverOffset: 6,
    }],
  };
  const donutOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "68%",
    plugins: {
      legend: {
        position: "bottom" as const,
        labels: { color: "#a89280", font: { size: 11 }, padding: 12, usePointStyle: true, pointStyleWidth: 8 },
      },
      tooltip: {
        callbacks: {
          label: (ctx: { label: string; parsed: number }) => {
            const pct = deviceTotal ? Math.round(ctx.parsed / deviceTotal * 100) : 0;
            return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
          },
        },
      },
    },
  };
   // ── OS Bar chart config ──
  const osTotal = osData.reduce((sum, o) => sum + o.count, 0);
  const osBarData = {
    labels: osData.map(o => o.label || "Unknown"),
    datasets: [{
      data: osData.map(o => o.count),
      backgroundColor: osData.map((_, i) => BAR_COLORS[i % BAR_COLORS.length]),
      borderRadius: 6,
      borderSkipped: false,
      maxBarThickness: 48,
    }],
  };
  const osBarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number } }) => {
            const pct = osTotal ? Math.round(ctx.parsed.y / osTotal * 100) : 0;
            return ` ${ctx.parsed.y} (${pct}%)`;
          },
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#a89280", font: { size: 11 } } },
      y: { grid: { color: "rgba(232,210,184,0.06)" }, ticks: { color: "#a89280", font: { size: 10 }, stepSize: 1 }, beginAtZero: true },
    },
  };
  const funnelMax = Math.max(...funnelData.map(f => f.count)) || 1;
  const scrollMax = Math.max(...(scrollDepth.map(s => s.count))) || 1;
  // ── Scroll Gauge (average depth) ──
  const scrollTotal = scrollDepth.reduce((sum, s) => sum + s.count, 0);
  const avgScroll = scrollTotal
    ? Math.round(scrollDepth.reduce((sum, s) => sum + (parseInt(s.pct) * s.count), 0) / scrollTotal)
    : 0;
  const gaugeColor = avgScroll >= 75 ? "#8fae6b" : avgScroll >= 50 ? "#d9a441" : avgScroll >= 25 ? "#c98a4b" : "#c4633f";
  const gaugeData = {
    labels: ["Scrolled", "Remaining"],
    datasets: [{
      data: [avgScroll, 100 - avgScroll],
      backgroundColor: [gaugeColor, "var(--bg3)"],
      borderColor: "var(--card)",
      borderWidth: 2,
      circumference: 180,
      rotation: 270,
    }],
  };
  const gaugeOptions = {
    responsive: true,
    maintainAspectRatio: false,
    cutout: "72%",
    plugins: { legend: { display: false }, tooltip: { enabled: false } },
  };

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
              <MetricCard label="Page Views"        value={metrics.pageviews} color="var(--amber)"  badge="Live" spark={sparks.pageviews} />
              <MetricCard label="Total Events"      value={metrics.events}    color="var(--accent)" badge="Live" spark={sparks.events} />
              <MetricCard label="Add to Cart"       value={metrics.atc}       color="var(--amber)"  badge="Live" spark={sparks.atc} />
              <MetricCard label="Checkouts"         value={metrics.checkouts} color="var(--blue)"   badge="Live" spark={sparks.checkouts} />
              <MetricCard label="Purchases"         value={metrics.purchases} color="var(--green)"  badge="Live" spark={sparks.purchases} />
            </div>
             <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Panel title="Operating Systems">
                <PremiumVerticalBarGraph items={osData} compact />
              </Panel>
              <Panel title="Meta Ads Traffic">
    <div
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11,
      fontWeight: 800,
      padding: "4px 9px",
      borderRadius: 5,
      background: "rgba(217,164,65,0.14)",
      color: "#d9a441",
      marginBottom: 10,
    }}
  >
    ● Sample data — Meta not connected yet
  </div>

  <PremiumVerticalBarGraph
    items={[
      { label: "Instagram", count: metaStats.instagram || 0 },
      { label: "Facebook", count: metaStats.facebook || 0 },
      { label: "WhatsApp", count: metaStats.whatsapp || 0 },
    ]}
    compact
  />
</Panel>
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
                  {(() => {
                    const totalNow = nowPages.home + nowPages.product + nowPages.checkout;
                    const ringColors: Record<string, string> = { Homepage: "#c98a4b", Product: "#d9a441", Checkout: "#8fae6b" };
                    return ([["Homepage", nowPages.home], ["Product", nowPages.product], ["Checkout", nowPages.checkout]] as [string, number][]).map(([label, val]) => {
                      const pctVal = totalNow ? Math.round((val / totalNow) * 100) : 0;
                      const color = ringColors[label];
                      const r = 26, circ = 2 * Math.PI * r;
                      const dash = (pctVal / 100) * circ;
                      return (
                        <div key={label} style={{ background: "var(--bg3)", borderRadius: "var(--radius-sm)", padding: "12px 8px", textAlign: "center", border: "1px solid var(--border)" }}>
                          <div style={{ position: "relative", width: 64, height: 64, margin: "0 auto" }}>
                            <svg width="64" height="64" viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
                              <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
                              <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
                                strokeLinecap="round"
                                strokeDasharray={`${dash} ${circ - dash}`}
                                style={{ transition: "stroke-dasharray 0.8s ease" }} />
                            </svg>
                            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <span style={{ fontSize: 15, fontWeight: 800, color: "var(--text)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{pctVal}%</span>
                            </div>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 700, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>{val}</div>
                          <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>{label}</div>
                        </div>
                      );
                    });
                  })()}
                </div>
              </Panel>
            </div>
                 
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 2fr", gap: 14 }}>
          <Panel title="Device Split">
                {devices.length === 0
                  ? <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>No data yet</div>
                  : <div style={{ position: "relative", height: 200 }}>
                      <Doughnut data={donutData} options={donutOptions as Parameters<typeof Doughnut>[0]["options"]} />
                      <div style={{ position: "absolute", top: "38%", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
                        <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{deviceTotal}</div>
                        <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>Total</div>
                      </div>
                    </div>}
              </Panel>

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
              {funnelData.length === 0 ? <Spinner /> : (() => {
                const top = funnelData[0]?.count || 1;
                const overall = funnelData.length ? Math.round((funnelData[funnelData.length - 1].count / top) * 100) : 0;
                let biggestLeak = "—", maxDrop = -1;
                for (let i = 1; i < funnelData.length; i++) {
                  const prev = funnelData[i - 1].count || 1;
                  const drop = Math.round((1 - funnelData[i].count / prev) * 100);
                  if (drop > maxDrop) { maxDrop = drop; biggestLeak = `${funnelData[i - 1].name.split(" ")[0]} → ${funnelData[i].name.split(" ")[0]}`; }
                }
                return <>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", padding: "8px 0" }}>
                    {funnelData.map((step, i) => {
                      const convPct = i === 0 ? 100 : top ? Math.round(step.count / top * 100) : 0;
                      const inset = i * 13;
                      const taper = 6 + i * 6;
                      const pctColor = convPct >= 75 ? "#8fae6b" : convPct >= 40 ? "#d9a441" : convPct >= 15 ? "#c98a4b" : "#c4633f";
                      const osTotalSessions = osData.reduce((sum, item) => sum + item.count, 0);
                      const topOperatingSystem = osData.length? [...osData].sort((a, b) => b.count - a.count)[0]: null;
                      const topOperatingSystemPercent =topOperatingSystem && osTotalSessions? Math.round((topOperatingSystem.count / osTotalSessions) * 100): 0;
                     
                      return (
                        <div key={step.name} style={{ width: "100%" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                            <div style={{ width: 90, textAlign: "right", fontSize: 12, color: "var(--muted)" }}>{step.name}</div>
                            <div style={{ flex: 1, position: "relative", height: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
                              <div style={{ position: "absolute", left: `${inset}%`, right: `${inset}%`, height: "100%", background: step.color, borderRadius: 6, clipPath: `polygon(0 0, 100% 0, ${100 - taper}% 100%, ${taper}% 100%)` }} />
                              <span style={{ position: "relative", color: "#fff", fontWeight: 700, fontSize: 15, zIndex: 1 }}>{step.count}</span>
                            </div>
                            <div style={{ width: 70, textAlign: "left" }}>
                              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{step.count}</div>
                              <div style={{ fontSize: 10, color: pctColor }}>{convPct}%</div>
                            </div>
                          </div>
                          {i < funnelData.length - 1 && <div style={{ textAlign: "center", color: "var(--dim)", fontSize: 10, margin: "2px 0" }}>▼</div>}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-around" }}>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--green)" }}>{overall}%</div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Overall Conv.</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 18, fontWeight: 700, color: "var(--red)" }}>-{100 - overall}%</div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Total Drop-off</div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--amber)" }}>{biggestLeak}</div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>Biggest Leak</div>
                    </div>
                  </div>
                </>;
              })()}
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
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                <select value={visStatus} onChange={(e) => setVisStatus(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12 }}>
                  <option value="all">All status</option>
                  <option value="online">Online</option>
                  <option value="offline">Offline</option>
                </select>
                <select value={visDevice} onChange={(e) => setVisDevice(e.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12 }}>
                  <option value="all">All devices</option>
                  {Array.from(new Set(visitors.map((v) => v.device_type).filter(Boolean))).map((d) => (
                    <option key={d as string} value={d as string}>{d}</option>
                  ))}
                </select>
                <input value={visSearch} onChange={(e) => setVisSearch(e.target.value)}
                  placeholder="Search city / country / browser..."
                  style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12, flex: 1, minWidth: 160 }} />
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr>{["Visitor ID", "Status", "Device", "Browser", "OS", "City", "Country", "First Seen", "Last Seen"].map(h => (
                      <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody>
                    {visitors.length === 0
                      ? <tr><td colSpan={9}><div style={{ padding: 24 }}><Spinner /></div></td></tr>
                      : visitors.filter(v => {
                        const live = v.last_seen_at ? (Date.now() - new Date(v.last_seen_at).getTime()) < 3 * 60 * 1000 : false;
                        const matchStatus = visStatus === "all" || (visStatus === "online" ? live : !live);
                        const matchDevice = visDevice === "all" || v.device_type === visDevice;
                        const q = visSearch.toLowerCase();
                        const matchSearch = !q || v.city?.toLowerCase().includes(q) || v.country?.toLowerCase().includes(q) || v.browser?.toLowerCase().includes(q) || v.os?.toLowerCase().includes(q);
                        return matchStatus && matchDevice && matchSearch;
                      }).map(v => {
                        const dt = v.device_type || "unknown";
                        const deviceColors: Record<string, string> = { mobile: "var(--blue)", desktop: "var(--accent)", tablet: "var(--amber)", unknown: "var(--muted)" };
                        return (
                          <tr key={v.visitor_id} style={{ borderBottom: "1px solid var(--border)" }}>
                            <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11 }}>{shortId(v.visitor_id)}</td>
                            <td style={{ padding: "9px 12px" }}>
                             {(() => {
                                const live = v.last_seen_at ? (Date.now() - new Date(v.last_seen_at).getTime()) < 3 * 60 * 1000 : false;
                                return <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: live ? "rgba(34,211,160,0.15)" : "rgba(107,107,128,0.15)", color: live ? "var(--green)" : "var(--muted)" }}>{live ? "Online" : "Offline"}</span>;
                              })()}
                              
                            </td>
                            <td style={{ padding: "9px 12px" }}>
                              <span style={{ padding: "2px 7px", borderRadius: 4, fontSize: 10, fontWeight: 600, background: `${deviceColors[dt]}22`, color: deviceColors[dt] }}>{dt}</span>
                            </td>
                            <td style={{ padding: "9px 12px" }}>{v.browser || "—"}</td>
                            <td style={{ padding: "9px 12px" }}>{v.os || "—"}</td>
                            <td style={{ padding: "9px 12px" }}>{v.city || "—"}</td>
                            <td style={{ padding: "9px 12px" }}>{v.country || "—"}</td>
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
                  <select value={filterSession} onChange={(ev) => setFilterSession(ev.target.value)}
                  style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12, maxWidth: 200 }}>
                  <option value="all">All sessions</option>
                  {Array.from(new Set(eventsTable.map((e) => e.session_id).filter(Boolean))).map((sid) => (
                    <option key={sid as string} value={sid as string}>{shortId(sid as string)}</option>
                  ))}
                </select>
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
                        const matchSession = filterSession === "all" || e.session_id === filterSession;
                        const q = filterSearch.toLowerCase();
                        const matchSearch = !q || e.event_name?.toLowerCase().includes(q) || e.page_path?.toLowerCase().includes(q) || e.session_id?.toLowerCase().includes(q);
                        return matchEvent && matchSession && matchSearch;
                      }).sort((a, b) => filterSession === "all" ? 0 : new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
                      .map((e, i) => (
                        
                        <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                          <td style={{ padding: "9px 12px" }}>{e.event_name}</td>
                          <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{e.page_path || "—"}</td>
                          <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{e.device_type || "—"}</td>
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
                  <div style={{ position: "relative", height: 150, marginBottom: 20 }}>
                    <Doughnut data={gaugeData} options={gaugeOptions as Parameters<typeof Doughnut>[0]["options"]} />
                    <div style={{ position: "absolute", top: "55%", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
                      <div style={{ fontSize: 34, fontWeight: 800, color: gaugeColor, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{avgScroll}%</div>
                      <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>Avg Scroll Depth</div>
                    </div>
                  </div>
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
