import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
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
  "http://localhost:3002",
  "http://localhost:3003",
]);

type LaunchSignupBody = {
  email?: unknown;
  Email?: unknown;
  phone?: unknown;
  mobile?: unknown;
  emailConsent?: unknown;
  consent?: unknown;
  whatsappConsent?: unknown;
  consentWhatsApp?: unknown;
  WhatsAppConsent?: unknown;
  consentText?: unknown;
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
  return origin === null || ALLOWED_ORIGINS.has(normalizeOrigin(origin));
}

function corsHeaders(origin: string | null): Record<string, string> {
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

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders(origin),
  });
}

function cleanText(value: unknown, maxLength = 300): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email: string): boolean {
  return email.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizePhone(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const digits = value.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length <= 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;

  return `+${digits}`;
}

function normalizeConsent(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
  }

  return false;
}

function normalizeOptionalConsent(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === "") return fallback;
  return normalizeConsent(value);
}

async function parseRequestBody(request: Request): Promise<LaunchSignupBody> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new RequestValidationError("Request body is too large.", undefined, 413);
  }

  const rawBody = await request.text();

  if (Buffer.byteLength(rawBody, "utf8") > MAX_REQUEST_BYTES) {
    throw new RequestValidationError("Request body is too large.", undefined, 413);
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawBody);
  } catch {
    throw new RequestValidationError("Invalid JSON request body.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestValidationError("Request body must be a JSON object.");
  }

  return parsed as LaunchSignupBody;
}

