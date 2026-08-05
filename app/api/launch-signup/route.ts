import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

// ======================================================
// BREVO INTEGRATION
// TEMPORARILY DISABLED
//
// Current phase:
// Framer → API → Supabase
//
// Keep this code.
// Do not remove.
// Uncomment in Phase 2.
// ======================================================
import { brevoFetch } from "../../../lib/brevo/client";
import { getBrevoServerEnv } from "../../../lib/brevo/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 32 * 1024;
const DEFAULT_ORIGIN = "https://www.uppermost.store";

const ALLOWED_ORIGINS = new Set([
  "https://uppermost.store",
  "https://www.uppermost.store",
  "http://localhost:3000",
  "http://localhost:3001",
]);

type LaunchSignupBody = {
  email?: unknown;
  Email?: unknown;
  emailConsent?: unknown;
  source?: unknown;
  landingPage?: unknown;
  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  botField?: unknown;
};
class RequestValidationError extends Error {
  constructor(
    message: string,
    readonly field?: string,
    readonly status = 400
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

function isAllowedOrigin(origin: string | null): boolean {
  return (
    origin === null ||
    ALLOWED_ORIGINS.has(normalizeOrigin(origin))
  );
}

function corsHeaders(
  origin: string | null
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };

  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!origin) {
    headers["Access-Control-Allow-Origin"] = DEFAULT_ORIGIN;
  }

