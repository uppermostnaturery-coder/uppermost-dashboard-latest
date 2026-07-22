import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;
const DEFAULT_ORIGIN = "https://www.uppermost.store";
const LEMLIST_API_BASE_URL = "https://api.lemlist.com/api";

type LeadStage = "email_completed" | "completed";
type CanonicalPurpose = "pregnancy" | "fitness" | "taste" | "family";
type PublicIntent =
  | "pregnancy"
  | "fitness"
  | "taste"
  | "family_health";

type IntentConfig = {
  publicIntent: PublicIntent;
  segment: string;
  recommendedProduct: string;
  templateFamily: string;
  campaignId: string;
};

type LeadRequestBody = {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  city?: unknown;
  country?: unknown;

  visitorId?: unknown;
  sessionId?: unknown;

  purpose?: unknown;
  intent?: unknown;
  stage?: unknown;
  productPreference?: unknown;

  consentEmail?: unknown;
  marketingConsent?: unknown;
  consentWhatsApp?: unknown;
  consentCall?: unknown;

  utmSource?: unknown;
  utmMedium?: unknown;
  utmCampaign?: unknown;
  utmContent?: unknown;
  utmTerm?: unknown;

  referrer?: unknown;
  landingPage?: unknown;
  device?: unknown;

  metadata?: unknown;
};

type ExistingLead = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  purpose: string | null;
  segment: string | null;
  consent_email: boolean | null;
  purposes: unknown;
  purpose_history: unknown;
  metadata: unknown;
};

type ConsentValue = {
  provided: boolean;
  value: boolean;
};

type NormalizedLeadInput = {
  firstName: string | null;
  lastName: string | null;
  email: string;
  phone: string | null;
  city: string | null;
  country: string | null;
  visitorId: string | null;
  sessionId: string | null;
  purpose: CanonicalPurpose;
  intent: IntentConfig;
  stage: LeadStage;
  productPreference: string | null;
  marketingConsent: ConsentValue;
  consentWhatsApp: ConsentValue;
  consentCall: ConsentValue;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  landingPage: string | null;
  device: string | null;
  metadata: Record<string, unknown>;
  submissionKey: string;
};

type LemlistLead = {
  _id: string;
  email?: string;
  campaignId?: string;
  isPaused?: boolean;
};

type LemlistSyncStatus =
  | "added"
  | "updated"
  | "switched"
  | "paused_no_consent"
  | "skipped_no_consent"
  | "failed";

type LemlistSyncResult = {
  status: LemlistSyncStatus;
  campaignId: string | null;
  previousCampaignId: string | null;
  message?: string;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
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

class LemlistApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody: unknown
  ) {
    super(message);
    this.name = "LemlistApiError";
  }
}

const INTENT_MAP: Record<CanonicalPurpose, IntentConfig> = {
  pregnancy: {
    publicIntent: "pregnancy",
    segment: "pregnancy",
    recommendedProduct: "Gir Cow Ghee",
    templateFamily: "pregnancy_guide",
    campaignId:
      process.env.LEMLIST_CAMPAIGN_PREGNANCY ??
      "cam_mHjzL8YeDDhyNgs2j",
  },
  fitness: {
    publicIntent: "fitness",
    segment: "fitness",
    recommendedProduct: "Murrah Buffalo Ghee",
    templateFamily: "murrah_fitness_guide",
    campaignId:
      process.env.LEMLIST_CAMPAIGN_FITNESS ??
      "cam_hNBkKi8LJyoXEyvzz",
  },
  taste: {
    publicIntent: "taste",
    segment: "taste",
    recommendedProduct: "Murrah Buffalo Ghee",
    templateFamily: "murrah_taste_guide",
    campaignId:
      process.env.LEMLIST_CAMPAIGN_TASTE ??
      "cam_bdWqwStqBpkbZ2pbj",
  },
  family: {
    publicIntent: "family_health",
    segment: "family_daily",
    recommendedProduct: "Gir Cow Ghee",
    templateFamily: "family_daily_guide",
    campaignId:
      process.env.LEMLIST_CAMPAIGN_FAMILY_HEALTH ??
      process.env.LEMLIST_CAMPAIGN_FAMILY ??
      "cam_QtE9Pcyefp9KPEZ94",
  },
};