async function findExistingLead(email: string) {
  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .select("id, email, phone, metadata")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Lead lookup failed: ${error.message}`);
  }

  return data;
}

async function saveLaunchLead(args: {
  email: string;
  phone: string | null;
  emailConsent: boolean;
  whatsappConsent: boolean;
  consentText: string | null;
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

  const resolvedPhone = args.phone ?? existingLead?.phone ?? null;

  const metadata = {
    ...existingMetadata,
    source: args.source,
    signup_type: "launch_waitlist",
    lead_stage: "launch_waitlist",
    last_submitted_at: args.now,
    phone: resolvedPhone,
    consent_text: args.consentText,
    consent_email: args.emailConsent,
    consent_whatsapp: args.whatsappConsent,
  };

  if (existingLead) {
    const { data, error } = await supabaseAdmin
      .from("um_leads")
      .update({
        phone: resolvedPhone,
        consent_email: args.emailConsent,
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
      .select("id, email, phone")
      .single();

    if (error || !data) {
      throw new Error(`Unable to update launch lead: ${error?.message ?? "Unknown database error"}`);
    }

    return { lead: data, created: false };
  }

  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .insert({
      first_name: "Uppermost Visitor",
      email: args.email,
      phone: resolvedPhone,
      consent_email: args.emailConsent,
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
    .select("id, email, phone")
    .single();

  if (error || !data) {
    throw new Error(`Unable to create launch lead: ${error?.message ?? "Unknown database error"}`);
  }

  return { lead: data, created: true };
}

async function saveConsentRecords(args: {
  leadId: string;
  emailConsent: boolean;
  whatsappConsent: boolean;
  consentText: string | null;
}) {
  const rows = [];

  if (args.emailConsent) {
    rows.push({
      lead_id: args.leadId,
      channel: "email",
      granted: true,
      consent_text:
        args.consentText ??
        "User agreed to receive email communication from Uppermost.",
    });
  }

  if (args.whatsappConsent) {
    rows.push({
      lead_id: args.leadId,
      channel: "whatsapp",
      granted: true,
      consent_text:
        args.consentText ??
        "User agreed to receive WhatsApp communication from Uppermost.",
    });
  }

  if (rows.length === 0) {
    return {
      status: "skipped" as const,
      saved: false,
      count: 0,
    };
  }

  const channels = rows.map((row) => row.channel);

  await supabaseAdmin
    .from("consent_records")
    .delete()
    .eq("lead_id", args.leadId)
    .in("channel", channels);

  const { error } = await supabaseAdmin.from("consent_records").insert(rows);

  if (error) {
    throw new Error(`Consent record save failed: ${error.message}`);
  }

  return {
    status: "saved" as const,
    saved: true,
    count: rows.length,
    channels,
  };
}

async function syncLaunchContactToBrevo(args: {
  email: string;
  phone: string | null;
  consent: boolean;
  source: string;
  landingPage: string | null;
}) {
  const { BREVO_MARKETING_LIST_ID } = getBrevoServerEnv();
  const listId = Number(BREVO_MARKETING_LIST_ID);

  if (!Number.isInteger(listId) || listId <= 0) {
    throw new Error("BREVO_MARKETING_LIST_ID must be a valid positive number.");
  }

  console.log("Launch signup Brevo phone debug:", {
    email: args.email,
    phone: args.phone,
  });

  await brevoFetch("/contacts", {
    method: "POST",
    body: {
      email: args.email,
      attributes: {
        ...(args.phone
          ? {
              SMS: args.phone,
              WHATSAPP: args.phone,
              PHONE: args.phone,
              LANDLINE_NUMBER: args.phone,
            }
          : {}),
        CONSENT: String(args.consent),
        SIGNUP_SOURCE: args.source,
        LANDING_PAGE: args.landingPage || "",
      },
      listIds: [listId],
      updateEnabled: true,
    },
  });

  return {
    status: "synced" as const,
    listId,
  };
}

async function sendWelcomeEmail(email: string): Promise<boolean> {
  const { BREVO_WELCOME_TEMPLATE_ID } = getBrevoServerEnv();

  if (!BREVO_WELCOME_TEMPLATE_ID) return false;

  const templateId = Number(BREVO_WELCOME_TEMPLATE_ID);
  if (!Number.isInteger(templateId) || templateId <= 0) return false;

  await brevoFetch("/smtp/email", {
    method: "POST",
    body: {
      to: [{ email }],
      templateId,
    },
  });

  return true;
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
    return jsonResponse({ success: false, error: "Origin is not allowed." }, 403, origin);
  }

  try {
    const body = await parseRequestBody(request);

    const botField = cleanText(body.botField, 200);

    if (botField) {
      return jsonResponse(
        { success: true, message: "You are on the Uppermost list." },
        200,
        origin
      );
    }

    const email = normalizeEmail(body.email ?? body.Email);

    if (!email || !isValidEmail(email)) {
      throw new RequestValidationError("Please enter a valid email address.", "email");
    }

    const phone = normalizePhone(body.phone ?? body.mobile);

    console.log("Launch signup request debug:", {
      email,
      rawPhone: body.phone,
      rawMobile: body.mobile,
      normalizedPhone: phone,
    });

    const emailConsent = normalizeConsent(body.emailConsent ?? body.consent);

    if (!emailConsent) {
      throw new RequestValidationError("Email consent is required.", "emailConsent");
    }

    const whatsappConsent = normalizeOptionalConsent(
      body.whatsappConsent ?? body.consentWhatsApp ?? body.WhatsAppConsent,
      Boolean(phone && emailConsent)
    );

    const now = new Date().toISOString();
    const source = cleanText(body.source, 100) ?? "uppermost_launch_page";
    const landingPage = cleanText(body.landingPage, 1000) ?? "https://uppermost.store";
    const consentText = cleanText(body.consentText, 500);

    const { lead, created } = await saveLaunchLead({
      email,
      phone,
      emailConsent,
      whatsappConsent,
      consentText,
      source,
      landingPage,
      utmSource: cleanText(body.utmSource, 150),
      utmMedium: cleanText(body.utmMedium, 150),
      utmCampaign: cleanText(body.utmCampaign, 200),
      now,
    });

    const consentRecord = await saveConsentRecords({
      leadId: lead.id,
      emailConsent,
      whatsappConsent,
      consentText,
    });

    const brevo = await syncLaunchContactToBrevo({
      email,
      phone: lead.phone ?? phone,
      consent: emailConsent,
      source,
      landingPage,
    });

    let emailSent = false;

    try {
      emailSent = await sendWelcomeEmail(email);
    } catch (emailError) {
      console.error("Brevo welcome email failed:", emailError);
    }

    return jsonResponse(
      {
        success: true,
        created,
        leadSaved: true,
        consentSaved: consentRecord.saved,
        brevoSynced: true,
        emailSent,
        integrations: {
          consent: consentRecord,
          brevo,
        },
        message: "Thank you. You're on the Uppermost waitlist.",
        lead: {
          id: lead.id,
          email: lead.email,
          phone: lead.phone ?? phone,
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
          ...(error.field ? { field: error.field } : {}),
        },
        error.status,
        origin
      );
    }

    console.error("Unexpected /api/launch-signup error:", error);

    return jsonResponse(
      {
        success: false,
        error: "Something went wrong. Please try again.",
      },
      500,
      origin
    );
  }
}