  return headers;
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

function cleanText(
  value: unknown,
  maxLength = 300
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = value.trim();

  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase()
    : "";
}

function isValidEmail(email: string): boolean {
  return (
    email.length <= 320 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

function normalizeConsent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") {
    // The Framer form may only contain an email field.
    // Consent is recorded through the disclosure shown under the form.
    return true;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(
      value.trim().toLowerCase()
    );
  }

  return false;
}

async function parseRequestBody(
  request: Request
): Promise<LaunchSignupBody> {
  const contentLength = Number(
    request.headers.get("content-length") ?? "0"
  );

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BYTES
  ) {
    throw new RequestValidationError(
      "Request body is too large.",
      undefined,
      413
    );
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    throw new RequestValidationError(
      "Request body is too large.",
      undefined,
      413
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError(
      "Invalid JSON request body."
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new RequestValidationError(
      "Request body must be a JSON object."
    );
  }

  return parsed as LaunchSignupBody;
}

async function findExistingLead(email: string) {
  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .select("id, email, metadata")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Lead lookup failed: ${error.message}`
    );
  }

  return data;
}

async function saveLaunchLead(args: {
  email: string;
  consent: boolean;
  source: string;
  landingPage: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  now: string;
}) {
  const existingLead = await findExistingLead(args.email);

  const existingMetadata =
    existingLead?.metadata &&
    typeof existingLead.metadata === "object" &&
    !Array.isArray(existingLead.metadata)
      ? existingLead.metadata
      : {};

  const metadata = {
    ...existingMetadata,
    source: args.source,
    signup_type: "launch_waitlist",
    lead_stage: "launch_waitlist",
    last_submitted_at: args.now,
  };

  if (existingLead) {
    const { data, error } = await supabaseAdmin
      .from("um_leads")
      .update({
        consent_email: args.consent,
        consent_recorded_at: args.now,
        lead_stage: "launch_waitlist",
        landing_page: args.landingPage,
        utm_source: args.utmSource,
        utm_medium: args.utmMedium,
        utm_campaign: args.utmCampaign,
        metadata,
        last_activity_at: args.now,
        updated_at: args.now,
      })
      .eq("id", existingLead.id)
      .select("id, email")
      .single();

    if (error || !data) {
      throw new Error(
        `Unable to update launch lead: ${
          error?.message ?? "Unknown database error"
        }`
      );
    }

    return {
      lead: data,
      created: false,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .insert({
      first_name: "Uppermost Visitor",
      email: args.email,
      consent_email: args.consent,
      consent_recorded_at: args.now,
      lead_stage: "launch_waitlist",
      landing_page: args.landingPage,
      utm_source: args.utmSource,
      utm_medium: args.utmMedium,
      utm_campaign: args.utmCampaign,
      metadata,
      last_activity_at: args.now,
      created_at: args.now,
      updated_at: args.now,
    })
    .select("id, email")
    .single();

  if (error || !data) {
    throw new Error(
      `Unable to create launch lead: ${
        error?.message ?? "Unknown database error"
      }`
    );
  }

  return {
    lead: data,
    created: true,
  };
}

// ======================================================
// BREVO INTEGRATION
// TEMPORARILY DISABLED
//
// Current phase:
// Framer → API → Supabase
//
// Keep this code.
// Do not remove.
// Uncomment in Phase 2.
// ======================================================
async function syncLaunchContactToBrevo(email: string) {
  const { BREVO_MARKETING_LIST_ID } =
    getBrevoServerEnv();

  const listId = Number(BREVO_MARKETING_LIST_ID);

  if (!Number.isInteger(listId) || listId <= 0) {
    throw new Error(
      "BREVO_MARKETING_LIST_ID must be a valid positive number."
    );
  }

  await brevoFetch("/contacts", {
    method: "POST",
    body: {
      email,
      listIds: [listId],
      updateEnabled: true,
    },
  });

  return {
    status: "synced" as const,
    listId,
  };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");

  if (!isAllowedOrigin(origin)) {
    return new NextResponse(null, {
      status: 403,
      headers: corsHeaders(origin),
    });
  }

  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(origin),
  });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");

  if (!isAllowedOrigin(origin)) {
    return jsonResponse(
      {
        success: false,
        error: "Origin is not allowed.",
      },
      403,
      origin
    );
  }

  try {
    console.log("Launch signup request received for lead capture");

    const body = await parseRequestBody(request);
    console.log("===== FRAMER PAYLOAD =====");
    console.log(JSON.stringify(body, null, 2));


    const botField = cleanText(body.botField, 200);

    // Honeypot: silently accept bot submissions.
    if (botField) {
      return jsonResponse(
        {
          success: true,
          message: "You are on the Uppermost list.",
        },
        200,
        origin
      );
    }

    const email = normalizeEmail(body.email ?? body.Email);

    if (!email || !isValidEmail(email)) {
      throw new RequestValidationError(
        "Please enter a valid email address.",
        "email"
      );
    }

    const consent = normalizeConsent(body.emailConsent);

    if (!consent) {
      throw new RequestValidationError(
        "Email consent is required.",
        "emailConsent"
      );
    }

    const now = new Date().toISOString();

    const source =
      cleanText(body.source, 100) ??
      "uppermost_launch_page";

    const landingPage =
      cleanText(body.landingPage, 1000) ??
      "https://uppermost.store";

    const { lead, created } = await saveLaunchLead({
      email,
      consent,
      source,
      landingPage,
      utmSource: cleanText(body.utmSource, 150),
      utmMedium: cleanText(body.utmMedium, 150),
      utmCampaign: cleanText(body.utmCampaign, 200),
      now,
    });

    console.log("Lead inserted into Supabase");

    const brevo = await syncLaunchContactToBrevo(email);

    console.log("Contact synced to Brevo", {
      email,
      listId: brevo.listId,
    });

    return jsonResponse(
      {
        success: true,
        created,
        leadSaved: true,
        brevoSynced: true,
        integrations: {
          brevo,
        },
        message: "Thank you. You're on the Uppermost waitlist.",
        lead: {
          id: lead.id,
          email: lead.email,
        },
      },
      created ? 201 : 200,
      origin
    );
  } catch (error) {
    if (error instanceof RequestValidationError) {
      return jsonResponse(
        {
          success: false,
          error: error.message,
          ...(error.field
            ? { field: error.field }
            : {}),
        },
        error.status,
        origin
      );
    }

    console.error("Insert failed", error);
    console.error(
      "Unexpected /api/launch-signup error:",
      error
    );

    return jsonResponse(
      {
        success: false,
        error:
          "Something went wrong. Please try again.",
      },
      500,
      origin
    );
  }
}