const PURPOSE_ALIASES: Record<string, CanonicalPurpose> = {
  pregnancy: "pregnancy",
  maternal: "pregnancy",
  "pregnancy maternal": "pregnancy",
  "pregnancy / maternal": "pregnancy",
  "pregnancy & maternal": "pregnancy",
  "pregnancy & family nourishment": "pregnancy",

  fitness: "fitness",
  "strength & endurance": "fitness",

  taste: "taste",
  "deep taste & everyday cooking": "taste",

  family: "family",
  "family health": "family",
  "family daily": "family",
  "family health & daily nutrition": "family",
};

const STAGE_ALIASES: Record<string, LeadStage> = {
  email: "email_completed",
  "email completed": "email_completed",
  email_completed: "email_completed",
  phone: "completed",
  complete: "completed",
  completed: "completed",
};

const ALLOWED_ORIGINS = new Set(
  [
    "https://uppermost.store",
    "https://www.uppermost.store",
    "http://localhost:3000",
    "http://localhost:3001",
    ...(process.env.LEAD_API_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  ].map(normalizeOrigin)
);

const KNOWN_LEMLIST_CAMPAIGN_IDS = new Set(
  Object.values(INTENT_MAP)
    .map((config) => config.campaignId)
    .filter(Boolean)
);

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/+$/, "").toLowerCase();
}

function isAllowedOrigin(origin: string | null): boolean {
  return origin === null || ALLOWED_ORIGINS.has(normalizeOrigin(origin));
}

function corsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, X-Idempotency-Key",
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

function normalizeLookupKey(value: unknown): string {
  return (
    cleanText(value, 100)
      ?.toLowerCase()
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ") ?? ""
  );
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

function normalizePhone(value: unknown): string | null {
  const rawPhone = cleanText(value, 30);

  if (!rawPhone) {
    return null;
  }

  const normalized = rawPhone
    .replace(/^00/, "+")
    .replace(/[\s().-]/g, "");

  if (!/^\+?\d{7,15}$/.test(normalized)) {
    throw new RequestValidationError(
      "A valid phone number is required.",
      "phone"
    );
  }

  return normalized;
}

function normalizePurposeValue(
  purposeValue: unknown,
  intentValue: unknown
): CanonicalPurpose {
  const normalizedPurpose = PURPOSE_ALIASES[
    normalizeLookupKey(purposeValue)
  ];
  const normalizedIntent = PURPOSE_ALIASES[
    normalizeLookupKey(intentValue)
  ];

  if (
    normalizedPurpose &&
    normalizedIntent &&
    normalizedPurpose !== normalizedIntent
  ) {
    throw new RequestValidationError(
      "Purpose and intent must refer to the same selection.",
      "intent"
    );
  }

  const purpose = normalizedIntent ?? normalizedPurpose;

  if (!purpose) {
    throw new RequestValidationError(
      "A valid purpose or intent is required.",
      "purpose"
    );
  }

  return purpose;
}

function normalizeStage(
  value: unknown,
  phone: string | null
): LeadStage {
  if (value === undefined || value === null || value === "") {
    return phone ? "completed" : "email_completed";
  }

  const rawStage =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  const lookupKey = normalizeLookupKey(value);
  const stage = STAGE_ALIASES[rawStage] ?? STAGE_ALIASES[lookupKey];

  if (!stage) {
    throw new RequestValidationError(
      "Stage must be email_completed or completed.",
      "stage"
    );
  }

  return stage;
}

function readBoolean(
  value: unknown,
  field: string
): ConsentValue {
  if (value === undefined) {
    return { provided: false, value: false };
  }

  if (typeof value !== "boolean") {
    throw new RequestValidationError(
      `${field} must be a boolean.`,
      field
    );
  }

  return { provided: true, value };
}

function resolveMarketingConsent(
  body: LeadRequestBody
): ConsentValue {
  const consentEmail = readBoolean(
    body.consentEmail,
    "consentEmail"
  );
  const marketingConsent = readBoolean(
    body.marketingConsent,
    "marketingConsent"
  );

  if (
    consentEmail.provided &&
    marketingConsent.provided &&
    consentEmail.value !== marketingConsent.value
  ) {
    throw new RequestValidationError(
      "consentEmail and marketingConsent must match.",
      "marketingConsent"
    );
  }

  return marketingConsent.provided
    ? marketingConsent
    : consentEmail;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is string => typeof item === "string"
      )
    : [];
}

