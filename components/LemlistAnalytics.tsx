  "use client";

import { useEffect, useState } from "react";

type AnalyticsData = {
  totalLeads: number;
  ceoFounderLeads: number;
  positiveReplies: number;
  campaignCount: number;
  executiveCampaignCount: number;
  rangeDays: number;
  syncedAt: string;
};

type Props = {
  days?: number;
};

/**
 * FEATURE: Brevo Email Automation Status
 *
 * REQUIREMENT:
 * Added to give the Uppermost team a centralized view of Brevo email
 * automation health and performance directly inside the existing
 * Uppermost Analytics Intelligence dashboard.
 *
 * PURPOSE:
 * Displays Brevo launch waitlist contacts, automation status,
 * email sends, deliveries, opens, clicks, bounces, connection health,
 * and last synchronization status.
 *
 * DATA SOURCE:
 * Brevo API via a secure server-side Next.js API route.
 *
 * FLOW:
 * Brevo API → Next.js Backend → Uppermost Analytics Dashboard
 *
 * SECURITY:
 * Brevo credentials must remain server-side and must never be exposed
 * to the browser/client bundle.
 *
 * ADDED:
 * August 2026
 */
export default function LemlistAnalytics({ days = 1 }: Props) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      try {
        setLoading(true);
        setError(false);

        const response = await fetch(
          `/api/lemlist/analytics?days=${days}`,
          {
            cache: "no-store",
          }
        );

        const responseText = await response.text();
        const result = JSON.parse(responseText);

        if (!response.ok || !result.success || !result.data) {
          throw new Error("Unable to load Lemlist analytics.");
        }

        if (active) {
          setData(result.data);
        }
      } catch (error) {
        console.error("Lemlist analytics error:", error);

        if (active) {
          setError(true);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadAnalytics();

    return () => {
      active = false;
    };
  }, [days]);

  if (loading) {
    return (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12 }}>
          <div style={{ width: 14, height: 14, border: "2px solid var(--border2)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
          Loading…
        </div>
      </>
    );
  }

  if (error || !data) {
    return <></>;
  }

  return (
    <>
      <div style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "14px 16px",
        position: "relative",
        overflow: "hidden",
        animation: "fadeIn 0.3s ease",
      }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "var(--accent)" }} />
        <div style={{
          height: 44,
          lineHeight: 1.2,
          fontSize: 18,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "#d9b48a",
          marginBottom: 10,
        }}>
          Lemlist Leads
        </div>
        <div style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          color: "var(--text)",
        }}>{data.totalLeads}</div>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          marginTop: 6,
          padding: "2px 6px",
          borderRadius: 4,
          background: "rgba(201,138,75,0.14)",
          color: "var(--accent)",
        }}>
          ● {data.campaignCount} campaigns
        </div>
      </div>

      <div style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "14px 16px",
        position: "relative",
        overflow: "hidden",
        animation: "fadeIn 0.3s ease",
      }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "var(--accent)" }} />
        <div style={{
          height: 44,
          lineHeight: 1.2,
          fontSize: 18,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "#d9b48a",
          marginBottom: 10,
        }}>
          CEO / Founder
        </div>
        <div style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          color: "var(--text)",
        }}>{data.ceoFounderLeads}</div>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          marginTop: 6,
          padding: "2px 6px",
          borderRadius: 4,
          background: "rgba(201,138,75,0.14)",
          color: "var(--accent)",
        }}>
          ● Executive
        </div>
      </div>

      <div style={{
        width: "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "14px 16px",
        position: "relative",
        overflow: "hidden",
        animation: "fadeIn 0.3s ease",
      }}>
        <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 2, background: "var(--accent)" }} />
        <div style={{
          height: 44,
          lineHeight: 1.2,
          fontSize: 18,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.09em",
          color: "#d9b48a",
          marginBottom: 10,
        }}>
          Positive Replies
        </div>
        <div style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
          color: "var(--text)",
        }}>{data.positiveReplies}</div>
        <div style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          fontSize: 10,
          marginTop: 6,
          padding: "2px 6px",
          borderRadius: 4,
          background: "rgba(201,138,75,0.14)",
          color: "var(--accent)",
        }}>
          ● 0.0% rate
        </div>
      </div>
    </>
  );
}