import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const META_ACCESS_TOKEN = process.env.META_ACCESS_TOKEN?.trim();
const META_AD_ACCOUNT_ID = process.env.META_AD_ACCOUNT_ID?.trim();
const META_API_VERSION = process.env.META_API_VERSION?.trim() || "v20.0";
const META_API_BASE_URL = "https://graph.facebook.com";

type MetaAction = {
  action_type?: string;
  value?: string | number;
};

type MetaInsight = {
  spend?: string | number;
  impressions?: string | number;
  reach?: string | number;
  clicks?: string | number;
  actions?: MetaAction[];
  publisher_platform?: string;
};

type MetaInsightsResponse = {
  data?: MetaInsight[];
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
  };
};

type PlatformStats = {
  reach: number;
  impressions: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  leads: number;
};

function getMetaDateRange(range: number): { date_start: string; date_stop: string; date_preset?: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  switch (range) {
    case 1: {
      const dateStr = today.toISOString().split("T")[0];
      return { date_start: dateStr, date_stop: dateStr, date_preset: "today" };
    }
    case 2:
      return { date_start: "", date_stop: "", date_preset: "last_3d" };
    case 7:
      return { date_start: "", date_stop: "", date_preset: "last_7d" };
    case 30:
      return { date_start: "", date_stop: "", date_preset: "last_30d" };
    case 90:
      return { date_start: "", date_stop: "", date_preset: "last_90d" };
    default:
      return { date_start: "", date_stop: "", date_preset: "last_7d" };
  }
}

function normalizeAdAccountId(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith("act_") ? trimmed : `act_${trimmed}`;
}

