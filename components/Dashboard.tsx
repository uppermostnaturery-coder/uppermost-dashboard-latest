"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  Home,
  Activity,
  Users,
  Filter,
  Link2,
  ScrollText,
  Mail,
  BarChart3,
  Settings,
  Infinity,
  Funnel,
  Monitor,
  Smartphone,
  Tablet,
  CircleHelp,
  Eye,
  Heart,
  MessageCircle,
  Share2,
  MousePointerClick,
  Bookmark,
} from "lucide-react";

import LemlistAnalytics from "./LemlistAnalytics";
import BrevoAnalytics from "./BrevoAnalytics";
import { supabase } from "@/lib/supabase";

// Local range helpers (restore previous behavior before the global cutoff)
function rangeStart(days: number) {
  // IST (India) calendar-day boundaries
  const IST_OFFSET = 5.5 * 60 * 60 * 1000; // IST = UTC + 5:30

  // current IST time
  const nowIST = new Date(Date.now() + IST_OFFSET);

  // IST midnight for today
  const istMidnight = new Date(nowIST);
  istMidnight.setUTCHours(0, 0, 0, 0);

  // go back `days - 1`
  istMidnight.setUTCDate(istMidnight.getUTCDate() - (days - 1));

  // convert back to UTC ISO for DB (DB stores UTC)
  return new Date(istMidnight.getTime() - IST_OFFSET).toISOString();
}

function selectedRangeStartIso(range: number): string {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;

  if (range === 1) {
    const nowIST = new Date(Date.now() + IST_OFFSET);
    const istMidnight = new Date(nowIST);
    istMidnight.setUTCHours(0, 0, 0, 0);
    return new Date(istMidnight.getTime() - IST_OFFSET).toISOString();
  }

  if (range === 2) {
    return new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  }

  // For 7/30/90 align to IST midnight of (today - (range-1))
  const nowIST2 = new Date(Date.now() + IST_OFFSET);
  const istMid = new Date(nowIST2);
  istMid.setUTCHours(0, 0, 0, 0);
  istMid.setUTCDate(istMid.getUTCDate() - (range - 1));
  return new Date(istMid.getTime() - IST_OFFSET).toISOString();
}
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
import {
  SiGooglechrome,
  SiSafari,
  SiInstagram,
  SiFacebook,
  SiMicrosoftedge,
  SiFirefoxbrowser,
  SiOpera,
  SiBrave,
  SiApple,
  SiWindows,
  SiAndroid,
} from "react-icons/si";
import { FiMoreHorizontal, FiGlobe } from 'react-icons/fi';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Filler, Tooltip, Legend);

// ─── Types ───────────────────────────────────
type Page = "overview" | "realtime" | "funnel" | "pages" | "visitors" | "events" | "sources" | "scrolldepth" | "lemlist" | "metaAds" | "brevo" |"graphs"; 

