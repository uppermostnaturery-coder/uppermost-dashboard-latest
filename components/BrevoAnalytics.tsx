"use client";

import { useEffect, useState } from "react";

type RecentContact = {
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  status: string;
  emailStatus?: string;
};

type BrevoStatusData = {
  totalContacts: number | null;
  currentPage: number | null;
  pageSize: number | null;
  totalPages: number | null;
  searchQuery: string;
  automationStatus: string | null;
  started: string | null;
  finished: string | null;
  currentlyRunning: string | null;
  sent: number | null;
  delivered: number | null;
  opened: number | null;
  clicked: number | null;
  bounced: number | null;
  connectionStatus: string | null;
  lastSync: string | null;
  recentContacts: RecentContact[];
};

function formatValue(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";

  if (typeof value === "number") {
    return value.toLocaleString("en-IN");
  }

  return value;
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatContactAdded(value: string | null | undefined) {
  if (!value) return "—";

  try {
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();

    if (diffMs <= 0) return "Just now";

    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return mins <= 1 ? "Just now" : `${mins} min ago`;

    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours} hr ago`;

    const days = Math.round(hours / 24);
    if (days < 7) return `${days} day ago`;

    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

function formatContactStatus(value: string | null | undefined) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();

  if (normalized === "blocklisted") return "Blocklisted";
  if (normalized === "unsubscribed") return "Unsubscribed";
  return "Subscribed";
}
function getEmailActivityStyle(value: string | null | undefined) {
  const normalized = `${value ?? ""}`.trim().toLowerCase();

  if (normalized === "clicked") {
    return {
      color: "var(--green)",
      background: "rgba(34,211,160,0.12)",
      border: "rgba(34,211,160,0.22)",
    };
  }

  if (normalized === "opened") {
    return {
      color: "#7ab7ff",
      background: "rgba(122,183,255,0.12)",
      border: "rgba(122,183,255,0.22)",
    };
  }

  if (normalized === "delivered") {
    return {
      color: "#f2b84b",
      background: "rgba(242,184,75,0.12)",
      border: "rgba(242,184,75,0.22)",
    };
  }

  if (normalized === "bounced") {
    return {
      color: "var(--red)",
      background: "rgba(244,63,94,0.12)",
      border: "rgba(244,63,94,0.22)",
    };
  }

  return {
    color: "var(--muted)",
    background: "rgba(255,255,255,0.04)",
    border: "rgba(255,255,255,0.08)",
  };
}
function formatRangeLabel(days: number) {
  if (days === 1) return "Today";
  if (days === 2) return "Last 48 hours";
  return `Last ${days} days`;
}

export default function BrevoAnalytics({ days = 1 }: { days?: number }) {
  const [data, setData] = useState<BrevoStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");

  useEffect(() => {
    setPage(1);
  }, [days]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPage(1);
      setSearchQuery(searchText.trim());
    }, 300);

    return () => window.clearTimeout(handle);
  }, [searchText]);

  useEffect(() => {
    let active = true;

    async function loadData() {
      try {
        setLoading(true);
        setError(false);

        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("per_page", "20");
        params.set("days", String(days));

        if (searchQuery) {
          params.set("search", searchQuery);
        }

        const response = await fetch(`/api/brevo/status?${params.toString()}`, {
          cache: "no-store",
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || "Unable to load Brevo data.");
        }

        if (active) {
          setData(result.data);
        }
      } catch (err) {
        console.error("Brevo status error:", err);

        if (active) {
          setError(true);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      active = false;
    };
  }, [page, searchQuery, days]);

  const statusColor = error ? "var(--red)" : "var(--green)";
  const recentContacts = data?.recentContacts ?? [];
  const filteredContacts = recentContacts.filter((contact) => {
  const status = formatContactStatus(contact.status).toLowerCase();
  const activity = `${contact.emailStatus || "No activity"}`.trim().toLowerCase();

  const matchesStatus =
    statusFilter === "all" || status === statusFilter;

  const matchesActivity =
    activityFilter === "all" || activity === activityFilter;

  return matchesStatus && matchesActivity;
});
  const currentPage = data?.currentPage ?? page;
  const totalPages = data?.totalPages ?? 1;
  const pageInfoVisible = !loading && data?.totalPages != null;
  const hasPrevious = currentPage > 1;
  const hasNext = pageInfoVisible ? currentPage < totalPages : false;
  const sentCount = Number(data?.sent || 0);
const deliveredCount = Number(data?.delivered || 0);
const openedCount = Number(data?.opened || 0);
const bouncedCount = Number(data?.bounced || 0);

const automationStatus = data?.automationStatus || (error ? "Inactive" : "Active");
const workflowStarted = data?.started || sentCount;
const workflowFinished = data?.finished || Math.max(deliveredCount, openedCount);
const currentlyRunning =
  data?.currentlyRunning ||
  Math.max(sentCount - deliveredCount - bouncedCount, 0);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 900,
              letterSpacing: "0.08em",
              color: "var(--muted)",
              textTransform: "uppercase",
            }}
          >
            BREVO EMAIL AUTOMATION
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 3 }}>
            Launch waitlist, automation health and email performance
          </div>
        </div>

        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10,
            fontWeight: 800,
            padding: "4px 9px",
            borderRadius: 5,
            background: "rgba(34,211,160,0.12)",
            color: statusColor,
            border: `1px solid ${error ? "rgba(244,63,94,0.22)" : "rgba(34,211,160,0.2)"}`,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "currentColor" }} />
          {loading ? "SYNCING" : error ? "UNAVAILABLE" : "LIVE"}
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Launch Waitlist
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: "var(--text)", fontVariantNumeric: "tabular-nums" }}>
              {loading ? "—" : formatValue(data?.totalContacts)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Total Contacts</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Automation
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(automationStatus)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Status</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Workflow
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(workflowStarted)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Started</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Workflow
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(workflowFinished)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Finished</div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Automation
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(currentlyRunning)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Currently Running</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Email Performance
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(data?.sent)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Sent</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Email Performance
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(data?.delivered)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Delivered</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Email Performance
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(data?.opened)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Opened</div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 12,
          }}
        >
          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Email Performance
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(data?.clicked)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Clicked</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Email Performance
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(data?.bounced)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Bounced</div>
          </div>

          <div style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontSize: 10, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Connection Status
            </div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>
              {loading ? "—" : formatValue(data?.connectionStatus)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>Last Sync</div>
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <div>
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: 2,
                }}
              >
                LATEST BREVO CONTACTS
              </div>

              <div
                style={{
                  color: "var(--muted)",
                  fontSize: 12,
                  marginTop: 4,
                }}
              >
                Showing contacts from selected range: {formatRangeLabel(days)}
              </div>
            </div>
       <select
  value={statusFilter}
  onChange={(event) => setStatusFilter(event.target.value)}
  style={{
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(231,198,154,0.14)",
    background: "rgba(255,255,255,0.03)",
    color: "var(--text)",
    fontSize: 12,
  }}
>
  <option value="all">All Status</option>
  <option value="subscribed">Subscribed</option>
  <option value="unsubscribed">Unsubscribed</option>
  <option value="blocklisted">Blocklisted</option>
</select>

<select
  value={activityFilter}
  onChange={(event) => setActivityFilter(event.target.value)}
  style={{
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid rgba(231,198,154,0.14)",
    background: "rgba(255,255,255,0.03)",
    color: "var(--text)",
    fontSize: 12,
  }}
>
  <option value="all">All Activity</option>
  <option value="clicked">Clicked</option>
  <option value="opened">Opened</option>
  <option value="delivered">Delivered</option>
  <option value="bounced">Bounced</option>
  <option value="no activity">No Activity</option>
</select>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <input
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search email or phone"
                style={{
                  minWidth: 200,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid rgba(231,198,154,0.14)",
                  background: "rgba(255,255,255,0.03)",
                  color: "var(--text)",
                  fontSize: 12,
                }}
              />

              {pageInfoVisible && (
                <div style={{ fontSize: 10, color: "var(--muted)" }}>
                  Page {currentPage} of {totalPages}
                </div>
              )}
            </div>
          </div>

          {loading ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 0" }}>
              Loading latest contacts…
            </div>
          ) : error ? (
            <div style={{ fontSize: 12, color: "var(--red)", padding: "6px 0" }}>
              Brevo data unavailable
            </div>
          ) : filteredContacts.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--muted)", padding: "6px 0" }}>
              No contacts yet
            </div>
          ) : (
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 8,
                overflow: "hidden",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1.8fr) 150px 110px 120px 140px",
                  gap: 8,
                  padding: "9px 10px",
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: "0.06em",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <span>Email</span>
                <span>Phone</span>
                <span>Added</span>
                <span>Status</span>
                <span>Email Activity</span>
              </div>

              {filteredContacts.map((contact, index) => {
  const activityStyle = getEmailActivityStyle(contact.emailStatus);

  return (
    <div
      key={`${contact.email ?? contact.phone ?? "contact"}-${index}`}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1.8fr) 150px 110px 120px 140px",
        gap: 8,
        padding: "9px 10px",
        alignItems: "center",
        borderTop: index === 0 ? "none" : "1px solid var(--border)",
      }}
    >
      <div
        style={{
          color: "var(--text)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {contact.email || "—"}
      </div>

      <div
        style={{
          color: "var(--text)",
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {contact.phone || "—"}
      </div>

      <div style={{ fontSize: 11, color: "var(--muted)" }}>
        {formatContactAdded(contact.createdAt)}
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 11,
          color: "var(--green)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "currentColor",
          }}
        />
        {formatContactStatus(contact.status)}
      </div>

      <div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "4px 8px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 800,
            color: activityStyle.color,
            background: activityStyle.background,
            border: `1px solid ${activityStyle.border}`,
            whiteSpace: "nowrap",
          }}
        >
          {contact.emailStatus || "No activity"}
        </span>
      </div>
    </div>
  );
})}
            </div>
          )}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 8,
              marginTop: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontSize: 11, color: "var(--muted)" }}>
              {loading
                ? "Loading contacts…"
               : filteredContacts.length === 0
  ? searchQuery || statusFilter !== "all" || activityFilter !== "all"
    ? "No contacts match your filters."
    : "No contacts yet"
  : `${filteredContacts.length} contacts shown`}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={!hasPrevious || loading}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: hasPrevious ? "var(--bg3)" : "var(--bg2)",
                  color: hasPrevious ? "var(--text)" : "var(--muted)",
                  cursor: hasPrevious && !loading ? "pointer" : "not-allowed",
                  fontSize: 12,
                }}
              >
                Previous
              </button>

              <button
                type="button"
                onClick={() => setPage((value) => value + 1)}
                disabled={!hasNext || loading}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: hasNext ? "var(--bg3)" : "var(--bg2)",
                  color: hasNext ? "var(--text)" : "var(--muted)",
                  cursor: hasNext && !loading ? "pointer" : "not-allowed",
                  fontSize: 12,
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div
          style={{
            borderTop: "1px solid var(--border)",
            paddingTop: 8,
            fontSize: 11,
            color: "var(--muted)",
          }}
        >
          Last sync: {loading ? "—" : formatTimestamp(data?.lastSync)}
        </div>
      </div>
    </div>
  );
}