import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type IntentConfig = {
  segment: string;
  recommendedProduct: string;
  templateFamily: string;
};

type LeadRequestBody = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  city?: string;
  country?: string;

 visitorId?: string;
 sessionId?: string;

  purpose?: string;
  productPreference?: string;

  consentEmail?: boolean;
  consentWhatsApp?: boolean;
  consentCall?: boolean;

  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;

  referrer?: string;
  landingPage?: string;
  device?: string;

  metadata?: Record<string, unknown>;
};

const INTENT_MAP: Record<string, IntentConfig> = {
  pregnancy: {
    segment: "pregnancy",
    recommendedProduct: "Gir Cow Ghee",
    templateFamily: "pregnancy_guide",
  },

  ritual: {
    segment: "ritual",
    recommendedProduct: "Gir Cow Ghee",
    templateFamily: "gir_ritual_guide",
  },

  ayurveda: {
    segment: "ayurveda",
    recommendedProduct: "Gir Cow Ghee",
    templateFamily: "wellness_guide",
  },

  taste: {
    segment: "taste",
    recommendedProduct: "Murrah Buffalo Ghee",
    templateFamily: "murrah_fitness_guide",
  },

  fitness: {
    segment: "fitness",
    recommendedProduct: "Murrah Buffalo Ghee",
    templateFamily: "murrah__guide",
  },

  family: {
  segment: "family_daily",
  recommendedProduct: "Gir Cow Ghee",
  templateFamily: "family_daily_guide",
},

  gifting: {
    segment: "gifting",
    recommendedProduct: "Curated Ghee Selection",
    templateFamily: "gift_guide",
  },

  comparison: {
    segment: "comparison",
    recommendedProduct: "Personalised Recommendation",
    templateFamily: "comparison_guide",
  },
};

const PURPOSE_ALIASES: Record<string, string> = {
  "pregnancy & family nourishment": "pregnancy",
  "puja & ritual foods": "ritual",
  "ayurveda & wellness": "ayurveda",
  "deep taste & everyday cooking": "taste",
  "strength & endurance": "fitness",
  "family health & daily nutrition": "family",
  "gift someone": "gifting",
  "help me choose": "comparison",

};

const LEMLIST_CAMPAIGN_MAP: Record<string, string> = {
  pregnancy: process.env.LEMLIST_CAMPAIGN_PREGNANCY ?? "",
  fitness: process.env.LEMLIST_CAMPAIGN_FITNESS ?? "",
  taste: process.env.LEMLIST_CAMPAIGN_TASTE ?? "",
  family_daily: process.env.LEMLIST_CAMPAIGN_FAMILY ?? "",
};

const ALLOWED_ORIGINS = new Set([
  "https://uppermost.store",
  "https://www.uppermost.store",
  "http://localhost:3000",
  "http://localhost:3001",
]);