interface Metrics {
  visitors: number;
  newVisitors: number;
  returningUniqueVisitors: number;
  online: number;
  sessions: number;
  pageviews: number;
  events: number;
  atc: number;
  checkouts: number;
  purchases: number;
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
// rangeStart helper restored to compute selected range start in IST.

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
function IconTextCell({
  icon,
  label,
  muted = false,
}: {
  icon: React.ReactNode;
  label?: string | null;
  muted?: boolean;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        color: muted ? "var(--muted)" : "var(--text)",
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </span>
      <span>{label || "—"}</span>
    </span>
  );
}

function DeviceCell({ value, muted = false }: { value?: string | null; muted?: boolean }) {
  const s = (value || "").toLowerCase();

  if (s.includes("desktop")) {
    return <IconTextCell muted={muted} icon={<Monitor size={17} color="#d9c4ad" />} label="Desktop" />;
  }

  if (s.includes("mobile")) {
    return <IconTextCell muted={muted} icon={<Smartphone size={17} color="#d9c4ad" />} label="Mobile" />;
  }

  if (s.includes("tablet")) {
    return <IconTextCell muted={muted} icon={<Tablet size={17} color="#d9c4ad" />} label="Tablet" />;
  }

  return <IconTextCell muted={muted} icon={<CircleHelp size={17} color="#a89280" />} label={value || "—"} />;
}

function BrowserCell({ value }: { value?: string | null }) {
  const s = (value || "").toLowerCase();

  if (s.includes("chrome")) {
    return <IconTextCell icon={<SiGooglechrome size={20} color="#4285F4" />} label="Chrome" />;
  }

  if (s.includes("safari")) {
    return <IconTextCell icon={<SiSafari size={20} color="#0A84FF" />} label="Safari" />;
  }

  if (s.includes("edge")) {
    return <IconTextCell icon={<SiMicrosoftedge size={20} color="#0AA0F6" />} label="Edge" />;
  }

  if (s.includes("firefox")) {
    return <IconTextCell icon={<SiFirefoxbrowser size={20} color="#FF7139" />} label="Firefox" />;
  }

  if (s.includes("opera")) {
    return <IconTextCell icon={<SiOpera size={20} color="#FF1B2D" />} label="Opera" />;
  }

  if (s.includes("brave")) {
    return <IconTextCell icon={<SiBrave size={20} color="#FB542B" />} label="Brave" />;
  }

  return <IconTextCell icon={<CircleHelp size={17} color="#a89280" />} label={value || "—"} />;
}

function OSCell({ value }: { value?: string | null }) {
  const s = (value || "").toLowerCase();

  if (s.includes("mac") || s.includes("ios")) {
    return <IconTextCell icon={<SiApple size={20} color="#f4eadf" />} label="MacOS" />;
  }

  if (s.includes("windows")) {
    return <IconTextCell icon={<SiWindows size={20} color="#d9d9d9" />} label="Windows" />;
  }

  if (s.includes("android")) {
    return <IconTextCell icon={<SiAndroid size={20} color="#9bd36a" />} label="Android" />;
  }

  return <IconTextCell icon={<CircleHelp size={17} color="#d9c4ad" />} label={value || "Other"} />;
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
function MetricCard({
  label,
  value,
  color,
  badge,
  highlight,
  spark,
  icon,
}: {
  label: string;
  value: number | string;
  color: string;
  badge: string;
  highlight?: boolean;
  spark?: number[];
  icon?: React.ReactNode;
}) {
  return (
    <div style={{
      width: "100%",
      maxWidth: "100%",
      minWidth: 0,
      boxSizing: "border-box",
      background: highlight ? "var(--card2)" : "var(--card)",
      border: highlight ? "1px solid var(--border2)" : "1px solid var(--border)",
      borderRadius: "var(--radius)",
      minHeight: 190,
padding: "18px 20px",position: "relative",overflow: "hidden",animation: "fadeIn 0.3s ease",
    }}>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: color }} />

      <div
       style={{
  minHeight: 64,
  lineHeight: 1.12,
  fontSize: label.length > 18 ? 15 : 17,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  color: "#d9b48a",
  marginBottom: 12,
  paddingRight: icon ? 46 : 0,
}}
      >
        <span
  style={{
    minWidth: 0,
    overflowWrap: "break-word",
    wordBreak: "normal",
  }}
>
  {label}
</span>

      
      </div>
      {icon && (
  <span
    style={{
      position: "absolute",
      top: 18,
      right: 18,
      width: 34,
      height: 34,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 8,
      background: "rgba(255,255,255,0.04)",
      border: "1px solid var(--border)",
    }}
  >
    {icon}
  </span>
)}

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

function BrowserStats({ items }: { items: BarItem[] }) {
  const total = items.reduce((sum, item) => sum + item.count, 0) || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.8fr 0.8fr 0.8fr", gap: 12, fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 6px" }}>
        <span>Browser</span>
        <span style={{ textAlign: "right" }}>Sessions</span>
        <span style={{ textAlign: "right" }}>% of total</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((item, i) => {
          const pct = Math.round((item.count / total) * 100);
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <div key={item.label} style={{ display: "grid", gridTemplateColumns: "1.8fr 0.8fr 0.8fr", gap: 12, alignItems: "center", padding: "10px 6px", borderRadius: 12, background: "rgba(255,255,255,0.02)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, display: "inline-block" }} />
                <span>{item.label || "Unknown"}</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{item.count}</div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                <div style={{ width: "100%", maxWidth: 180, height: 6, background: "var(--bg3)", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, transition: "width 0.4s ease" }} />
                </div>
                <div style={{ fontSize: 10, color: "var(--muted)" }}>{pct}%</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BrowserAnalyticsTable({ items }: { items: BarItem[] }) {
  if (!items || items.length === 0) return <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>No data yet</div>;

  const rows = [...items].sort((a, b) => {
  const aLabel = (a.label || "").toLowerCase();
  const bLabel = (b.label || "").toLowerCase();

  const aIsOther = aLabel === "other" || aLabel === "unknown";
  const bIsOther = bLabel === "other" || bLabel === "unknown";

  if (aIsOther && !bIsOther) return 1;
  if (!aIsOther && bIsOther) return -1;

  return b.count - a.count;
});
  const total = rows.reduce((s, r) => s + r.count, 0) || 1;
  const max = Math.max(...rows.map(r => r.count)) || 1;

  const formatCount = (n: number) => n.toLocaleString();
  const formatPct = (n: number) => ((n / total) * 100).toFixed(1) + "%";

  const iconFor = (label: string) => {
    const s = (label || "").toLowerCase();
    if (s.includes("chrome")) return <SiGooglechrome size={14} color="#4285F4" />;
    if (s.includes("safari")) return <SiSafari size={14} color="#0A84FF" />;
    if (s.includes("instagram")) return <SiInstagram size={14} color="#E4405F" />;
    if (s.includes("edge")) return <SiMicrosoftedge size={14} color="#0AA0F6" />;
    if (s.includes("firefox")) return <SiFirefoxbrowser size={14} color="#FF7139" />;
    if (s.includes("opera")) return <SiOpera size={14} color="#8B8B83" />;
    if (s.includes("brave")) return <SiBrave size={14} color="#8B8B83" />;
    if (s.includes("samsung")) return <FiGlobe size={14} color="#8B8B83" />;
    return <FiMoreHorizontal size={14} color="#8B8B83" />;
  };

  const barColorFor = (label: string) => {
    const s = (label || "").toLowerCase();
    if (s.includes("chrome")) return "#8FA66A";
    if (s.includes("safari")) return "#C8A25A";
    if (s.includes("instagram")) return "#7189AF";
    if (s.includes("edge")) return "#86A174";
    if (s.includes("firefox")) return "#77766D";
    return "#696961";
  };

  const roundMax = (v: number) => {
    if (v >= 1000) {
      const step = Math.pow(10, Math.max(2, Math.floor(Math.log10(v)) - 2));
      return Math.ceil(v / step) * step;
    }
    if (v >= 100) return Math.ceil(v / 10) * 10;
    return v;
  };

  const maxRounded = roundMax(max);
  const ticks = [0, Math.round(maxRounded / 3), Math.round((2 * maxRounded) / 3), maxRounded];

  const fmtTick = (n: number) => {
    if (n >= 1000) return (Math.round((n / 100) ) / 10) + "K";
    return String(n);
  };

  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 2fr 0.7fr 0.7fr", gap: 12, fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", padding: "0 6px" }}>
        <span>Browser</span>
        <span style={{ textAlign: "left" }}>Horizontal Graph</span>
        <span style={{ textAlign: "right" }}>Sessions</span>
        <span style={{ textAlign: "right" }}>% of total</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((r) => {
          const widthPct = Math.round((r.count / max) * 100);
          return (
            <div key={r.label} style={{ display: "grid", gridTemplateColumns: "1.4fr 2fr 0.7fr 0.7fr", gap: 12, alignItems: "center", padding: "6px", height: 30 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text)", fontWeight: 600 }}>
                <div style={{ width: 18, display: "flex", alignItems: "center", justifyContent: "center" }}>{iconFor(r.label)}</div>
                <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.label || "Unknown"}</div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ width: "100%", height: 9, background: "var(--bg3)", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ width: `${widthPct}%`, height: "100%", background: barColorFor(r.label), borderRadius: 4, transition: "width 0.4s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)", padding: "0 2px" }}>
                  {ticks.map((t, i) => (
                    <div key={i} style={{ textAlign: i === ticks.length - 1 ? "right" : "left", flex: 1 }}>{fmtTick(t)}</div>
                  ))}
                </div>
              </div>

              <div style={{ fontSize: 12, color: "var(--text)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatCount(r.count)}</div>

              <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatPct(r.count)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OverviewFunnelKpi({ visitors, productViews, atc, checkouts, purchases }: { visitors: number; productViews: number; atc: number; checkouts: number; purchases: number; }) {
  const steps = [
    { label: "Visitors", value: visitors, pct: "100%", drop: "—" },
    {
  label: "Product Views",
  value: productViews,
  pct: visitors ? `${Math.round((productViews / visitors) * 100)}%` : "0%",
  drop: visitors ? `${Math.round((1 - productViews / visitors) * 100)}%` : "0%",
},
    {
      label: "Cart Adds",
      value: atc,
      pct: productViews ? `${Math.round((atc / productViews) * 100)}%` : "0%",
      drop: productViews ? `${Math.round((1 - atc / productViews) * 100)}%` : "0%",
    },
    {
      label: "Checkout",
      value: checkouts,
      pct: atc ? `${Math.round((checkouts / atc) * 100)}%` : "0%",
      drop: atc ? `${Math.round((1 - checkouts / atc) * 100)}%` : "0%",
    },
    {
      label: "Purchase",
      value: purchases,
      pct: checkouts ? `${Math.round((purchases / checkouts) * 100)}%` : "0%",
      drop: checkouts ? `${Math.round((1 - purchases / checkouts) * 100)}%` : "0%",
    },
  ];
  const overall = visitors ? `${Math.round((purchases / visitors) * 100)}%` : "0%";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.14em", color: "var(--muted)", textTransform: "uppercase" }}>Conversion Funnel</div>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", padding: "3px 8px", borderRadius: 999, border: "1px solid var(--border)" }}>Overview</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {steps.map((step, i) => {
          const stageWidths = [100, 82, 64, 48, 34];
          const colors = ["#c98a4b", "#8fae6b", "#8aa6a3", "#d9a441", "#c4633f"];
          const width = stageWidths[i];
          const color = colors[i];
          return (
            <div key={step.label} style={{ display: "grid", gridTemplateColumns: "1fr", gap: 10, alignItems: "center" }}>
              <div style={{ display: "flex", justifyContent: "center" }}>
                <div style={{ width: `${width}%`, minWidth: 0, maxWidth: "100%", position: "relative" }}>
                  <div style={{
                    clipPath: "polygon(0 0, 100% 0, 90% 100%, 10% 100%)",
                    background: color,
                    padding: "14px 14px",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 70,
                    color: "#fff",
                    borderRadius: 16,
                    boxShadow: "0 10px 18px rgba(0,0,0,0.18)",
                  }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.9)", textTransform: "uppercase", marginBottom: 4 }}>{step.label}</div>
                    <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1, color: "#fff" }}>{step.value}</div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.8)", marginTop: 4 }}>{step.pct} conversion</div>
                  </div>
                </div>
              </div>
            
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 12px", borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)" }}>
        <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.12em", color: "var(--muted)", fontWeight: 700 }}>Overall Conversion Rate</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--accent)" }}>{overall}</div>
      </div>
    </div>
  );
}

function CompactVerticalBarGraph({ items }: { items: BarItem[] }) {
  if (!items.length) {
    return <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>No data yet</div>;
  }

  const displayItems = items.slice(0, 5);
  const max = Math.max(...displayItems.map((item) => item.count)) || 1;

  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 12, minHeight: 150, padding: "4px 2px" }}>
      {displayItems.map((item, index) => {
        const pct = Math.round((item.count / max) * 100);
        const color = BAR_COLORS[index % BAR_COLORS.length];
        return (
          <div key={item.label} style={{ flex: 1, minWidth: 52, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{item.count}</div>
            <div style={{ width: "100%", height: 112, position: "relative", display: "flex", alignItems: "flex-end", background: "rgba(255,255,255,0.04)", borderRadius: 16, overflow: "hidden" }}>
              <div
                style={{
                  width: "100%",
                  height: `${pct}%`,
                  background: `linear-gradient(180deg, ${color}bb, ${color})`,
                  borderRadius: "16px 16px 0 0",
                  transition: "height 0.4s ease",
                }}
              />
              <div style={{ position: "absolute", top: 6, left: 0, right: 0, textAlign: "center", fontSize: 10, color: "var(--text)", fontWeight: 700 }}>
                {pct}%
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--text)", textAlign: "center", lineHeight: 1.2 }}>{item.label || "Unknown"}</div>
          </div>
        );
      })}
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
function CompactBarStrip({ items }: { items: BarItem[] }) {
  if (!items.length) {
    return (
      <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>
        No data yet
      </div>
    );
  }

  const labels = items.map((item) => item.label || "Unknown");

  const osIconFor = (label: string) => {
    const s = (label || "").toLowerCase();

    if (s.includes("mac") || s.includes("ios")) {
      return <SiApple size={16} color="#f4eadf" />;
    }

    if (s.includes("windows")) {
      return <SiWindows size={16} color="#d9d9d9" />;
    }

    if (s.includes("android")) {
      return <SiAndroid size={16} color="#9bd36a" />;
    }

    return <CircleHelp size={15} color="#a89280" />;
  };

  const chartData = {
    labels,
    datasets: [
      {
        label: "Base",
        data: items.map((item) => Math.round(item.count * 0.45)),
        backgroundColor: "#3764e8",
        borderRadius: 0,
        stack: "os",
      },
      {
        label: "Middle",
        data: items.map((item) => Math.round(item.count * 0.35)),
        backgroundColor: "#7892ff",
        borderRadius: 0,
        stack: "os",
      },
      {
        label: "Top",
        data: items.map((item) => Math.max(item.count - Math.round(item.count * 0.8), 0)),
        backgroundColor: "#e7e3ff",
        borderRadius: 4,
        stack: "os",
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          title: (items: any) => items[0]?.label || "",
          label: (ctx: any) => {
            const total = ctx.chart.data.datasets.reduce(
              (sum: number, dataset: any) => sum + Number(dataset.data[ctx.dataIndex] || 0),
              0
            );
            return `Total: ${total}`;
          },
        },
      },
    },
    scales: {
      x: {
        stacked: true,
        grid: { display: false },
        ticks: {
          display: false,
        },
      },
      y: {
        stacked: true,
        beginAtZero: true,
        grid: { color: "rgba(232,210,184,0.08)" },
        ticks: {
          color: "#a89280",
          font: { size: 10 },
        },
      },
    },
  };

  return (
    <div style={{ width: "100%" }}>
      <div style={{ height: 220, width: "100%" }}>
        <Bar
          data={chartData}
          options={chartOptions as Parameters<typeof Bar>[0]["options"]}
        />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
          gap: 8,
          marginLeft: 38,
          marginTop: -4,
          paddingRight: 8,
        }}
      >
        {items.map((item) => (
          <div
            key={item.label}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              minWidth: 0,
              color: "var(--text)",
              fontSize: 11,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {osIconFor(item.label)}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {item.label || "Unknown"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
function MetaPlatformGroupedChart({ stats }: { stats: any }) {
  const chartData = {
    labels: ["Facebook", "Instagram", "Messenger", "Audience Network"],
    datasets: [
      {
        label: "Clicks",
        data: [
          Number(stats.facebook || 0),
          Number(stats.instagram || 0),
          Number(stats.messenger || 0),
          Number(stats.audienceNetwork || 0),
        ],
        backgroundColor: "#35aeca",
        borderRadius: 4,
      },
      {
        label: "Leads",
        data: [
          Number(stats.facebookLeads || 0),
          Number(stats.instagramLeads || 0),
          Number(stats.messengerLeads || 0),
          Number(stats.audienceNetworkLeads || 0),
        ],
        backgroundColor: "#5f646b",
        borderRadius: 4,
      },
      {
        label: "Spend",
        data: [
          Number(stats.facebookSpend || 0),
          Number(stats.instagramSpend || 0),
          Number(stats.messengerSpend || 0),
          Number(stats.audienceNetworkSpend || 0),
        ],
        backgroundColor: "#38c2a0",
        borderRadius: 4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: true,
        labels: {
          color: "#c7b2a2",
          boxWidth: 10,
          font: { size: 11 },
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#f4eadf", font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(232,210,184,0.08)" },
        ticks: { color: "#b9a696", font: { size: 10 } },
      },
    },
  };

  return (
    <div style={{ height: 300, width: "100%" }}>
      <Bar
        data={chartData}
        options={chartOptions as Parameters<typeof Bar>[0]["options"]}
      />
    </div>
  );
}
function Panel({ title, badge, children, style }: { title: string; badge?: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: 16, ...style }}>
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
  const isDemo = false;

const d = stats;

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

function PlatformCard({
  title,
  reach,
  views,
  likes,
  comments,
  shares,
  clicks,
}: {
  title: string;
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  clicks: number;
}) {
  const isInstagram = title.toLowerCase().includes("instagram");

  const platformIcon = isInstagram ? (
    <SiInstagram size={22} color="#E4405F" />
  ) : (
    <SiFacebook size={22} color="#1877F2" />
  );

  const rows = [
    { label: "Reach", value: reach, icon: <Users size={16} color="#8fae6b" /> },
    { label: "Post Views", value: views, icon: <Eye size={16} color="#8aa6a3" /> },
    { label: "Likes", value: likes, icon: <Heart size={16} color="#e25575" /> },
    { label: "Comments", value: comments, icon: <MessageCircle size={16} color="#d9a441" /> },
    {
      label: isInstagram ? "Saves" : "Shares",
      value: shares,
      icon: isInstagram ? <Bookmark size={16} color="#c98a4b" /> : <Share2 size={16} color="#c98a4b" />,
    },
    { label: "Clicks", value: clicks, icon: <MousePointerClick size={16} color="#f4eadf" /> },
  ];

  return (
    <div
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "var(--text)",
          fontSize: 16,
          fontWeight: 800,
          marginBottom: 14,
        }}
      >
        <span
          style={{
            width: 28,
            height: 28,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
            border: "1px solid var(--border)",
          }}
        >
          {platformIcon}
        </span>
        <span>{title}</span>
      </div>

      {rows.map((row) => (
        <div
          key={row.label}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 0",
            borderBottom: "1px solid var(--border)",
            color: "var(--muted)",
            fontSize: 13,
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
            <span style={{ width: 18, display: "inline-flex", justifyContent: "center" }}>
              {row.icon}
            </span>
            <span>{row.label}</span>
          </span>

          <b style={{ color: "var(--text)" }}>
            {Number(row.value || 0).toLocaleString()}
          </b>
        </div>
      ))}
    </div>
  );
}
// Instagram post-level analytics section.
// It reads real post data from `metaStats.instagramPosts` when the API provides it.
// Until Instagram Graph API post insights are connected, it falls back to a clean empty row.

function InstagramPostPerformance({ stats }: { stats: any }) {
  type InstagramPostRow = {
    title?: string;
    caption?: string;
    type?: string;
    published?: string;
    createdAt?: string;
    views?: number;
    impressions?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    reposts?: number;
    saves?: number;
    reach?: number;
  };

  type InstagramPostTotals = {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    reposts: number;
    saves: number;
  };

  const posts: InstagramPostRow[] = Array.isArray(stats.instagramPosts)
    ? stats.instagramPosts
    : [];

  const totals: InstagramPostTotals =
    posts.length > 0
      ? posts.reduce<InstagramPostTotals>(
          (acc, post) => ({
            views: acc.views + Number(post.views || post.impressions || 0),
            likes: acc.likes + Number(post.likes || 0),
            comments: acc.comments + Number(post.comments || 0),
            shares: acc.shares + Number(post.shares || 0),
            reposts: acc.reposts + Number(post.reposts || 0),
            saves: acc.saves + Number(post.saves || 0),
          }),
          {
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            reposts: 0,
            saves: 0,
          }
        )
      : {
          views: Number(stats.instagramImpressions || 0),
          likes: Number(stats.instagramLikes || 0),
          comments: Number(stats.instagramComments || 0),
          shares: Number(stats.instagramShares || 0),
          reposts: Number(stats.instagramReposts || 0),
          saves: Number(stats.instagramSaves || 0),
        };

  const displayPosts =
    posts.length > 0
      ? posts
      : [
          {
            title: "No Instagram posts connected",
            type: "Connect Instagram Graph API",
            published: "-",
            views: 0,
            likes: 0,
            comments: 0,
            shares: 0,
            reposts: 0,
            saves: 0,
            reach: Number(stats.instagramReach || 0),
          },
        ];

  return (
    <Panel title="Instagram Post Performance" badge="Post Insights">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12, marginBottom: 16 }}>
        {[
          ["Total Views", totals.views, "var(--blue)"],
          ["Likes", totals.likes, "var(--pink)"],
          ["Comments", totals.comments, "var(--cyan)"],
          ["Shares", totals.shares, "var(--accent)"],
          ["Reposts", totals.reposts, "var(--orange)"],
          ["Saves", totals.saves, "var(--green)"],
        ].map(([label, value, color]) => (
          <div
            key={String(label)}
            style={{
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: 14,
              boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${String(color)} 22%, transparent)`,
            }}
          >
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {Number(value || 0).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(220px, 1.6fr) 120px 120px repeat(7, minmax(90px, 1fr))",
            minWidth: 1080,
            background: "var(--bg2)",
            color: "var(--muted)",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          {["Post", "Type", "Published", "Views", "Likes", "Comments", "Shares", "Reposts", "Saves", "Reach"].map((heading) => (
            <div key={heading} style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)" }}>
              {heading}
            </div>
          ))}
        </div>

        {displayPosts.map((post: any, index: number) => (
          <div
            key={`${post.title}-${index}`}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(220px, 1.6fr) 120px 120px repeat(7, minmax(90px, 1fr))",
              minWidth: 1080,
              color: "var(--text)",
              fontSize: 12,
              borderBottom: index === displayPosts.length - 1 ? "none" : "1px solid var(--border)",
            }}
          >
            <div style={{ padding: "12px 14px", fontWeight: 700 }}>{post.title || post.caption || "Instagram Post"}</div>
            <div style={{ padding: "12px 14px", color: "var(--muted)" }}>{post.type || "Post"}</div>
            <div style={{ padding: "12px 14px", color: "var(--muted)" }}>{post.published || post.createdAt || "-"}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.views || post.impressions || 0).toLocaleString()}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.likes || 0).toLocaleString()}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.comments || 0).toLocaleString()}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.shares || 0).toLocaleString()}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.reposts || 0).toLocaleString()}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.saves || 0).toLocaleString()}</div>
            <div style={{ padding: "12px 14px" }}>{Number(post.reach || 0).toLocaleString()}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 12, color: "var(--muted)", fontSize: 11 }}>
        Metrics are filtered by selected date range.
      </div>
    </Panel>
  );
}
// ══════════════════════════════════════════════
// MAIN DASHBOARD
// ══════════════════════════════════════════════
export default function Dashboard() {
  const [activePage, setActivePage] = useState<Page>("overview");
  const [range, setRange]           = useState(1); 
  type GraphView = "line" | "area" | "bar";
type GraphGroupBy = "auto" | "hour" | "day" | "week" | "month";

  const [graphView, setGraphView] = useState<GraphView>("line");
  const [graphGroupBy, setGraphGroupBy] = useState<GraphGroupBy>("auto");
  const resolvedGraphGroupBy: Exclude<GraphGroupBy, "auto"> =graphGroupBy === "auto"? range <= 2? "hour": range <= 30? "day": "week": graphGroupBy;
  const [connected, setConnected]   = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filterEvent, setFilterEvent] = useState("all");
  const [filterSearch, setFilterSearch] = useState("");
  const [filterSession, setFilterSession] = useState("all");
  const [visStatus, setVisStatus]   = useState("all");
  const [visDevice, setVisDevice]   = useState("all");
  const [visSearch, setVisSearch]   = useState("");
  const [rtVisitorType, setRtVisitorType] = useState("all");
  const [rtVisitorSearch, setRtVisitorSearch] = useState("");

  // Data states
  const [metrics, setMetrics] = useState<Metrics>({
  visitors: 0,
  newVisitors: 0,
  returningUniqueVisitors: 0,
  online: 0,
  sessions: 0,
  pageviews: 0,
  events: 0,
  atc: 0,
  checkouts: 0,
  purchases: 0,
});
const [metaAdsData, setMetaAdsData] = useState<any>(null);
const [metaAdsLoading, setMetaAdsLoading] = useState(false);
const [metaAdsError, setMetaAdsError] = useState<string | null>(null);
  const [pvData, setPvData]         = useState<{ labels: string[]; values: number[] }>({ labels: [], values: [] });
  const [productViewGraphData, setProductViewGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [addToCartGraphData, setAddToCartGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [checkoutGraphData, setCheckoutGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [purchaseGraphData, setPurchaseGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [buttonClickGraphData, setButtonClickGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [totalEventsGraphData, setTotalEventsGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [scroll25GraphData, setScroll25GraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [scroll50GraphData, setScroll50GraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [scroll75GraphData, setScroll75GraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [scroll100GraphData, setScroll100GraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: []});
  const [buyNowGraphData, setBuyNowGraphData] =useState<{ labels: string[]; values: number[] }>({labels: [],values: [],});
  const [sparks, setSparks] = useState<Record<string, number[]>>({});
  const [nowCount, setNowCount]     = useState(0);
  const [nowPages, setNowPages]     = useState({ home: 0, product: 0, checkout: 0 });
  const [productViews, setProductViews] = useState(0);
  const [devices, setDevices]       = useState<BarItem[]>([]);
  const [browsers, setBrowsers]     = useState<BarItem[]>([]);
  const [metaStats, setMetaStats] = useState({ spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0, cpc: 0, leads: 0, facebook: 0, instagram: 0, messenger: 0, audienceNetwork: 0, connected: false, error: "" });
  const [osData, setOsData]         = useState<BarItem[]>([]);
  const [eventFeed, setEventFeed]   = useState<EventRow[]>([]);
  const [liveVisitors, setLiveVisitors]           = useState<LiveVisitor[]>([]);
  const [selectedLiveVisitor, setSelectedLiveVisitor] = useState<string | null>(null);
  const [liveUserEvents, setLiveUserEvents]       = useState<EventRow[]>([]);
  const [sidebarStats, setSidebarStats] = useState({ online:0, visitors:0, sessions:0, events:0 });
const [brevoLeads, setBrevoLeads] = useState<number | null>(null);

// Page-specific states

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
   const countSelectedRangeVisitors = useCallback(async (since: string) => {
  const visitorEventCounts = new Map<string, number>();
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("analytics_events")
      .select("visitor_id")
      .gte("created_at", since)
      .not("visitor_id", "is", null)
      .range(from, from + pageSize - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    data.forEach((row) => {
      if (!row.visitor_id) return;

      visitorEventCounts.set(
        row.visitor_id,
        (visitorEventCounts.get(row.visitor_id) || 0) + 1
      );
    });

    if (data.length < pageSize) break;
  }

  const uniqueVisitors = visitorEventCounts.size;

  let returningUniqueVisitors = 0;

  visitorEventCounts.forEach((count) => {
    if (count > 1) {
      returningUniqueVisitors += 1;
    }
  });

  return {
    uniqueVisitors,
    newVisitors: Math.max(0, uniqueVisitors - returningUniqueVisitors),
    returningUniqueVisitors,
  };
}, []);
  // ── CONNECTION CHECK ──
  const checkConn = useCallback(async () => {
    try {
      const { error } = await supabase.from("analytics_events").select("event_name", { count: "exact", head: true });
      setConnected(!error);
    } catch { setConnected(false); }
  }, []);

  // ── SIDEBAR ──
  const loadSidebar = useCallback(async () => {
    const onlineCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const sessionCutoff = new Date(Date.now() - 90 * 1000).toISOString();
    const eventsSince = rangeStart(range);

    const [on, vis, ses, ev] = await Promise.all([
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }).gte("last_seen_at", onlineCutoff),
      supabase.from("analytics_visitors").select("visitor_id", { count: "exact", head: true }),
      supabase.from("analytics_sessions").select("session_id", { count: "exact", head: true }).eq("is_active", true).gt("last_seen_at", sessionCutoff),
      supabase.from("analytics_events").select("event_name", { count: "exact", head: true }).gte("created_at", eventsSince),
    ]);
    setSidebarStats({ online: on.count ?? 0, visitors: vis.count ?? 0, sessions: ses.count ?? 0, events: ev.count ?? 0 });
  }, [range]);

  // ── METRICS ──
  const loadMetrics = useCallback(async () => {
  const since = rangeStart(range);

  const [visitorBreakdown, on, s, pv, prod, ev, atc, co, pur] = await Promise.all([
    countSelectedRangeVisitors(since),
    supabase
      .from("analytics_visitors")
      .select("visitor_id", { count: "exact", head: true })
      .gte("last_seen_at", new Date(Date.now() - 3 * 60 * 1000).toISOString()),
    supabase
      .from("analytics_sessions")
      .select("session_id", { count: "exact", head: true })
      .eq("is_active", true)
      .gt("last_seen_at", new Date(Date.now() - 90 * 1000).toISOString()),
    supabase
      .from("analytics_events")
      .select("event_name", { count: "exact", head: true })
      .eq("event_name", "page_view")
      .gte("created_at", since),
    supabase
      .from("analytics_events")
      .select("event_name", { count: "exact", head: true })
      .eq("event_name", "product_view")
      .gte("created_at", since),
    supabase
      .from("analytics_events")
      .select("event_name", { count: "exact", head: true })
      .gte("created_at", since),
    supabase
      .from("analytics_events")
      .select("event_name", { count: "exact", head: true })
      .eq("event_name", "add_to_cart")
      .gte("created_at", since),
    supabase
      .from("analytics_events")
      .select("event_name", { count: "exact", head: true })
      .eq("event_name", "checkout_started")
      .gte("created_at", since),
    supabase
      .from("analytics_events")
      .select("event_name", { count: "exact", head: true })
      .ilike("event_name", "purchase%")
      .gte("created_at", since),
  ]);

  setMetrics({
    visitors: visitorBreakdown.uniqueVisitors,
    newVisitors: visitorBreakdown.newVisitors,
    returningUniqueVisitors: visitorBreakdown.returningUniqueVisitors,
    online: on.count ?? 0,
    sessions: s.count ?? 0,
    pageviews: pv.count ?? 0,
    events: ev.count ?? 0,
    atc: atc.count ?? 0,
    checkouts: co.count ?? 0,
    purchases: pur.count ?? 0,
  });

  setProductViews(prod.count ?? 0);
}, [range, countSelectedRangeVisitors]);


  // ── BREVO LEADS ──
const loadBrevoLeads = useCallback(async () => {
  try {
    const response = await fetch("/api/brevo/status?page=1&per_page=1", {
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error || "Unable to load Brevo leads");
    }

    const total = result?.data?.totalContacts;

    setBrevoLeads(typeof total === "number" ? total : null);
  } catch (error) {
    console.error("Brevo leads KPI error:", error);
    setBrevoLeads(null);
  }
}, []);

  // ── PAGE VIEW CHART ──
  const loadPvChart = useCallback(async () => {
    // Page Views chart: respect selected global `range`. Produce hourly buckets for 1d and 48h,
    // daily buckets for larger ranges.
    const sinceIso = rangeStart(range);
    const { data } = await supabase.from("analytics_events").select("created_at").eq("event_name", "page_view").gte("created_at", sinceIso).order("created_at", { ascending: true });

    const items = data || [];

    if (resolvedGraphGroupBy === "hour") {  
      // hourly buckets: for Today (since IST midnight) or last 48 hours
      const start = new Date(selectedRangeStartIso(range));
      const end = new Date();
      const hours = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (60 * 60 * 1000)));
      const labels: string[] = [];
      const counts: number[] = Array(hours).fill(0);

      for (let i = 0; i < hours; i++) {
        const d = new Date(start.getTime() + i * 60 * 60 * 1000);
        labels.push(d.toLocaleTimeString("en-IN", { hour: "2-digit", hour12: false }) + ":00");
      }

      items.forEach((e) => {
        const t = new Date(e.created_at).getTime();
        const idx = Math.floor((t - start.getTime()) / (60 * 60 * 1000));
        if (idx >= 0 && idx < counts.length) counts[idx]++;
      });

      setPvData({ labels, values: counts });
    } else {
  const start = new Date(selectedRangeStartIso(range));
  const end = new Date();

  const bucketMap: Record<string, number> = {};

  if (resolvedGraphGroupBy === "day") {
    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      bucketMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      if (key in bucketMap) {
        bucketMap[key]++;
      }
    });
  }

  if (resolvedGraphGroupBy === "week") {
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weeks = Math.max(
      1,
      Math.ceil((end.getTime() - start.getTime()) / weekMs)
    );

    for (let i = 0; i < weeks; i++) {
      const d = new Date(start.getTime() + i * weekMs);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      bucketMap[key] = 0;
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();
      const index = Math.floor((t - start.getTime()) / weekMs);

      if (index >= 0 && index < weeks) {
        const d = new Date(start.getTime() + index * weekMs);

        const key = d.toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
        });

        bucketMap[key]++;
      }
    });
  }

  if (resolvedGraphGroupBy === "month") {
    const cursor = new Date(start);

    cursor.setUTCDate(1);

    while (cursor <= end) {
      const key = cursor.toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      });

      bucketMap[key] = 0;
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString("en-IN", {
        month: "short",
        year: "numeric",
      });

      if (key in bucketMap) {
        bucketMap[key]++;
      }
    });
  }

  setPvData({
    labels: Object.keys(bucketMap),
    values: Object.values(bucketMap),
  });
}
 }, [range, resolvedGraphGroupBy]);
  // ── PRODUCT VIEW CHART ──
const loadProductViewChart = useCallback(async () => {
  const sinceIso = rangeStart(range);
 

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "product_view")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  // TODAY + 48H → hourly graph
  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setProductViewGraphData({
      labels,
      values: counts,
    });
  }

  // 7D / 30D / 90D → daily graph
  else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(
        e.created_at
      ).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setProductViewGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);

// ── ADD TO CART CHART ──
const loadAddToCartChart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "add_to_cart")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setAddToCartGraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setAddToCartGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
// ── CHECKOUT CHART ──
const loadCheckoutChart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "checkout_started")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setCheckoutGraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setCheckoutGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);

// ── PURCHASE CHART ──
const loadPurchaseChart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .ilike("event_name", "purchase%")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setPurchaseGraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setPurchaseGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
// ── BUTTON CLICK CHART ──
const loadButtonClickChart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "button_click")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setButtonClickGraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setButtonClickGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);  
// ── TOTAL EVENTS CHART ──
const loadTotalEventsChart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setTotalEventsGraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setTotalEventsGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
// ── SCROLL 25% CHART ──
const loadScroll25Chart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "scroll_depth_25")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setScroll25GraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setScroll25GraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
// ── SCROLL 50% CHART ──
const loadScroll50Chart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "scroll_depth_50")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setScroll50GraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setScroll50GraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);

// ── SCROLL 75% CHART ──
const loadScroll75Chart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "scroll_depth_75")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setScroll75GraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setScroll75GraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
// ── SCROLL 100% CHART ──
const loadScroll100Chart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "scroll_depth_100")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setScroll100GraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setScroll100GraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
// ── BUY NOW CLICK CHART ──
const loadBuyNowChart = useCallback(async () => {
  const sinceIso = rangeStart(range);

  const { data } = await supabase
    .from("analytics_events")
    .select("created_at")
    .eq("event_name", "buy_now_click")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: true });

  const items = data || [];

  if (range === 1 || range === 2) {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const hours = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (60 * 60 * 1000)
      )
    );

    const labels: string[] = [];
    const counts: number[] = Array(hours).fill(0);

    for (let i = 0; i < hours; i++) {
      const d = new Date(
        start.getTime() + i * 60 * 60 * 1000
      );

      labels.push(
        d.toLocaleTimeString("en-IN", {
          hour: "2-digit",
          hour12: false,
        }) + ":00"
      );
    }

    items.forEach((e) => {
      const t = new Date(e.created_at).getTime();

      const idx = Math.floor(
        (t - start.getTime()) /
          (60 * 60 * 1000)
      );

      if (idx >= 0 && idx < counts.length) {
        counts[idx]++;
      }
    });

    setBuyNowGraphData({
      labels,
      values: counts,
    });
  } else {
    const start = new Date(selectedRangeStartIso(range));
    const end = new Date();

    const days = Math.max(
      1,
      Math.ceil(
        (end.getTime() - start.getTime()) /
          (24 * 60 * 60 * 1000)
      )
    );

    const dayMap: Record<string, number> = {};

    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);

      const key = d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
      });

      dayMap[key] = 0;
    }

    items.forEach((e) => {
      const key = new Date(e.created_at).toLocaleDateString(
        "en-IN",
        {
          day: "2-digit",
          month: "short",
        }
      );

      if (key in dayMap) {
        dayMap[key]++;
      }
    });

    setBuyNowGraphData({
      labels: Object.keys(dayMap),
      values: Object.values(dayMap),
    });
  }
}, [range]);
  const pvHeading = (() => {
    switch (range) {
      case 1:
        return "PAGE VIEWS — TODAY";
      case 2:
        return "PAGE VIEWS — LAST 48 HOURS";
      case 7:
        return "PAGE VIEWS — LAST 7 DAYS";
      case 30:
        return "PAGE VIEWS — LAST 30 DAYS";
      case 90:
        return "PAGE VIEWS — LAST 90 DAYS";
      default:
        return `PAGE VIEWS — LAST ${range} DAYS`;
    }
  })();
   // ── SPARKLINES (7-day daily trend per metric) ──
  const loadSparks = useCallback(async () => {
    const sinceIso = rangeStart(7); // sparkline always shows last 7 days
    const { data } = await supabase
      .from("analytics_events")
      .select("event_name, created_at")
      .gte("created_at", sinceIso);
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
    const since = rangeStart(range);
    const { data } = await supabase.from("analytics_sessions").select("device_type, browser, os").gte("last_seen_at", since);
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
    const onlineCutoff = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const { data: online } = await supabase.from("analytics_visitors").select("current_session_id").gte("last_seen_at", onlineCutoff);
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
    const since = rangeStart(range);
    const { data } = await supabase
  .from("analytics_visitors")
  .select("visitor_id, is_online, current_session_id, first_seen_at, last_seen_at, city, country")
  .gte("last_seen_at", since)
  .order("last_seen_at", { ascending: false })
  .limit(100);
    if (!data) return;
    const sids = Array.from(new Set(data.map(v => v.current_session_id).filter(Boolean))) as string[];
    let sessionMap: Record<string, { device_type?: string; browser?: string; os?: string }> = {};
    if (sids.length) {
      const { data: sd } = await supabase.from("analytics_sessions").select("session_id, device_type, browser, os").in("session_id", sids);
      (sd || []).forEach(s => { sessionMap[s.session_id] = s; });
    }
    setVisitors(data.map(v => ({ ...v, ...(sessionMap[v.current_session_id || ""] || {}) })));
  }, [range]);

  // ── EVENTS TABLE ──
 const loadEventsTable = useCallback(async () => {
   const since = rangeStart(range);
    const { data } = await supabase.from("analytics_events").select("event_name, page_path, session_id, created_at").gte("created_at", since).order("created_at", { ascending: false }).limit(100);
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
    const since = rangeStart(range);
    const { data } = await supabase.from("analytics_events").select("page_path, visitor_id, event_name").gte("created_at", since);
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
    const since = rangeStart(range);
    const { data } = await supabase.from("analytics_events").select("metadata").gte("created_at", since);
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
    try {
      const response = await fetch(`/api/meta/ads?range=${range}`, {
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok || !result.success || !result.data) {
        throw new Error(result.error || "Unable to load Meta Ads data");
      }

      setMetaStats({ ...result.data, error: "" });
    } catch (error) {
      console.error("Meta Ads traffic error:", error);
      setMetaStats({
        spend: 0,
        impressions: 0,
        reach: 0,
        clicks: 0,
        ctr: 0,
        cpc: 0,
        leads: 0,
        facebook: 0,
        instagram: 0,
        messenger: 0,
        audienceNetwork: 0,
        connected: false,
        error: error instanceof Error ? error.message : "Unable to load Meta Ads data",
      });
    }
  }, [range]);
  // ── SCROLL DEPTH ──
  // FIX: the tracker emits discrete events named "scroll_depth_25",
  // "scroll_depth_50", "scroll_depth_75", "scroll_depth_100" — it does NOT
  // store a numeric `metadata.depth` field. The old code read
  // `metadata.depth`, which never existed, so this page was always empty.
  // Now we bucket by the milestone encoded in the event name itself.
  const loadScrollDepth = useCallback(async () => {
    const since = rangeStart(range);
    const { data } = await supabase.from("analytics_events").select("event_name").ilike("event_name", "scroll_depth_%").gte("created_at", since);
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
    await Promise.all([
  loadMetrics(),
  loadPvChart(),
  loadProductViewChart(),
  loadAddToCartChart(),
  loadCheckoutChart(),
  loadPurchaseChart(),
  loadButtonClickChart(),
  loadTotalEventsChart(),
  loadScroll25Chart(),
  loadScroll50Chart(),
  loadScroll75Chart(),
  loadScroll100Chart(),
  loadDevicesBrowsers(),
  loadRightNow(),
  loadEventFeed(),
  loadSidebar(),
  loadMetaTraffic(),
  loadBrevoLeads(),
]);

  } finally {
    setRefreshing(false);
  }
}, [
  loadMetrics,
  loadPvChart,
  loadProductViewChart,
  loadAddToCartChart,
  loadCheckoutChart,
  loadPurchaseChart,
  loadButtonClickChart,
  loadTotalEventsChart,
  loadScroll25Chart,
  loadScroll50Chart,
  loadScroll75Chart,
  loadScroll100Chart,
  loadDevicesBrowsers,
  loadRightNow,
  loadEventFeed,
  loadSidebar,
  loadMetaTraffic,
  loadBrevoLeads,
]);
  // ── INIT ──
  useEffect(() => {
    checkConn();
    loadAll();
    subscribe();
    loadLiveUsers();
    loadSparks();
    // FIX: poll also refreshes the event feed now, so the feed still moves
    // even if the realtime channel ever drops/reconnects.
   return () => {
  if (subRef.current) supabase.removeChannel(subRef.current);
};
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
    if (activePage === "realtime") {loadEventFeed();loadVisitors();}
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
const productViewChartData = {
  labels: productViewGraphData.labels,
  datasets: [
    {
      data: productViewGraphData.values,
      borderColor: "#c89b63",
      backgroundColor: "rgba(200,155,99,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#c89b63",
      tension: 0.4,
      fill: true,
    },
  ],
};
const addToCartChartData = {
  labels: addToCartGraphData.labels,
  datasets: [
    {
      data: addToCartGraphData.values,
      borderColor: "#d9a441",
      backgroundColor: "rgba(217,164,65,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#d9a441",
      tension: 0.4,
      fill: true,
    },
  ],
};

const checkoutChartData = {labels: checkoutGraphData.labels,datasets: [{data: checkoutGraphData.values,
      borderColor: "#8aa6a3",
      backgroundColor: "rgba(138,166,163,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#8aa6a3",
      tension: 0.4,
      fill: true,
    },
  ],
};
const purchaseChartData = {
  labels: purchaseGraphData.labels,
  datasets: [
    {
      data: purchaseGraphData.values,
      borderColor: "#c4633f",
      backgroundColor: "rgba(196,99,63,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#c4633f",
      tension: 0.4,
      fill: true,
    },
  ],
};
const buttonClickChartData = {
  labels: buttonClickGraphData.labels,
  datasets: [
    {
      data: buttonClickGraphData.values,
      borderColor: "#9b8ac7",
      backgroundColor: "rgba(155,138,199,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#9b8ac7",
      tension: 0.4,
      fill: true,
    },
  ],
};
const totalEventsChartData = {
  labels: totalEventsGraphData.labels,
  datasets: [
    {
      data: totalEventsGraphData.values,
      borderColor: "#c8a25a",
      backgroundColor: "rgba(200,162,90,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#c8a25a",
      tension: 0.4,
      fill: true,
    },
  ],
};
const scroll25ChartData = {
  labels: scroll25GraphData.labels,
  datasets: [
    {
      data: scroll25GraphData.values,
      borderColor: "#6f7b59",
      backgroundColor: "rgba(111,123,89,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#6f7b59",
      tension: 0.4,
      fill: true,
    },
  ],
};
const scroll50ChartData = {
  labels: scroll50GraphData.labels,
  datasets: [
    {
      data: scroll50GraphData.values,
      borderColor: "#8a9a6f",
      backgroundColor: "rgba(138,154,111,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#8a9a6f",
      tension: 0.4,
      fill: true,
    },
  ],
};
const scroll75ChartData = {
  labels: scroll75GraphData.labels,
  datasets: [
    {
      data: scroll75GraphData.values,
      borderColor: "#a89a73",
      backgroundColor: "rgba(168,154,115,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#a89a73",
      tension: 0.4,
      fill: true,
    },
  ],
};
const scroll100ChartData = {
  labels: scroll100GraphData.labels,
  datasets: [
    {
      data: scroll100GraphData.values,
      borderColor: "#b07b5b",
      backgroundColor: "rgba(176,123,91,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#b07b5b",
      tension: 0.4,
      fill: true,
    },
  ],
};
const buyNowChartData = {
  labels: buyNowGraphData.labels,
  datasets: [
    {
      data: buyNowGraphData.values,
      borderColor: "#c8a25a",
      backgroundColor: "rgba(200,162,90,0.18)",
      borderWidth: 2,
      pointRadius: 3,
      pointBackgroundColor: "#c8a25a",
      tension: 0.4,
      fill: true,
    },
  ],
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
  const donutPercentagePlugin = {
  id: "donutPercentagePlugin",
  afterDatasetsDraw(chart: any) {
    const { ctx } = chart;
    const dataset = chart.data.datasets[0];
    const meta = chart.getDatasetMeta(0);

    const total = dataset.data.reduce(
      (sum: number, value: number) => sum + Number(value || 0),
      0
    );

    if (!total) return;

    ctx.save();

    meta.data.forEach((arc: any, index: number) => {
      const value = Number(dataset.data[index] || 0);
      if (!value) return;

      const pct = Math.round((value / total) * 100);
      const label = chart.data.labels[index] || "";
      const color = dataset.backgroundColor[index];

      const props = arc.getProps(
        ["x", "y", "startAngle", "endAngle", "outerRadius"],
        true
      );

      const angle = (props.startAngle + props.endAngle) / 2;

      const startX = props.x + Math.cos(angle) * props.outerRadius;
      const startY = props.y + Math.sin(angle) * props.outerRadius;

      const midX = props.x + Math.cos(angle) * (props.outerRadius + 18);
      const midY = props.y + Math.sin(angle) * (props.outerRadius + 18);

      const isRight = midX >= props.x;
      const endX = midX + (isRight ? 42 : -42);
      const endY = midY;

      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(startX, startY);
      ctx.lineTo(midX, midY);
      ctx.lineTo(endX, endY);
      ctx.stroke();

      ctx.textAlign = isRight ? "left" : "right";
      ctx.textBaseline = "middle";

      ctx.fillStyle = color;
      ctx.font = "800 11px sans-serif";
      ctx.fillText(label, endX + (isRight ? 6 : -6), endY - 7);

      ctx.fillStyle = "#f4eadf";
      ctx.font = "700 10px sans-serif";
      ctx.fillText(`${pct}%`, endX + (isRight ? 6 : -6), endY + 7);
    });

    ctx.restore();
  },
};
  const donutOptions = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "68%",
  layout: {
    padding: {
      left: 90,
      right: 90,
      top: 24,
      bottom: 10,
    },
  },
  plugins: {
    legend: {
      position: "bottom" as const,
      labels: {
        color: "#a89280",
        font: { size: 11 },
        padding: 12,
        usePointStyle: true,
        pointStyleWidth: 8,
      },
    },
    tooltip: {
  enabled: false,
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
        <div style={{ padding: "16px 18px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src="/uppermost-analytics-logo.png" alt="Uppermost" style={{ width: "100%", maxWidth: 150, height: "auto", objectFit: "contain", display: "block", margin: "0 auto" }} />
        </div>

        <nav style={{ padding: "12px 0", flex: 1, overflowY: "auto" }}>
          {([
         
  ["overview", "Overview", Home],
  ["realtime", "Real-Time", Activity],
  ["visitors", "Visitors", Users],
  ["funnel", "Funnel", Funnel],
  ["sources", "Sources", Link2],
  ["scrolldepth", "Scroll Depth", ScrollText],
  ["lemlist", "Lemlist", Mail],
  ["brevo", "Brevo", null],
  ["metaAds", "Meta Ads", Infinity],
  ["graphs", "Special Graphs", BarChart3],
] as [Page, string, any][]).map(([page, label, Icon]) => (
    <div key={page} onClick={() => setActivePage(page)} style={{
              display: "flex", alignItems: "center", gap: 10, padding: "8px 18px",
              cursor: "pointer", color: activePage === page ? "var(--text)" : "var(--muted)",
              background: activePage === page ? "rgba(124,106,247,0.12)" : "transparent",
              fontSize: 13, position: "relative", userSelect: "none", transition: "all 0.15s",
            }}>
              {activePage === page && <div style={{ position: "absolute", left: 0, top: 4, bottom: 4, width: 2, background: "var(--accent)", borderRadius: "0 2px 2px 0" }} />}
              {Icon ? (
  <Icon
    size={18}
    strokeWidth={2.2}
    style={{
      flexShrink: 0,
      color: activePage === page ? "var(--accent)" : "var(--muted)",
    }}
  />
) : (
  <span style={{
    width: 18,
    height: 18,
    borderRadius: "50%",
    border: "2px solid currentColor",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 11,
    fontWeight: 900,
    lineHeight: 1,
    flexShrink: 0,
    color: activePage === page ? "var(--accent)" : "var(--muted)",
  }}>
    B
  </span>
)}
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
      <div style={{ order: 1, flex: 1, width: "auto", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", minHeight: 170,display: "flex", flexDirection: "column", overflow: "hidden" }}>

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
        <div style={{ flex: 1, width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", overflowY: "auto", padding: "20px 24px", display: "flex", flexDirection: "column", gap: 18 }}>
{/* — LEMLIST — */}
{activePage === "lemlist" && (
  <>
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div>
        <div
          style={{
            color: "var(--text)",
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          Lemlist Intelligence
        </div>

        <div
          style={{
            color: "var(--muted)",
            fontSize: 11,
            marginTop: 4,
          }}
        >
          Campaign leads, executive outreach and positive replies
        </div>
      </div>

      <div
        style={{
          color: "var(--green)",
          background: "rgba(34,211,160,0.08)",
          border: "1px solid rgba(34,211,160,0.25)",
          borderRadius: 5,
          padding: "5px 9px",
          fontSize: 9,
          fontWeight: 700,
        }}
      >
        ● LIVE INTEGRATION
      </div>
    </div>

    <div
      style={{
        display: "grid",
        gridTemplateColumns:
          "repeat(auto-fit, minmax(220px,1fr))",
        gap: 14,
      }}
    >
      <LemlistAnalytics days={range} />
    </div>
  </>
)}
          {/* — BREVO — */}
          {activePage === "brevo" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <div
                    style={{
                      color: "var(--text)",
                      fontSize: 18,
                      fontWeight: 600,
                    }}
                  >
                    Brevo Email Automation
                  </div>

                  <div
                    style={{
                      color: "var(--muted)",
                      fontSize: 11,
                      marginTop: 4,
                    }}
                  >
                    Launch waitlist, automation health and email performance
                  </div>
                </div>
  
                <div
                  style={{
                    color: "var(--green)",
                    background: "rgba(34,211,160,0.08)",
                    border: "1px solid rgba(34,211,160,0.25)",
                    borderRadius: 5,
                    padding: "5px 9px",
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                >
                  ● LIVE INTEGRATION
                </div>
              </div>

              <div
                style={{
                  width: "100%",
                  maxWidth: "100%",
                  minWidth: 0,
                  boxSizing: "border-box",
                }}
              >
                <BrevoAnalytics days={range} />
              </div>
            </>
          )}
          {/* ══ SPECIAL GRAPHS ══ */}

              {/* — META ADS — */}
          {activePage === "metaAds" && (
            <>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  justifyContent: "space-between",
                  gap: 16,
                }}
              >
                <div>
                  <div
                    style={{
                      color: "var(--text)",
                      fontSize: 18,
                      fontWeight: 600,
                    }}
                  >
                    Meta Ads Performance
                  </div>

                  <div
                    style={{
                      color: "var(--muted)",
                      fontSize: 11,
                      marginTop: 4,
                    }}
                  >
                    Facebook, Instagram, clicks, reach, spend aur campaign performance
                  </div>
                </div>

                <div
                  style={{
                    color: metaStats.connected ? "var(--green)" : "var(--orange)",
                    background: metaStats.connected ? "rgba(34,211,160,0.08)" : "rgba(217,164,65,0.12)",
                    border: `1px solid ${metaStats.connected ? "rgba(34,211,160,0.25)" : "rgba(217,164,65,0.25)"}`,
                    borderRadius: 5,
                    padding: "5px 9px",
                    fontSize: 9,
                    fontWeight: 700,
                  }}
                >
                  ● {metaStats.connected ? "META CONNECTED" : "META NOT CONNECTED"}
                </div>
              </div>

              {metaStats.error && (
                <div
                  style={{
                    color: "var(--orange)",
                    background: "rgba(217,164,65,0.10)",
                    border: "1px solid rgba(217,164,65,0.25)",
                    borderRadius: 8,
                    padding: 14,
                    fontSize: 12,
                  }}
                >
                  {metaStats.error}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
  <MetricCard
  label="Total Reach"
  value={Number(metaStats.reach || 0).toLocaleString()}
  color="var(--green)"
  badge="People"
  icon={<Users size={18} color="#8fae6b" />}
/>

<MetricCard
  label="Post Views"
  value={Number(metaStats.impressions || 0).toLocaleString()}
  color="var(--blue)"
  badge="Impressions"
  icon={<Eye size={18} color="#8aa6a3" />}
/>

<MetricCard
  label="Total Likes"
 value={Number((metaStats as any).instagramLikes || (metaStats as any).likes || 0).toLocaleString()}
  color="var(--pink)"
  badge="Engagement"
  icon={<Heart size={18} color="#e25575" />}
/>

<MetricCard
  label="Engagement Rate"
  value={`${Number(metaStats.ctr || 0).toFixed(2)}%`}
  color="var(--orange)"
  badge="Rate"
  icon={<Activity size={18} color="#c98a4b" />}
/>

<MetricCard
  label="Clicks"
  value={Number(metaStats.clicks || 0).toLocaleString()}
  color="var(--accent)"
  badge="Traffic"
  icon={<MousePointerClick size={18} color="#f4eadf" />}
/>

<MetricCard
  label="CTR"
  value={`${Number(metaStats.ctr || 0).toFixed(2)}%`}
  color="var(--orange)"
  badge="Click Rate"
  icon={<BarChart3 size={18} color="#d9a441" />}
/>

<MetricCard
  label="CPC"
  value={`₹${Number(metaStats.cpc || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
  color="var(--amber)"
  badge="Cost/Click"
  icon={<MousePointerClick size={18} color="#d9a441" />}
/>

<MetricCard
  label="Leads"
  value={Number(metaStats.leads || 0).toLocaleString()}
  color="var(--green)"
  badge="Conversions"
  icon={<Mail size={18} color="#8fae6b" />}
/>
</div>

<Panel title="Facebook vs Instagram" badge="Breakdown">
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
    <PlatformCard
      title="Facebook"
      reach={Number((metaStats as any).facebookReach || 0)}
      views={Number((metaStats as any).facebookImpressions || 0)}
      likes={Number((metaStats as any).facebookLikes || 0)}
      comments={Number((metaStats as any).facebookComments || 0)}
      shares={Number((metaStats as any).facebookShares || 0)}
      clicks={Number((metaStats as any).facebookClicks || metaStats.facebook || 0)}
    />

    <PlatformCard
      title="Instagram"
      reach={Number((metaStats as any).instagramReach || 0)}
      views={Number((metaStats as any).instagramImpressions || 0)}
      likes={Number((metaStats as any).instagramLikes || 0)}
      comments={Number((metaStats as any).instagramComments || 0)}
      shares={Number((metaStats as any).instagramSaves || 0)}
      clicks={Number((metaStats as any).instagramClicks || metaStats.instagram || 0)}
    />
  </div>
</Panel>
              <InstagramPostPerformance stats={metaStats} />
              <Panel title="Improvement Suggestions" badge="Action Plan">
                <div style={{ display: "grid", gap: 10, color: "var(--muted)", fontSize: 13 }}>
                  <div>• CTR low ho to ad creative, headline aur CTA change karo.</div>
                  <div>• CPC high ho to audience targeting narrow karo.</div>
                  <div>• Reach low ho to budget ya audience size check karo.</div>
                  <div>• Leads low ho to landing page/form improve karo.</div>
                  <div>• Instagram engagement high ho to Instagram budget increase karo.</div>
                </div>
              </Panel>
            </>
          )}      
{activePage === "graphs" && (
  <>
    {/* HEADER */}
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        marginBottom: 18,
      }}
    >
      <div>
        <div
          style={{
            color: "var(--text)",
            fontSize: 22,
            fontWeight: 800,
            letterSpacing: "-0.02em",
          }}
        >
          Special Graphs
        </div>

        <div
          style={{
            color: "var(--muted)",
            fontSize: 11,
            marginTop: 4,
          }}
        >
          Visualize every tracked event. All graphs in one place.
        </div>
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 11px",
          borderRadius: 6,
          background: "rgba(34,211,160,0.08)",
          border: "1px solid rgba(34,211,160,0.25)",
          color: "var(--green)",
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--green)",
          }}
        />
        Live
      </div>
    </div>

    {/* GRAPH TOOLBAR */}
    <div
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: 12,
        marginBottom: 14,
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--text)",
          fontWeight: 800,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
        }}
      >
        All Events
      </div>

      <div
        style={{
          fontSize: 10,
          color: "var(--muted)",
        }}
      >
        Graph data follows selected dashboard range
      </div>
    </div>
      {/* GRAPH CONTROLS */}
<div
  style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 16,
    marginBottom: 18,
    padding: 10,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
  }}