function asRecordArray(
  value: unknown
): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(
            item &&
              typeof item === "object" &&
              !Array.isArray(item)
          )
      )
    : [];
}

function hasOwn(
  value: object,
  key: string
): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildSubmissionKey(
  request: Request,
  sessionId: string | null,
  visitorId: string | null,
  stage: LeadStage,
  purpose: CanonicalPurpose,
  now: string
): string {
  const explicitKey = cleanText(
    request.headers.get("x-idempotency-key"),
    200
  );

  if (explicitKey) {
    return explicitKey;
  }

  const identity = sessionId ?? visitorId ?? now;
  return `${identity}:${stage}:${purpose}`;
}

async function parseRequestBody(
  request: Request
): Promise<LeadRequestBody> {
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
    throw new RequestValidationError("Invalid JSON body.");
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

  return parsed as LeadRequestBody;
}

function normalizeLeadInput(
  body: LeadRequestBody,
  request: Request,
  now: string
): NormalizedLeadInput {
  const email = normalizeEmail(body.email);

  if (!email || !isValidEmail(email)) {
    throw new RequestValidationError(
      "A valid email address is required.",
      "email"
    );
  }

  const firstName = cleanText(body.firstName, 80);

  if (hasOwn(body, "firstName") && !firstName) {
    throw new RequestValidationError(
      "First name cannot be empty.",
      "firstName"
    );
  }

  const phone = normalizePhone(body.phone);
  const purpose = normalizePurposeValue(
    body.purpose,
    body.intent
  );
  const intent = INTENT_MAP[purpose];
  const stage = normalizeStage(body.stage, phone);

  if (stage === "completed" && !phone) {
    throw new RequestValidationError(
      "Phone number is required when stage is completed.",
      "phone"
    );
  }

  const visitorId = cleanText(body.visitorId, 150);
  const sessionId = cleanText(body.sessionId, 150);

  if (
    body.metadata !== undefined &&
    (!body.metadata ||
      typeof body.metadata !== "object" ||
      Array.isArray(body.metadata))
  ) {
    throw new RequestValidationError(
      "metadata must be a JSON object.",
      "metadata"
    );
  }

  return {
    firstName,
    lastName: cleanText(body.lastName, 80),
    email,
    phone,
    city: cleanText(body.city, 100),
    country: cleanText(body.country, 100),
    visitorId,
    sessionId,
    purpose,
    intent,
    stage,
    productPreference: cleanText(
      body.productPreference,
      100
    ),
    marketingConsent: resolveMarketingConsent(body),
    consentWhatsApp: readBoolean(
      body.consentWhatsApp,
      "consentWhatsApp"
    ),
    consentCall: readBoolean(
      body.consentCall,
      "consentCall"
    ),
    utmSource: cleanText(body.utmSource, 150),
    utmMedium: cleanText(body.utmMedium, 150),
    utmCampaign: cleanText(body.utmCampaign, 200),
    utmContent: cleanText(body.utmContent, 200),
    utmTerm: cleanText(body.utmTerm, 200),
    referrer: cleanText(body.referrer, 1000),
    landingPage: cleanText(body.landingPage, 1000),
    device: cleanText(body.device, 50),
    metadata: asRecord(body.metadata),
    submissionKey: buildSubmissionKey(
      request,
      sessionId,
      visitorId,
      stage,
      purpose,
      now
    ),
  };
}

function isUniqueViolation(
  error: SupabaseErrorLike | null
): boolean {
  return error?.code === "23505";
}

function isMissingStageColumn(
  error: SupabaseErrorLike | null
): boolean {
  return Boolean(
    error &&
      (error.code === "PGRST204" ||
        error.code === "42703") &&
      error.message?.toLowerCase().includes("stage")
  );
}

function withoutStage(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const fallbackPayload = { ...payload };
  delete fallbackPayload.stage;
  return fallbackPayload;
}

