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

  const responseRate =
    data && data.totalLeads > 0
      ? (
          (data.positiveReplies / data.totalLeads) *
          100
        ).toFixed(1)
      : "0.0";

  const cards = [
    {
      label: "Lemlist Leads",
      value: data?.totalLeads ?? 0,
      badge: `${data?.campaignCount ?? 0} campaigns`,
      color: "var(--accent)",
    },
    {
      label: "CEO / Founder",
      value: data?.ceoFounderLeads ?? 0,
      badge: "Executive",
      color: "var(--amber)",
    },
    {
      label: "Positive Replies",
      value: data?.positiveReplies ?? 0,
      badge: `${responseRate}% rate`,
      color: "var(--green)",
    },
  ];

  return (
    <>
      {cards.map((card) => (
        <div
          key={card.label}
          style={{
            minHeight: 130,
            padding: "15px 15px 13px",
            border: "1px solid var(--border2)",
            borderRadius: 9,
            background: "var(--bg2)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: 2,
              background: card.color,
            }}
          />

          <div
            style={{
              color: "var(--muted)",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {card.label}
          </div>

          <div
            style={{
              color: "var(--text)",
              fontSize: 27,
              fontWeight: 700,
              lineHeight: 1,
              marginTop: 15,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {loading ? "—" : card.value}
          </div>

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              marginTop: 9,
              padding: "3px 6px",
              borderRadius: 4,
              background: error
                ? "rgba(244,63,94,0.12)"
                : "rgba(217,164,65,0.12)",
              color: error ? "#f46b76" : card.color,
              fontSize: 8,
              fontWeight: 600,
            }}
          >
            <span
              style={{
                width: 4,
                height: 4,
                borderRadius: "50%",
                background: "currentColor",
              }}
            />

            {error ? "Sync error" : card.badge}
          </div>
        </div>
      ))}
    </>
  );
}