>
  {/* VIEW TYPE */}
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
    }}
  >
    {(["line", "area", "bar"] as GraphView[]).map((view) => (
      <button
        key={view}
        onClick={() => setGraphView(view)}
        style={{
          padding: "7px 12px",
          borderRadius: 6,
          border:
            graphView === view
              ? "1px solid #c8a25a"
              : "1px solid var(--border)",
          background:
            graphView === view
              ? "rgba(200,162,90,0.12)"
              : "transparent",
          color:
            graphView === view
              ? "#c8a25a"
              : "var(--muted)",
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
          textTransform: "capitalize",
        }}
      >
        {view}
      </button>
    ))}
  </div>

  {/* GROUP BY */}
  <div
    style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}
  >
    <span
      style={{
        fontSize: 10,
        color: "var(--muted)",
        fontWeight: 700,
      }}
    >
      Group by:
    </span>

    <select
      value={graphGroupBy}
      onChange={(e) =>
        setGraphGroupBy(e.target.value as GraphGroupBy)
      }
      style={{
        height: 32,
        padding: "0 30px 0 10px",
        borderRadius: 6,
        border: "1px solid var(--border)",
        background: "var(--card)",
        color: "var(--text)",
        fontSize: 11,
        fontWeight: 700,
        cursor: "pointer",
      }}
    >
      <option value="auto">Auto</option>
      <option value="hour">Hour</option>
      <option value="day">Day</option>
      <option value="week">Week</option>
      <option value="month">Month</option>
    </select>
  </div>