async function findLeadByEmail(
  email: string
): Promise<ExistingLead | null> {
  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .select(
      `
        id,
        first_name,
        last_name,
        phone,
        purpose,
        segment,
        consent_email,
        purposes,
        purpose_history,
        metadata
      `
    )
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Lead lookup failed: ${error.message}`
    );
  }

  return (data as ExistingLead | null) ?? null;
}

function buildHistory(
  existingLead: ExistingLead | null,
  input: NormalizedLeadInput,
  now: string
): Array<Record<string, unknown>> {
  const history = asRecordArray(
    existingLead?.purpose_history
  );
  const alreadyRecorded = history.some(
    (entry) =>
      entry.submission_key === input.submissionKey
  );

  if (alreadyRecorded) {
    return history;
  }

  return [
    ...history,
    {
      purpose: input.purpose,
      intent: input.intent.publicIntent,
      segment: input.intent.segment,
      stage: input.stage,
      submission_key: input.submissionKey,
      recorded_at: now,
    },
  ];
}

function buildMetadata(
  existingLead: ExistingLead | null,
  input: NormalizedLeadInput,
  now: string
): Record<string, unknown> {
  return {
    ...asRecord(existingLead?.metadata),
    ...input.metadata,
    lead_stage: input.stage,
    current_intent: input.intent.publicIntent,
    last_submission_key: input.submissionKey,
    last_submitted_at: now,
  };
}

function addOptionalText(
  payload: Record<string, unknown>,
  key: string,
  value: string | null
): void {
  if (value !== null) {
    payload[key] = value;
  }
}

function buildInsertPayload(
  input: NormalizedLeadInput,
  now: string
): Record<string, unknown> {
  if (!input.firstName) {
    throw new RequestValidationError(
      "First name is required for a new lead.",
      "firstName"
    );
  }

  return {
    first_name: input.firstName,
    last_name: input.lastName,
    email: input.email,
    phone: input.phone,
    city: input.city,
    country: input.country,

    visitor_id: input.visitorId,
    session_id: input.sessionId,

    purpose: input.purpose,
    segment: input.intent.segment,
    product_preference: input.productPreference,
    recommended_product: input.intent.recommendedProduct,
    email_template_family: input.intent.templateFamily,
    stage: input.stage,

    consent_email: input.marketingConsent.provided
      ? input.marketingConsent.value
      : false,
    consent_whatsapp: input.consentWhatsApp.provided
      ? input.consentWhatsApp.value
      : false,
    consent_call: input.consentCall.provided
      ? input.consentCall.value
      : false,
    consent_recorded_at: input.marketingConsent.provided
      ? now
      : null,

    utm_source: input.utmSource,
    utm_medium: input.utmMedium,
    utm_campaign: input.utmCampaign,
    utm_content: input.utmContent,
    utm_term: input.utmTerm,

    referrer: input.referrer,
    landing_page: input.landingPage,
    device: input.device,

    purposes: [input.purpose],
    purpose_history: buildHistory(null, input, now),
    metadata: buildMetadata(null, input, now),
    last_activity_at: now,
  };
}

function buildUpdatePayload(
  existingLead: ExistingLead,
  input: NormalizedLeadInput,
  now: string
): Record<string, unknown> {
  const previousPurposes = asStringArray(
    existingLead.purposes
  );
  const updatedPurposes = Array.from(
    new Set([...previousPurposes, input.purpose])
  );

  const payload: Record<string, unknown> = {
    email: input.email,
    purpose: input.purpose,
    segment: input.intent.segment,
    recommended_product: input.intent.recommendedProduct,
    email_template_family: input.intent.templateFamily,
    stage: input.stage,
    purposes: updatedPurposes,
    purpose_history: buildHistory(
      existingLead,
      input,
      now
    ),
    metadata: buildMetadata(existingLead, input, now),
    last_activity_at: now,
  };

  addOptionalText(payload, "first_name", input.firstName);
  addOptionalText(payload, "last_name", input.lastName);
  addOptionalText(payload, "phone", input.phone);
  addOptionalText(payload, "city", input.city);
  addOptionalText(payload, "country", input.country);
  addOptionalText(payload, "visitor_id", input.visitorId);
  addOptionalText(payload, "session_id", input.sessionId);
  addOptionalText(
    payload,
    "product_preference",
    input.productPreference
  );
  addOptionalText(payload, "utm_source", input.utmSource);
  addOptionalText(payload, "utm_medium", input.utmMedium);
  addOptionalText(
    payload,
    "utm_campaign",
    input.utmCampaign
  );
  addOptionalText(payload, "utm_content", input.utmContent);
  addOptionalText(payload, "utm_term", input.utmTerm);
  addOptionalText(payload, "referrer", input.referrer);
  addOptionalText(
    payload,
    "landing_page",
    input.landingPage
  );
  addOptionalText(payload, "device", input.device);

  if (input.marketingConsent.provided) {
    payload.consent_email =
      input.marketingConsent.value;
    payload.consent_recorded_at = now;
  }

  if (input.consentWhatsApp.provided) {
    payload.consent_whatsapp =
      input.consentWhatsApp.value;
  }

  if (input.consentCall.provided) {
    payload.consent_call = input.consentCall.value;
  }

  return payload;
}

async function insertLead(
  payload: Record<string, unknown>
): Promise<{
  id: string | null;
  error: SupabaseErrorLike | null;
}> {
  let result = await supabaseAdmin
    .from("um_leads")
    .insert(payload)
    .select("id")
    .single();

  if (isMissingStageColumn(result.error)) {
    result = await supabaseAdmin
      .from("um_leads")
      .insert(withoutStage(payload))
      .select("id")
      .single();
  }

  return {
    id:
      result.data &&
      typeof result.data.id === "string"
        ? result.data.id
        : null,
    error: result.error,
  };
}

async function updateLead(
  leadId: string,
  payload: Record<string, unknown>
): Promise<{
  id: string | null;
  error: SupabaseErrorLike | null;
}> {
  let result = await supabaseAdmin
    .from("um_leads")
    .update(payload)
    .eq("id", leadId)
    .select("id")
    .single();

  if (isMissingStageColumn(result.error)) {
    result = await supabaseAdmin
      .from("um_leads")
      .update(withoutStage(payload))
      .eq("id", leadId)
      .select("id")
      .single();
  }

  return {
    id:
      result.data &&
      typeof result.data.id === "string"
        ? result.data.id
        : null,
    error: result.error,
  };
}

async function saveLead(
  existingLead: ExistingLead | null,
  input: NormalizedLeadInput,
  now: string
): Promise<{
  leadId: string;
  created: boolean;
  previousLead: ExistingLead | null;
}> {
  if (existingLead) {
    const result = await updateLead(
      existingLead.id,
      buildUpdatePayload(existingLead, input, now)
    );

    if (result.error || !result.id) {
      console.error("Lead update failed:", {
        leadId: existingLead.id,
        code: result.error?.code,
        message: result.error?.message,
      });
      throw new Error("Unable to update the lead.");
    }

    return {
      leadId: result.id,
      created: false,
      previousLead: existingLead,
    };
  }

  const insertResult = await insertLead(
    buildInsertPayload(input, now)
  );

  if (insertResult.id) {
    return {
      leadId: insertResult.id,
      created: true,
      previousLead: null,
    };
  }

  if (!isUniqueViolation(insertResult.error)) {
    console.error("Lead insert failed:", {
      email: input.email,
      code: insertResult.error?.code,
      message: insertResult.error?.message,
    });
    throw new Error("Unable to create the lead.");
  }

  const concurrentLead = await findLeadByEmail(input.email);

  if (!concurrentLead) {
    throw new Error(
      "The lead already exists but could not be loaded."
    );
  }

  const updateResult = await updateLead(
    concurrentLead.id,
    buildUpdatePayload(concurrentLead, input, now)
  );

  if (updateResult.error || !updateResult.id) {
    console.error("Concurrent lead update failed:", {
      leadId: concurrentLead.id,
      code: updateResult.error?.code,
      message: updateResult.error?.message,
    });
    throw new Error("Unable to update the existing lead.");
  }

  return {
    leadId: updateResult.id,
    created: false,
    previousLead: concurrentLead,
  };
}

async function recordLeadEvent(
  leadId: string,
  input: NormalizedLeadInput
): Promise<string | null> {
  const eventName =
    input.stage === "completed"
      ? "lead_form_completed"
      : "lead_email_submitted";
  const eventKey =
    `${eventName}:${leadId}:${input.submissionKey}`;

  const { error } = await supabaseAdmin
    .from("um_lead_events")
    .insert({
      lead_id: leadId,
      visitor_id: input.visitorId,
      session_id: input.sessionId,
      event_name: eventName,
      event_key: eventKey,
      source: "website_popup",
      page_url: input.landingPage,
      metadata: {
        purpose: input.purpose,
        intent: input.intent.publicIntent,
        segment: input.intent.segment,
        stage: input.stage,
        recommended_product:
          input.intent.recommendedProduct,
        popup_name: "ghee_recommendation",
      },
    });

  if (!error || error.code === "23505") {
    return null;
  }

  console.error("Lead event insert failed:", {
    leadId,
    code: error.code,
    message: error.message,
  });

  return "Lead was saved, but its activity event was not recorded.";
}

function lemlistAuthorizationHeader(): string {
  const apiKey = process.env.LEMLIST_API_KEY;

  if (!apiKey) {
    throw new Error("LEMLIST_API_KEY is missing.");
  }

  return `Basic ${Buffer.from(`:${apiKey}`).toString(
    "base64"
  )}`;
}

async function parseFetchResponse(
  response: Response
): Promise<unknown> {
  const responseText = await response.text();

  if (!responseText) {
    return null;
  }

  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

function responseBodyText(body: unknown): string {
  return typeof body === "string"
    ? body
    : JSON.stringify(body);
}

async function lemlistRequest(
  path: string,
  init: RequestInit
): Promise<unknown> {
  const response = await fetch(
    `${LEMLIST_API_BASE_URL}${path}`,
    {
      ...init,
      headers: {
        Authorization: lemlistAuthorizationHeader(),
        ...(init.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    }
  );

  const responseBody = await parseFetchResponse(response);

  if (!response.ok) {
    throw new LemlistApiError(
      `Lemlist request failed (${response.status}): ${responseBodyText(
        responseBody
      )}`,
      response.status,
      responseBody
    );
  }

  return responseBody;
}

function isLemlistLead(value: unknown): value is LemlistLead {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as LemlistLead)._id === "string"
  );
}

async function getLemlistLeadByEmail(
  email: string
): Promise<LemlistLead | null> {
  const query = new URLSearchParams({
    email,
    version: "v2",
  });

  try {
    const response = await lemlistRequest(
      `/leads?${query.toString()}`,
      { method: "GET" }
    );

    return isLemlistLead(response) ? response : null;
  } catch (error) {
    if (error instanceof LemlistApiError) {
      const message = responseBodyText(
        error.responseBody
      ).toLowerCase();

      if (
        error.status === 404 ||
        (error.status === 400 &&
          message.includes("lead not found"))
      ) {
        return null;
      }
    }

    throw error;
  }
}

function lemlistLeadPayload(
  input: NormalizedLeadInput,
  leadId: string,
  firstName: string,
  lastName: string | null,
  phone: string | null
): Record<string, unknown> {
  return {
    email: input.email,
    firstName,
    lastName: lastName ?? "",
    phone: phone ?? "",
    purpose: input.purpose,
    intent: input.intent.publicIntent,
    segment: input.intent.segment,
    recommendedProduct:
      input.intent.recommendedProduct,
    templateFamily: input.intent.templateFamily,
    uppermostLeadId: leadId,
    leadStage: input.stage,
  };
}

async function pauseLemlistLead(
  lead: LemlistLead,
  campaignId: string
): Promise<void> {
  if (!KNOWN_LEMLIST_CAMPAIGN_IDS.has(campaignId)) {
    throw new Error(
      "Refusing to pause a lead in an unknown Lemlist campaign."
    );
  }

  const query = new URLSearchParams({
    campaignId,
  });

  await lemlistRequest(
    `/leads/pause/${encodeURIComponent(
      lead._id
    )}?${query.toString()}`,
    { method: "POST" }
  );
}

async function resumeLemlistLead(
  lead: LemlistLead,
  campaignId: string
): Promise<void> {
  const query = new URLSearchParams({
    campaignId,
  });

  await lemlistRequest(
    `/leads/start/${encodeURIComponent(
      lead._id
    )}?${query.toString()}`,
    { method: "POST" }
  );
}

async function updateLemlistLead(
  lead: LemlistLead,
  campaignId: string,
  input: NormalizedLeadInput,
  leadId: string,
  firstName: string,
  lastName: string | null,
  phone: string | null
): Promise<void> {
  const payload = lemlistLeadPayload(
    input,
    leadId,
    firstName,
    lastName,
    phone
  );

  await lemlistRequest(
    `/campaigns/${encodeURIComponent(
      campaignId
    )}/leads/${encodeURIComponent(lead._id)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        firstName: payload.firstName,
        lastName: payload.lastName,
        phone: payload.phone,
      }),
    }
  );

  const variables = new URLSearchParams({
    purpose: input.purpose,
    intent: input.intent.publicIntent,
    segment: input.intent.segment,
    recommendedProduct:
      input.intent.recommendedProduct,
    templateFamily: input.intent.templateFamily,
    uppermostLeadId: leadId,
    leadStage: input.stage,
  });

  await lemlistRequest(
    `/leads/${encodeURIComponent(
      lead._id
    )}/variables?${variables.toString()}`,
    { method: "PATCH" }
  );
}