function cleanText(value: unknown, maxLength = 300): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  if (!cleaned) {
    return null;
  }

  return cleaned.slice(0, maxLength);
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePurpose(value: unknown): string {
  const purpose = cleanText(value, 100)?.toLowerCase() ?? "";

  if (INTENT_MAP[purpose]) {
    return purpose;
  }

  return PURPOSE_ALIASES[purpose] ?? "";
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin =
    origin && ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://uppermost.store";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}
type LemlistLeadInput = {
  campaignId: string;
  email: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  purpose: string;
  segment: string;
  recommendedProduct: string;
  templateFamily: string;
  leadId: string;
};

async function addLeadToLemlist(input: LemlistLeadInput) {
  const apiKey = process.env.LEMLIST_API_KEY;

  if (!apiKey) {
    throw new Error("LEMLIST_API_KEY is missing.");
  }

  if (!input.campaignId) {
    throw new Error(
      `Lemlist campaign ID is missing for segment: ${input.segment}`
    );
  }
const endpoint =
  `https://api.lemlist.com/api/campaigns/` +
  `${encodeURIComponent(input.campaignId)}/leads/` +
  `${encodeURIComponent(input.email)}`;

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    Authorization: `Basic ${Buffer.from(`:${apiKey}`).toString("base64")}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName ?? "",
    phone: input.phone ?? "",
    purpose: input.purpose,
    segment: input.segment,
    recommendedProduct: input.recommendedProduct,
    templateFamily: input.templateFamily,
    uppermostLeadId: input.leadId,
  }),
});

  const responseText = await response.text();

  let responseBody: unknown = null;

  try {
    responseBody = responseText ? JSON.parse(responseText) : null;
  } catch {
    responseBody = responseText;
  }

 if (!response.ok) {
  const responseMessage =
    typeof responseBody === "string"
      ? responseBody
      : JSON.stringify(responseBody);

  const alreadyInCampaign =
    response.status === 400 &&
    responseMessage.toLowerCase().includes("already in the campaign");

  if (!alreadyInCampaign) {
    throw new Error(
      `Lemlist sync failed (${response.status}): ${responseMessage}`
    );
  }
}
  return responseBody;
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null
) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(origin),
  });
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  try {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return jsonResponse(
        {
          success: false,
          error: "Origin is not allowed.",
        },
        403,
        origin
      );
    }

    let body: LeadRequestBody;

    try {
      body = (await request.json()) as LeadRequestBody;
    } catch {
      return jsonResponse(
        {
          success: false,
          error: "Invalid JSON body.",
        },
        400,
        origin
      );
    }

    const firstName = cleanText(body.firstName, 80);
    const lastName = cleanText(body.lastName, 80);
    const email = normalizeEmail(body.email);
    const purpose = normalizePurpose(body.purpose);

    if (!firstName) {
      return jsonResponse(
        {
          success: false,
          error: "First name is required.",
          field: "firstName",
        },
        400,
        origin
      );
    }

    if (!email || !isValidEmail(email)) {
      return jsonResponse(
        {
          success: false,
          error: "A valid email address is required.",
          field: "email",
        },
        400,
        origin
      );
    }

    if (!purpose || !INTENT_MAP[purpose]) {
      return jsonResponse(
        {
          success: false,
          error: "A valid purpose is required.",
          field: "purpose",
        },
        400,
        origin
      );
    }

    if (body.consentEmail !== true) {
      return jsonResponse(
        {
          success: false,
          error: "Email consent is required to receive a recommendation.",
          field: "consentEmail",
        },
        400,
        origin
      );
    }

    const intent = INTENT_MAP[purpose];
    const now = new Date().toISOString();

    const leadPayload = {
      first_name: firstName,
      last_name: lastName,
      email,
      phone: cleanText(body.phone, 30),
      city: cleanText(body.city, 100),
      country: cleanText(body.country, 100),

      visitor_id: cleanText(body.visitorId, 150),
      session_id: cleanText(body.sessionId, 150),
      purpose,
      segment: intent.segment,
      product_preference: cleanText(body.productPreference, 100),
      recommended_product: intent.recommendedProduct,
      email_template_family: intent.templateFamily,

      consent_email: true,
      consent_whatsapp: body.consentWhatsApp === true,
      consent_call: body.consentCall === true,
      consent_recorded_at: now,

      utm_source: cleanText(body.utmSource, 150),
      utm_medium: cleanText(body.utmMedium, 150),
      utm_campaign: cleanText(body.utmCampaign, 200),
      utm_content: cleanText(body.utmContent, 200),
      utm_term: cleanText(body.utmTerm, 200),

      referrer: cleanText(body.referrer, 1000),
      landing_page: cleanText(body.landingPage, 1000),
      device: cleanText(body.device, 50),

      last_activity_at: now,

      metadata:
        body.metadata &&
        typeof body.metadata === "object" &&
        !Array.isArray(body.metadata)
          ? body.metadata
          : {},
    };

    const { data: existingLead, error: lookupError } = await supabaseAdmin
      .from("um_leads")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
  console.error("Lead lookup failed:", {
    email,
    error: lookupError,
  });

  return jsonResponse(
    {
      success: false,
      error: "Unable to check the existing lead.",
      debug: {
        code: lookupError.code,
        message: lookupError.message,
        details: lookupError.details,
        hint: lookupError.hint,
      },
    },
    500,
    origin
  );
}
    let leadId: string;
    let created = false;

    if (existingLead?.id) {
      const { data: updatedLead, error: updateError } = await supabaseAdmin
        .from("um_leads")
        .update(leadPayload)
        .eq("id", existingLead.id)
        .select("id")
        .single();

      if (updateError || !updatedLead) {
        console.error("Lead update failed:", {
          leadId: existingLead.id,
          error: updateError,
        });

        return jsonResponse(
          {
            success: false,
            error: "Unable to update the lead.",
          },
          500,
          origin
        );
      }

      leadId = updatedLead.id;
    } else {
      const { data: insertedLead, error: insertError } = await supabaseAdmin
        .from("um_leads")
        .insert(leadPayload)
        .select("id")
        .single();

      if (insertError || !insertedLead) {
        console.error("Lead insert failed:", {
          email,
          error: insertError,
        });

        return jsonResponse(
          {
            success: false,
            error: "Unable to create the lead.",
          },
          500,
          origin
        );
      }

      leadId = insertedLead.id;
      created = true;
    }

    const sessionId = cleanText(body.sessionId, 150);
    const eventKey = `popup_submitted:${leadId}:${sessionId ?? "no-session"}`;

    const { error: eventError } = await supabaseAdmin
      .from("um_lead_events")
     .insert({
    lead_id: leadId,
    visitor_id: cleanText(body.visitorId, 150),
    session_id: sessionId,
        event_name: "popup_submitted",
        event_key: eventKey,
        source: "website_popup", 
        page_url: cleanText(body.landingPage, 1000),
        metadata: {
          purpose,
          segment: intent.segment,
          product_preference:
            cleanText(body.productPreference, 100) ?? null,
        },
      });

    // Duplicate event_key means the same lead/session was submitted again.
    // That should not award popup points twice.
    if (eventError && eventError.code !== "23505") {
      console.error("Lead event insert failed:", {
        leadId,
        error: eventError,
      });

      return jsonResponse(
        {
          success: false,
          error: "Lead was saved, but its activity could not be recorded.",
        },
        500,
        origin
      );
    }
    const intentEventKey =
  `intent_selected:${leadId}:${sessionId ?? "no-session"}:${intent.segment}`;

const { error: intentEventError } = await supabaseAdmin
  .from("um_lead_events")
  .insert({
    lead_id: leadId,
    visitor_id: cleanText(body.visitorId, 150),
    session_id: sessionId,
    event_name: "intent_selected",
    event_key: intentEventKey,
    source: "website_popup",
    page_url: cleanText(body.landingPage, 1000),
    metadata: {
      purpose: purpose,
      intent: intent.segment,
      recommended_product: intent.recommendedProduct,
      popup_name: "ghee_recommendation",
    },
  });

if (intentEventError && intentEventError.code !== "23505") {
  console.error("Intent event insert failed:", {
    leadId,
    error: intentEventError,
  });
}
const campaignId = LEMLIST_CAMPAIGN_MAP[intent.segment];

if (!campaignId) {
  console.error("Lemlist campaign ID missing:", {
    purpose,
    segment: intent.segment,
  });

  return jsonResponse(
    {
      success: false,
      error: `Lemlist campaign is not configured for segment: ${intent.segment}`,
      leadSaved: true,
      leadId,
    },
    500,
    origin
  );
}

try {
  await addLeadToLemlist({
    campaignId,
    email,
    firstName,
    lastName,
    phone: cleanText(body.phone, 30),
    purpose,
    segment: intent.segment,
    recommendedProduct: intent.recommendedProduct,
    templateFamily: intent.templateFamily,
    leadId,
  });
} catch (lemlistError) {
  console.error("Lemlist enrollment failed:", {
    leadId,
    email,
    campaignId,
    error: lemlistError,
  });

  return jsonResponse(
    {
      success: false,
      error: "Lead was saved, but Lemlist enrollment failed.",
      leadSaved: true,
      leadId,
    },
    502,
    origin
  );
}
    const { data: finalLead, error: finalLeadError } = await supabaseAdmin
      .from("um_leads")
      .select(
        `
          id,
          first_name,
          email,
          purpose,
          segment,
          recommended_product,
          email_template_family,
          lead_score,
          status,
          human_followup_required
        `
      )
      .eq("id", leadId)
      .single();

    if (finalLeadError || !finalLead) {
      console.error("Final lead fetch failed:", {
        leadId,
        error: finalLeadError,
      });

      return jsonResponse(
        {
          success: false,
          error: "Lead was saved, but its final record could not be loaded.",
        },
        500,  
        origin
      );
    }

    return jsonResponse(
      {
        success: true,
        created,
        message: created
          ? "Your Uppermost recommendation is ready."
          : "Your Uppermost recommendation has been updated.",
        lead: {
          id: finalLead.id,
          firstName: finalLead.first_name,
          email: finalLead.email,
          purpose: finalLead.purpose,
          segment: finalLead.segment,
          recommendedProduct: finalLead.recommended_product,
          templateFamily: finalLead.email_template_family,
          leadScore: finalLead.lead_score,
          status: finalLead.status,
          humanFollowupRequired:
            finalLead.human_followup_required,
        },
      },
      created ? 201 : 200,
      origin
    );
  } catch (error) {
    console.error("Unexpected /api/lead error:", error);

    return jsonResponse(
      {
        success: false,
        error: "An unexpected server error occurred.",
      },
      500,
      origin
    );
  }
}