</div>
    {/* GRAPH GRID */}
    <div
      style={{
        width: "100%",
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
        gap: 12,
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          minHeight: 260,
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            fontSize: 12,
            fontWeight: 800,
            color: "var(--text)",
          }}
        >
          Page Views
        </div>

       <div
  style={{
    position: "relative",
    height: 190,
    width: "100%",
    marginTop: 14,
  }}
>
 {graphView === "bar" ? (
  <Bar
    data={chartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...chartData,
      datasets: chartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
</div>
      </div>
      {/* PRODUCT VIEWS */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Product Views
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {productViews} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
  {graphView === "bar" ? (
  <Bar
    data={productViewChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...productViewChartData,
      datasets: productViewChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
</div>
</div>
{/* ADD TO CART */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Add to Cart
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {metrics.atc} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={addToCartChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...addToCartChartData,
      datasets: addToCartChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* CHECKOUT */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Checkout
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {metrics.checkouts} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
   {graphView === "bar" ? (
  <Bar
    data={checkoutChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...checkoutChartData,
      datasets: checkoutChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
   {/* PURCHASE */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Purchases
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {metrics.purchases} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={purchaseChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...purchaseChartData,
      datasets: purchaseChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* BUTTON CLICKS */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Button Clicks
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {buttonClickGraphData.values.reduce(
        (sum, value) => sum + value,
        0
      )} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={buttonClickChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...buttonClickChartData,
      datasets: buttonClickChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* TOTAL EVENTS */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Total Events
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {metrics.events} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
   {graphView === "bar" ? (
  <Bar
    data={totalEventsChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...totalEventsChartData,
      datasets: totalEventsChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* SCROLL DEPTH 25% */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Scroll Depth 25%
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {scroll25GraphData.values.reduce(
        (sum, value) => sum + value,
        0
      )} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={scroll25ChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...scroll25ChartData,
      datasets: scroll25ChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* SCROLL DEPTH 50% */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Scroll Depth 50%
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {scroll50GraphData.values.reduce(
        (sum, value) => sum + value,
        0
      )} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={scroll50ChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...scroll50ChartData,
      datasets: scroll50ChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* SCROLL DEPTH 75% */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Scroll Depth 75%
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {scroll75GraphData.values.reduce(
        (sum, value) => sum + value,
        0
      )} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={scroll75ChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...scroll75ChartData,
      datasets: scroll75ChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}
  </div>
</div>
{/* SCROLL DEPTH 100% */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Scroll Depth 100%
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {scroll100GraphData.values.reduce(
        (sum, value) => sum + value,
        0
      )} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
  <Bar
    data={scroll100ChartData}
    options={chartOptions as Parameters<typeof Bar>[0]["options"]}
  />
) : (
  <Line
    data={{
      ...scroll100ChartData,
      datasets: scroll100ChartData.datasets.map((dataset) => ({
        ...dataset,
        fill: graphView === "area",
      })),
    }}
    options={chartOptions as Parameters<typeof Line>[0]["options"]}
  />
)}  
  </div>
</div>
{/* BUY NOW CLICKS */}
<div
  style={{
    minHeight: 260,
    background: "var(--card)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 16,
    boxSizing: "border-box",
  }}
>
  <div
    style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}
  >
    <div
      style={{
        fontSize: 12,
        fontWeight: 800,
        color: "var(--text)",
      }}
    >
      Buy Now Clicks
    </div>

    <div
      style={{
        fontSize: 10,
        color: "var(--muted)",
      }}
    >
      {buyNowGraphData.values.reduce(
        (sum, value) => sum + value,
        0
      )} total
    </div>
  </div>

  <div
    style={{
      position: "relative",
      height: 190,
      width: "100%",
      marginTop: 14,
    }}
  >
    {graphView === "bar" ? (
      <Bar
        data={buyNowChartData}
        options={chartOptions as Parameters<typeof Bar>[0]["options"]}
      />
    ) : (
      <Line
        data={{
          ...buyNowChartData,
          datasets: buyNowChartData.datasets.map((dataset) => ({
            ...dataset,
            fill: graphView === "area",
          })),
        }}
        options={chartOptions as Parameters<typeof Line>[0]["options"]}
      />
    )}
  </div>
</div>
    </div>
  </>
)}
          {/* ══ OVERVIEW ══ */}
          {activePage === "overview" && <>
   
       <div
      style={{
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    boxSizing: "border-box",
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px,1fr))",
    gap: 12,
  }}

>
  
             <MetricCard
  label="Brevo Leads"
  value={brevoLeads ?? "—"}
  color="var(--green)"
  badge="Subscribed"
  icon={<Mail size={18} color="#8fae6b" />}
/>

<MetricCard
  label="Unique Visitors"
  value={metrics.visitors}
  color="var(--amber)"
  badge="Selected range"
  icon={<Users size={18} color="#d9a441" />}
/>

<MetricCard
  label="New Visitors"
  value={metrics.newVisitors}
  color="var(--green)"
  badge="Selected range"
  icon={<Users size={18} color="#8fae6b" />}
/>

<MetricCard
  label="Returning Unique Visitors"
  value={metrics.returningUniqueVisitors}
  color="var(--blue)"
  badge="Selected range"
  icon={<Activity size={18} color="#8aa6a3" />}
/>

<MetricCard
  label="Online Now"
  value={metrics.online}
  color="var(--green)"
  badge="Real-time"
  icon={<Activity size={18} color="#8fae6b" />}
/>

<MetricCard
  label="Sessions"
  value={metrics.sessions}
  color="var(--blue)"
  badge="Live"
  icon={<Monitor size={18} color="#8aa6a3" />}
/>

<MetricCard
  label="Page Views"
  value={metrics.pageviews}
  color="var(--amber)"
  badge="Live"
  spark={sparks.pageviews}
  icon={<Eye size={18} color="#d9a441" />}
/>

<MetricCard
  label="Total Events"
  value={metrics.events}
  color="var(--orange)"
  badge="Live"
  spark={sparks.events}
  icon={<BarChart3 size={18} color="#c98a4b" />}
/>

<MetricCard
  label="Add To Cart"
  value={metrics.atc}
  color="var(--amber)"
  badge="Live"
  icon={<MousePointerClick size={18} color="#d9a441" />}
/>

<MetricCard
  label="Checkouts"
  value={metrics.checkouts}
  color="var(--blue)"
  badge="Live"
  icon={<MousePointerClick size={18} color="#8aa6a3" />}
/>

<MetricCard
  label="Purchases"
  value={metrics.purchases}
  color="var(--green)"
  badge="Live"
  icon={<Mail size={18} color="#8fae6b" />}
/>
            </div>
             <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr) minmax(0, 1fr)", gap: 14 }}>
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
                <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <span style={{ fontSize: 14, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>{pvHeading}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Live</span>
                  </div>
                  <div style={{ position: "relative", height: 190, width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", overflow: "hidden" }}>
                    <Line data={chartData} options={chartOptions as Parameters<typeof Line>[0]["options"]} />
                  </div>
                </div>

              </Panel>
              <Panel title="Conversion Funnel" badge="● Live">
                <OverviewFunnelKpi
                  visitors={metrics.visitors}
                  productViews={productViews}
                  atc={metrics.atc}
                  checkouts={metrics.checkouts}
                  purchases={metrics.purchases}
                />
              </Panel>
              <Panel title="Meta Ads Traffic">
                {!metaStats.connected ? (
                  <>
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
                      ⚠ Meta Ads not connected
                    </div>
                    {metaStats.error && (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          background: "rgba(196,99,63,0.10)",
                          border: "1px solid rgba(196,99,63,0.22)",
                          color: "var(--red)",
                          fontSize: 11,
                          lineHeight: 1.5,
                        }}
                      >
                        {metaStats.error}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 10, marginBottom: 16 }}>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Spend</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>₹{metaStats.spend}</div>
                      </div>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Impressions</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{metaStats.impressions.toLocaleString()}</div>
                      </div>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Reach</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{metaStats.reach.toLocaleString()}</div>
                      </div>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Clicks</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{metaStats.clicks.toLocaleString()}</div>
                      </div>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>CTR</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{metaStats.ctr}%</div>
                      </div>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>CPC</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>₹{metaStats.cpc}</div>
                      </div>
                      <div style={{ padding: "12px", background: "var(--bg3)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                        <div style={{ fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>Leads</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>{metaStats.leads.toLocaleString()}</div>
                      </div>
                    </div>

                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase", marginBottom: 10 }}>Platform Breakdown</div>
                    <MetaPlatformGroupedChart stats={metaStats} />
                  </>
                )}
              </Panel>
            </div>
              <Panel title="Live Event Feed" badge="● Live">
                <div style={{ maxHeight: 220, overflowY: "auto" }}>
                  {eventFeed.length === 0
                    ? <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>Waiting for events…</div>
                    : eventFeed.map((e, i) => <EventFeedItem key={i} e={e} />)}
                </div>
              </Panel>
            
            
            <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 14 }}>
              <Panel title="Devices & Operating Systems">
                <div style={{ width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box", display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 0, minHeight: 260 }}>
                  <div style={{ paddingRight: 14, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 12 }}>
                     <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}><Monitor size={15} color="#d9a441" /><span>Device Split</span></div>{devices.length === 0
                      ? <div style={{ textAlign: "center", padding: 24, color: "var(--dim)", fontSize: 12 }}>No data yet</div>
                      : <div style={{ position: "relative", height: 200 }}>
                          <Doughnut data={donutData}options={donutOptions as Parameters<typeof Doughnut>[0]["options"]}plugins={[donutPercentagePlugin]}/>
                          <div style={{ position: "absolute", top: "38%", left: 0, right: 0, textAlign: "center", pointerEvents: "none" }}>
                            <div style={{ fontSize: 26, fontWeight: 700, color: "var(--text)", lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{deviceTotal}</div>
                            <div style={{ fontSize: 9, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 2 }}>Total</div>
                          </div>
                        </div>}
                  </div>

                  <div style={{ paddingLeft: 14, display: "flex", flexDirection: "column", gap: 12 }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", color: "var(--muted)", textTransform: "uppercase" }}>
                    <SiApple size={15} color="#f4eadf" />
                    <SiWindows size={15} color="#d9d9d9" />
                    <SiAndroid size={15} color="#9bd36a" />
                    <span>Operating Systems</span>
                    </div>                    
                    <div style={{ minHeight: 200 }}>
                      <CompactBarStrip items={osData} />
                    </div>
                  </div>
                </div>
              </Panel>

              <Panel title="Browsers"><BrowserAnalyticsTable items={browsers} /></Panel>
            </div>
          </>}

          {/* ══ REAL-TIME ══ */}
         {activePage === "realtime" && <>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12 }}>
    <MetricCard label="Online Right Now" value={metrics.online} color="var(--green)" badge="Real-time" />
    <MetricCard label="Active Sessions" value={metrics.sessions} color="var(--blue)" badge="Live" />
    <MetricCard label="Page Views Today" value={metrics.pageviews} color="var(--accent)" badge="Live" />
    <MetricCard label="Unique Visitors" value={metrics.visitors} color="var(--accent)" badge="Selected range" />
    <MetricCard label="Returning Visitors" value={metrics.returningUniqueVisitors} color="var(--blue)" badge="Selected range" />
  </div>

  <Panel title="Visitor Details" badge="India Timezone">
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <select
        value={rtVisitorType}
        onChange={(e) => setRtVisitorType(e.target.value)}
        style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12 }}
      >
        <option value="all">All visitors</option>
        <option value="new">New visitors</option>
        <option value="returning">Returning visitors</option>
        <option value="unique">Unique visitors</option>
      </select>

      <input
        value={rtVisitorSearch}
        onChange={(e) => setRtVisitorSearch(e.target.value)}
        placeholder="Search city / device / OS / visitor id..."
        style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12, flex: 1, minWidth: 220 }}
      />
    </div>

    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Visitor ID", "Type", "City", "Country", "Device", "Browser", "OS", "First Seen IST", "Last Seen IST"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {visitors
            .filter((v) => {
              const sinceTime = new Date(rangeStart(range)).getTime();
              const firstSeenTime = v.first_seen_at ? new Date(v.first_seen_at).getTime() : 0;
              const visitorType = firstSeenTime >= sinceTime ? "new" : "returning";

              const matchesType =
                rtVisitorType === "all" ||
                rtVisitorType === "unique" ||
                rtVisitorType === visitorType;

              const q = rtVisitorSearch.toLowerCase();
              const matchesSearch =
                !q ||
                v.visitor_id.toLowerCase().includes(q) ||
                v.city?.toLowerCase().includes(q) ||
                v.country?.toLowerCase().includes(q) ||
                v.device_type?.toLowerCase().includes(q) ||
                v.browser?.toLowerCase().includes(q) ||
                v.os?.toLowerCase().includes(q);

              return matchesType && matchesSearch;
            })
            .map((v) => {
              const sinceTime = new Date(rangeStart(range)).getTime();
              const firstSeenTime = v.first_seen_at ? new Date(v.first_seen_at).getTime() : 0;
              const visitorType = firstSeenTime >= sinceTime ? "New" : "Returning";

              return (
                <tr key={v.visitor_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11 }}>{shortId(v.visitor_id)}</td>
                  <td style={{ padding: "9px 12px" }}>{visitorType}</td>
                  <td style={{ padding: "9px 12px" }}>{v.city || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{v.country || "—"}</td>
                  <td style={{ padding: "9px 12px" }}><DeviceCell value={v.device_type} /></td>
                  <td style={{ padding: "9px 12px" }}><BrowserCell value={v.browser} /></td>
                  <td style={{ padding: "9px 12px" }}><OSCell value={v.os} /></td>
                  <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{fmt(v.first_seen_at ?? null)}</td>
                  <td style={{ padding: "9px 12px", color: "var(--muted)" }}>{fmt(v.last_seen_at)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  </Panel>

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
  <Panel title="Visitor Details" badge="India Timezone">
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <select
        value={rtVisitorType}
        onChange={(e) => setRtVisitorType(e.target.value)}
        style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12 }}
      >
        <option value="all">All visitors</option>
        <option value="new">New visitors</option>
        <option value="returning">Returning visitors</option>
        <option value="unique">Unique visitors</option>
      </select>

      <input
        value={rtVisitorSearch}
        onChange={(e) => setRtVisitorSearch(e.target.value)}
        placeholder="Search city / device / OS / visitor id..."
        style={{ padding: "6px 10px", borderRadius: 6, background: "var(--border2)", color: "var(--fg)", border: "1px solid var(--border)", fontSize: 12, flex: 1, minWidth: 220 }}
      />
    </div>

    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr>
            {["Visitor ID", "Type", "City", "Country", "Device", "Browser", "OS", "First Seen IST", "Last Seen IST"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", borderBottom: "1px solid var(--border)", fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {visitors
            .filter((v) => {
              const sinceTime = new Date(rangeStart(range)).getTime();
              const firstSeenTime = v.first_seen_at ? new Date(v.first_seen_at).getTime() : 0;
              const visitorType = firstSeenTime >= sinceTime ? "new" : "returning";

              const matchesType =
                rtVisitorType === "all" ||
                rtVisitorType === "unique" ||
                rtVisitorType === visitorType;

              const q = rtVisitorSearch.toLowerCase();
              const matchesSearch =
                !q ||
                v.visitor_id.toLowerCase().includes(q) ||
                v.city?.toLowerCase().includes(q) ||
                v.country?.toLowerCase().includes(q) ||
                v.device_type?.toLowerCase().includes(q) ||
                v.browser?.toLowerCase().includes(q) ||
                v.os?.toLowerCase().includes(q);

              return matchesType && matchesSearch;
            })
            .map((v) => {
              const sinceTime = new Date(rangeStart(range)).getTime();
              const firstSeenTime = v.first_seen_at ? new Date(v.first_seen_at).getTime() : 0;
              const visitorType = firstSeenTime >= sinceTime ? "New" : "Returning";

              return (
                <tr key={v.visitor_id} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "9px 12px", fontFamily: "monospace", fontSize: 11 }}>{shortId(v.visitor_id)}</td>
                  <td style={{ padding: "9px 12px" }}>{visitorType}</td>
                  <td style={{ padding: "9px 12px" }}>{v.city || "—"}</td>
                  <td style={{ padding: "9px 12px" }}>{v.country || "—"}</td>
                  <td style={{ padding: "9px 12px" }}><DeviceCell value={v.device_type} /></td>
                  <td style={{ padding: "9px 12px" }}><BrowserCell value={v.browser} /></td>
                  <td style={{ padding: "9px 12px" }}><OSCell value={v.os} /></td>
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
                          <td style={{ padding: "9px 12px" }}><DeviceCell value={e.device_type} muted /></td>
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
