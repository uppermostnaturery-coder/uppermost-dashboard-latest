import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEMLIST_API_BASE_URL = "https://api.lemlist.com/api";
const CACHE_TTL_MS = 60_000;

type CampaignStats = {
  nbLeads?: number;
  nbLeadsInterested?: number;
};

type AnalyticsResponse = {
  totalLeads: number;
  ceoFounderLeads: number;
  positiveReplies: number;
  campaignCount: number;
  executiveCampaignCount: number;
  rangeDays: number;
  syncedAt: string;
};

let memoryCache:
  | {
      key: string;
      expiresAt: number;
      value: AnalyticsResponse;
    }
  | undefined;

function readCampaignIds(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter((id) => /^cam_[A-Za-z0-9]+$/.test(id))
    )
  );
}

function configuredCampaignIds(): string[] {
  const analyticsIds = readCampaignIds(
    process.env.LEMLIST_ANALYTICS_CAMPAIGN_IDS
  );

  if (analyticsIds.length > 0) return analyticsIds;

  // Falls back to the four campaigns already used by /api/lead.
  return Array.from(
    new Set(
      [
        process.env.LEMLIST_CAMPAIGN_PREGNANCY,
        process.env.LEMLIST_CAMPAIGN_FITNESS,
        process.env.LEMLIST_CAMPAIGN_TASTE,
        process.env.LEMLIST_CAMPAIGN_FAMILY_HEALTH ??
          process.env.LEMLIST_CAMPAIGN_FAMILY,
      ].filter((id): id is string => Boolean(id && /^cam_[A-Za-z0-9]+$/.test(id)))
    )
  );
}

function lemlistAuthorizationHeader(): string {
  const apiKey = process.env.LEMLIST_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("LEMLIST_API_KEY is missing.");
  }

  return `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`;
}

function requestedRangeDays(request: Request): number {
  const raw = new URL(request.url).searchParams.get("days");
  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) return 1;

  return Math.min(Math.max(parsed, 1), 90);
}

function rangeDates(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end);

  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));

  return {
    startDate: start.toISOString(),
    endDate: end.toISOString(),
  };
}

async function getCampaignStats(
  campaignId: string,
  startDate: string,
  endDate: string
): Promise<CampaignStats> {
  const query = new URLSearchParams({ startDate, endDate });
  const response = await fetch(
    `${LEMLIST_API_BASE_URL}/v2/campaigns/${encodeURIComponent(
      campaignId
    )}/stats?${query.toString()}`,
    {
      method: "GET",
      headers: {
        Authorization: lemlistAuthorizationHeader(),
        Accept: "application/json",
      },
      cache: "no-store",
    }
  );

  const responseText = await response.text();
  let responseBody: unknown = null;

  if (responseText) {
    try {
      responseBody = JSON.parse(responseText);
    } catch {
      responseBody = responseText;
    }
  }

  if (!response.ok) {
    const safeMessage =
      typeof responseBody === "string"
        ? responseBody.slice(0, 300)
        : `HTTP ${response.status}`;

    throw new Error(
      `Lemlist campaign stats failed for ${campaignId}: ${safeMessage}`
    );
  }
     
  return responseBody && typeof responseBody === "object"
    ? (responseBody as CampaignStats)
    : {};
}

function total(values: CampaignStats[], field: keyof CampaignStats): number {
  return values.reduce((sum, value) => {
    const amount = Number(value[field] ?? 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

export async function GET(request: Request) {
  try {
    const rangeDays = requestedRangeDays(request);
    const campaignIds = configuredCampaignIds();
    const executiveCampaignIds = readCampaignIds(
      process.env.LEMLIST_EXECUTIVE_CAMPAIGN_IDS
    );

    if (campaignIds.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            "No lemlist analytics campaign IDs are configured. Set LEMLIST_ANALYTICS_CAMPAIGN_IDS.",
        },
        {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        }
      );
    }

    const cacheKey = [
      rangeDays,
      campaignIds.join(","),
      executiveCampaignIds.join(","),
    ].join("|");

    if (
      memoryCache &&
      memoryCache.key === cacheKey &&
      memoryCache.expiresAt > Date.now()
    ) {
      return NextResponse.json(
        { success: true, data: memoryCache.value },
        {
          status: 200,
          headers: {
            "Cache-Control": "private, max-age=30",
            "X-Lemlist-Cache": "HIT",
          },
        }
      );
    }

    const { startDate, endDate } = rangeDates(rangeDays);
    const allIds = Array.from(
      new Set([...campaignIds, ...executiveCampaignIds])
    );

    const entries = await Promise.all(
      allIds.map(async (campaignId) => ({
        campaignId,
        stats: await getCampaignStats(campaignId, startDate, endDate),
      }))
    );

    const statsByCampaign = new Map(
      entries.map((entry) => [entry.campaignId, entry.stats])
    );
    const campaignStats = campaignIds.map(
      (campaignId) => statsByCampaign.get(campaignId) ?? {}
    );
    const executiveStats = executiveCampaignIds.map(
      (campaignId) => statsByCampaign.get(campaignId) ?? {}
    );

    const value: AnalyticsResponse = {
      totalLeads: total(campaignStats, "nbLeads"),
      ceoFounderLeads: total(executiveStats, "nbLeads"),
      positiveReplies: total(campaignStats, "nbLeadsInterested"),
      campaignCount: campaignIds.length,
      executiveCampaignCount: executiveCampaignIds.length,
      rangeDays,
      syncedAt: new Date().toISOString(),
    };

    memoryCache = {
      key: cacheKey,
      expiresAt: Date.now() + CACHE_TTL_MS,
      value,
    };

    return NextResponse.json(
      { success: true, data: value },
      {
        status: 200,
        headers: {
          "Cache-Control": "private, max-age=30",
          "X-Lemlist-Cache": "MISS",
        },
      }
    );
  } catch (error) {
    console.error("Unexpected /api/lemlist/analytics error:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to load lemlist analytics.",
      },
      {
        status: 502,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}