async function createLemlistLead(
  campaignId: string,
  input: NormalizedLeadInput,
  leadId: string,
  firstName: string,
  lastName: string | null,
  phone: string | null
): Promise<void> {
  await lemlistRequest(
    `/campaigns/${encodeURIComponent(
      campaignId
    )}/leads/`,
    {
      method: "POST",
      body: JSON.stringify(
        lemlistLeadPayload(
          input,
          leadId,
          firstName,
          lastName,
          phone
        )
      ),
    }
  );
}

function isAlreadyInCampaignError(
  error: unknown
): boolean {
  if (!(error instanceof LemlistApiError)) {
    return false;
  }

  const message = responseBodyText(
    error.responseBody
  ).toLowerCase();

  return (
    error.status === 400 &&
    (message.includes("already in the campaign") ||
      message.includes("already exists"))
  );
}

async function syncLeadToLemlist(
  input: NormalizedLeadInput,
  leadId: string,
  previousLead: ExistingLead | null
): Promise<LemlistSyncResult> {
  const targetCampaignId = input.intent.campaignId;
  const effectiveConsent = input.marketingConsent.provided
    ? input.marketingConsent.value
    : previousLead?.consent_email === true;

  if (!process.env.LEMLIST_API_KEY) {
    return {
      status: "failed",
      campaignId: effectiveConsent
        ? targetCampaignId
        : null,
      previousCampaignId: null,
      message: "LEMLIST_API_KEY is not configured.",
    };
  }

  try {
    let remoteLead = await getLemlistLeadByEmail(
      input.email
    );
    const remoteCampaignId =
      remoteLead?.campaignId ?? null;

    if (!effectiveConsent) {
      if (
        remoteLead &&
        remoteCampaignId &&
        KNOWN_LEMLIST_CAMPAIGN_IDS.has(remoteCampaignId)
      ) {
        await pauseLemlistLead(
          remoteLead,
          remoteCampaignId
        );

        return {
          status: "paused_no_consent",
          campaignId: null,
          previousCampaignId: remoteCampaignId,
        };
      }

      return {
        status: "skipped_no_consent",
        campaignId: null,
        previousCampaignId: remoteCampaignId,
        ...(remoteLead
          ? {
              message:
                "No configured Uppermost Lemlist campaign was paused.",
            }
          : {}),
      };
    }

    if (!targetCampaignId) {
      return {
        status: "failed",
        campaignId: null,
        previousCampaignId: remoteCampaignId,
        message:
          "The Lemlist campaign is not configured for this intent.",
      };
    }

    let switched = false;

    if (
      remoteLead &&
      remoteCampaignId &&
      remoteCampaignId !== targetCampaignId
    ) {
      if (
        KNOWN_LEMLIST_CAMPAIGN_IDS.has(remoteCampaignId)
      ) {
        await pauseLemlistLead(
          remoteLead,
          remoteCampaignId
        );
        switched = true;
      }

      remoteLead = null;
    }

    const effectiveFirstName =
      input.firstName ??
      previousLead?.first_name ??
      "Uppermost Customer";
    const effectiveLastName =
      input.lastName ?? previousLead?.last_name ?? null;
    const effectivePhone =
      input.phone ?? previousLead?.phone ?? null;

    if (
      remoteLead &&
      remoteLead.campaignId === targetCampaignId
    ) {
      if (remoteLead.isPaused) {
        await resumeLemlistLead(
          remoteLead,
          targetCampaignId
        );
      }

      await updateLemlistLead(
        remoteLead,
        targetCampaignId,
        input,
        leadId,
        effectiveFirstName,
        effectiveLastName,
        effectivePhone
      );

      return {
        status: switched ? "switched" : "updated",
        campaignId: targetCampaignId,
        previousCampaignId: remoteCampaignId,
      };
    }

    try {
      await createLemlistLead(
        targetCampaignId,
        input,
        leadId,
        effectiveFirstName,
        effectiveLastName,
        effectivePhone
      );
    } catch (error) {
      if (!isAlreadyInCampaignError(error)) {
        throw error;
      }

      const existingRemoteLead =
        await getLemlistLeadByEmail(input.email);

      if (
        !existingRemoteLead ||
        existingRemoteLead.campaignId !==
          targetCampaignId
      ) {
        throw error;
      }

      await updateLemlistLead(
        existingRemoteLead,
        targetCampaignId,
        input,
        leadId,
        effectiveFirstName,
        effectiveLastName,
        effectivePhone
      );
    }

    return {
      status: switched ? "switched" : "added",
      campaignId: targetCampaignId,
      previousCampaignId: remoteCampaignId,
    };
 } catch (error) {
  console.error("Lemlist sync failed:", {
    leadId,
    email: input.email,
    error,
  });

  if (error instanceof LemlistApiError) {
    return {
      status: "failed",
      campaignId: targetCampaignId || null,
      previousCampaignId: null,
      message: `Lemlist API failed with status ${error.status}: ${responseBodyText(
        error.responseBody
      )}`,
    };
  }

  return {
    status: "failed",
    campaignId: targetCampaignId || null,
    previousCampaignId: null,
    message:
      error instanceof Error
        ? error.message
        : "Unknown Lemlist synchronization failure.",
  };
}
}
async function loadFinalLead(leadId: string) {
  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .select(
      `
        id,
        first_name,
        email,
        phone,
        purpose,
        segment,
        recommended_product,
        email_template_family,
        consent_email,
        lead_score,
        status,
        human_followup_required
      `
    )
    .eq("id", leadId)
    .single();

  if (error) {
    console.error("Final lead fetch failed:", {
      leadId,
      code: error.code,
      message: error.message,
    });
    return null;
  }

  return data;
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
    const now = new Date().toISOString();
    const body = await parseRequestBody(request);
    const input = normalizeLeadInput(
      body,
      request,
      now
    );
    const existingLead = await findLeadByEmail(
      input.email
    );

    if (!existingLead && !input.firstName) {
      throw new RequestValidationError(
        "First name is required for a new lead.",
        "firstName"
      );
    }

    const {
      leadId,
      created,
      previousLead,
    } = await saveLead(existingLead, input, now);

    const warnings: string[] = [];

    const eventWarning = await recordLeadEvent(
      leadId,
      input
    );

    if (eventWarning) {
      warnings.push(eventWarning);
    }

    const lemlist = await syncLeadToLemlist(
      input,
      leadId,
      previousLead
    );

    if (lemlist.status === "failed" && lemlist.message) {
      warnings.push(lemlist.message);
    }

    const finalLead = await loadFinalLead(leadId);

    if (!finalLead) {
      warnings.push(
        "Lead was saved, but the final record could not be reloaded."
      );
    }

    const lead = finalLead
      ? {
          id: finalLead.id,
          firstName: finalLead.first_name,
          email: finalLead.email,
          phone: finalLead.phone,
          purpose: finalLead.purpose,
          intent: input.intent.publicIntent,
          segment: finalLead.segment,
          stage: input.stage,
          recommendedProduct:
            finalLead.recommended_product,
          templateFamily:
            finalLead.email_template_family,
          marketingConsent:
            finalLead.consent_email,
          leadScore: finalLead.lead_score,
          status: finalLead.status,
          humanFollowupRequired:
            finalLead.human_followup_required,
        }
      : {
          id: leadId,
          firstName:
            input.firstName ??
            previousLead?.first_name ??
            null,
          email: input.email,
          phone:
            input.phone ??
            previousLead?.phone ??
            null,
          purpose: input.purpose,
          intent: input.intent.publicIntent,
          segment: input.intent.segment,
          stage: input.stage,
          recommendedProduct:
            input.intent.recommendedProduct,
          templateFamily:
            input.intent.templateFamily,
          marketingConsent:
            input.marketingConsent.provided
              ? input.marketingConsent.value
              : previousLead?.consent_email ?? false,
        };

    return jsonResponse(
      {
        success: true,
        created,
        leadSaved: true,
        message: created
          ? "Your Uppermost recommendation is ready."
          : "Your Uppermost recommendation has been updated.",
        lead,
        integrations: {
          lemlist,
        },
        warnings,
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