function parseNumber(value: string | number | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string | number | undefined): number {
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getActionValue(actions: MetaAction[] | undefined, types: string[]): number {
  if (!Array.isArray(actions)) return 0;

  return actions.reduce((total, action) => {
    const actionType = (action.action_type || "").toLowerCase();
    return types.includes(actionType) ? total + parseInteger(action.value) : total;
  }, 0);
}

function createPlatformStats(): PlatformStats {
  return {
    reach: 0,
    impressions: 0,
    clicks: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saves: 0,
    leads: 0,
  };
}

export async function GET(request: Request) {
  try {
    if (!META_ACCESS_TOKEN) {
      return NextResponse.json(
        { success: false, error: "META_ACCESS_TOKEN not configured" },
        { status: 500 }
      );
    }

    if (!META_AD_ACCOUNT_ID) {
      return NextResponse.json(
        { success: false, error: "META_AD_ACCOUNT_ID not configured" },
        { status: 500 }
      );
    }

    const url = new URL(request.url);
    const rangeParam = url.searchParams.get("range");
    const range = rangeParam ? parseInt(rangeParam, 10) : 7;

    const dateRange = getMetaDateRange(range);
    const adAccountId = normalizeAdAccountId(META_AD_ACCOUNT_ID);

    const params = new URLSearchParams();
    params.append("access_token", META_ACCESS_TOKEN);
    params.append("fields", "spend,impressions,reach,clicks,ctr,cpc,actions");
    params.append("breakdowns", "publisher_platform");
    params.append("level", "account");
    params.append("limit", "100");

    if (dateRange.date_preset) {
      params.append("date_preset", dateRange.date_preset);
    } else if (dateRange.date_start && dateRange.date_stop) {
      params.append(
        "time_range",
        JSON.stringify({ since: dateRange.date_start, until: dateRange.date_stop })
      );
    }

    const insightsUrl = `${META_API_BASE_URL}/${META_API_VERSION}/${adAccountId}/insights?${params.toString()}`;

    const response = await fetch(insightsUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });

    const data = (await response.json()) as MetaInsightsResponse;

    if (!response.ok) {
      console.error("Meta Insights API error:", data);
      return NextResponse.json(
        {
          success: false,
          error: data.error?.message || "Meta API error",
          details: {
            code: data.error?.code,
            subcode: data.error?.error_subcode,
            type: data.error?.type,
          },
        },
        { status: response.status }
      );
    }

    let totalSpend = 0;
    let totalImpressions = 0;
    let totalReach = 0;
    let totalClicks = 0;
    let totalLeads = 0;

    const platformBreakdown = {
      facebook: createPlatformStats(),
      instagram: createPlatformStats(),
      messenger: createPlatformStats(),
      audience_network: createPlatformStats(),
    };

    if (Array.isArray(data.data)) {
      data.data.forEach((insight) => {
        const spend = parseNumber(insight.spend);
        const impressions = parseInteger(insight.impressions);
        const reach = parseInteger(insight.reach);
        const clicks = parseInteger(insight.clicks);

        const leads = getActionValue(insight.actions, [
          "lead",
          "onsite_conversion.lead_grouped",
          "offsite_conversion.fb_pixel_lead",
          "omni_lead",
        ]);

        const likes = getActionValue(insight.actions, [
          "post_reaction",
          "like",
        ]);

        const comments = getActionValue(insight.actions, [
          "comment",
          "post_comment",
        ]);

        const shares = getActionValue(insight.actions, [
          "post",
          "share",
        ]);

        const saves = getActionValue(insight.actions, [
          "onsite_conversion.post_save",
          "post_save",
        ]);

        totalSpend += spend;
        totalImpressions += impressions;
        totalReach += reach;
        totalClicks += clicks;
        totalLeads += leads;

        const platform = (insight.publisher_platform || "").toLowerCase();

        if (platform in platformBreakdown) {
          const current = platformBreakdown[platform as keyof typeof platformBreakdown];

          current.reach += reach;
          current.impressions += impressions;
          current.clicks += clicks;
          current.likes += likes;
          current.comments += comments;
          current.shares += shares;
          current.saves += saves;
          current.leads += leads;
        }
      });
    }

    const totalLikes = platformBreakdown.facebook.likes + platformBreakdown.instagram.likes;
    const totalComments = platformBreakdown.facebook.comments + platformBreakdown.instagram.comments;
    const totalShares = platformBreakdown.facebook.shares + platformBreakdown.instagram.shares;
    const totalSaves = platformBreakdown.instagram.saves;

    const engagementTotal = totalLikes + totalComments + totalShares + totalSaves;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    const engagementRate = totalImpressions > 0 ? (engagementTotal / totalImpressions) * 100 : 0;

    return NextResponse.json({
      success: true,
      data: {
        spend: Number(totalSpend.toFixed(2)),
        impressions: totalImpressions,
        reach: totalReach,
        clicks: totalClicks,
        ctr: Number(ctr.toFixed(2)),
        cpc: Number(cpc.toFixed(2)),
        leads: totalLeads,

        facebook: platformBreakdown.facebook.clicks,
        instagram: platformBreakdown.instagram.clicks,
        messenger: platformBreakdown.messenger.clicks,
        audienceNetwork: platformBreakdown.audience_network.clicks,

        facebookReach: platformBreakdown.facebook.reach,
        facebookImpressions: platformBreakdown.facebook.impressions,
        facebookLikes: platformBreakdown.facebook.likes,
        facebookComments: platformBreakdown.facebook.comments,
        facebookShares: platformBreakdown.facebook.shares,
        facebookClicks: platformBreakdown.facebook.clicks,

        instagramReach: platformBreakdown.instagram.reach,
        instagramImpressions: platformBreakdown.instagram.impressions,
        instagramLikes: platformBreakdown.instagram.likes,
        instagramComments: platformBreakdown.instagram.comments,
        instagramSaves: platformBreakdown.instagram.saves,
        instagramClicks: platformBreakdown.instagram.clicks,

        likes: totalLikes,
        comments: totalComments,
        shares: totalShares,
        saves: totalSaves,
        engagementRate: Number(engagementRate.toFixed(2)),

        connected: true,
      },
    });
  } catch (error) {
    console.error("Meta Ads API route error:", error);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}