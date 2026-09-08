import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BREVO_API_BASE_URL = process.env.BREVO_API_BASE_URL || "https://api.brevo.com/v3";
const BREVO_API_KEY = process.env.BREVO_API_KEY?.trim();

type BrevoContactPayload = {
  email?: string | null;
  phone?: string | null;
  createdAt?: string | null;
  created_at?: string | null;
  status?: string | null;
  emailBlacklisted?: boolean | null;
  smsBlacklisted?: boolean | null;
  listIds?: number[] | null;
  attributes?: Record<string, unknown> | null;
};

type RecentContact = {
  email: string | null;
  phone: string | null;
  createdAt: string | null;
  status: string;
  emailStatus?: string;
};

type BrevoEmailEvent = {
  email?: string | null;
  event?: string | null;
};

type PaginationParams = {
  page: number;
  perPage: number;
  searchQuery: string;
  days: number;
};

function parsePaginationParams(url: URL): PaginationParams {
  const pageParam = url.searchParams.get("page");
  const perPageParam = url.searchParams.get("per_page");
  const searchQuery = url.searchParams.get("search")?.trim() ?? "";
  const daysParam = url.searchParams.get("days");

  const page = pageParam ? Math.max(1, Number(pageParam) || 1) : 1;
  const perPage =
    perPageParam && Number.isFinite(Number(perPageParam))
      ? Math.min(Math.max(1, Number(perPageParam)), 200)
      : 20;
  const days =
    daysParam && Number.isFinite(Number(daysParam))
      ? Math.min(Math.max(1, Number(daysParam)), 90)
      : 1;

  return { page, perPage, searchQuery, days };
}

function brevoHeaders() {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing.");
  }

  return {
    "api-key": BREVO_API_KEY,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function fetchBrevo(path: string): Promise<{ ok: boolean; data: unknown }> {
  if (!BREVO_API_KEY) {
    return { ok: false, data: null };
  }

  try {
    const response = await fetch(`${BREVO_API_BASE_URL}${path}`, {
      method: "GET",
      headers: brevoHeaders(),
      cache: "no-store",
    });

    const text = await response.text();
    let body: unknown = null;

    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    return { ok: response.ok, data: response.ok ? body : null };
  } catch {
    return { ok: false, data: null };
  }
}

function normalizeContactStatus(contact: BrevoContactPayload): string {
  const normalized = `${contact.status ?? ""}`.trim().toLowerCase();

  if (contact.emailBlacklisted || contact.smsBlacklisted) {
    return "Blocklisted";
  }

  if (normalized === "unsubscribed") {
    return "Unsubscribed";
  }

  if (normalized === "blocked" || normalized === "blocklisted") {
    return "Blocklisted";
  }

  return "Subscribed";
}

function getBrevoAttributeText(
  attributes: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = attributes?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRawBrevoContacts(payload: unknown): BrevoContactPayload[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const source = payload as { contacts?: unknown; data?: unknown };
  const rawContacts = Array.isArray(source.contacts)
    ? source.contacts
    : Array.isArray(source.data)
      ? source.data
      : [];

  return rawContacts.filter(
    (item): item is BrevoContactPayload => Boolean(item) && typeof item === "object"
  );
}

function getBrevoContactEmailList(payload: unknown): string[] {
  return getRawBrevoContacts(payload)
    .map((contact) => (typeof contact.email === "string" ? contact.email.toLowerCase() : ""))
    .filter(Boolean);
}

async function getLeadPhonesByEmail(emails: string[]) {
  const uniqueEmails = Array.from(new Set(emails.map((email) => email.toLowerCase())));

  if (!uniqueEmails.length) {
    return new Map<string, string>();
  }

  const { data, error } = await supabaseAdmin
    .from("um_leads")
    .select("email, phone")
    .in("email", uniqueEmails);

  if (error || !data) {
    console.error("Supabase lead phone fallback failed:", error);
    return new Map<string, string>();
  }

  const phoneByEmail = new Map<string, string>();

  data.forEach((lead) => {
    const email = typeof lead.email === "string" ? lead.email.toLowerCase() : "";
    const phone = typeof lead.phone === "string" && lead.phone.trim() ? lead.phone.trim() : "";

    if (email && phone) {
      phoneByEmail.set(email, phone);
    }
  });

  return phoneByEmail;
}

function normalizeRecentContacts(
  payload: unknown,
  searchQuery: string,
  phoneByEmail = new Map<string, string>()
): RecentContact[] {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  return getRawBrevoContacts(payload)
    .map((contact) => {
      const email = typeof contact.email === "string" ? contact.email : null;
      const emailKey = email?.toLowerCase() ?? "";

      const attributes =
        contact.attributes && typeof contact.attributes === "object"
          ? contact.attributes
          : null;

      const brevoPhone =
        typeof contact.phone === "string" && contact.phone.trim()
          ? contact.phone.trim()
          : getBrevoAttributeText(attributes, "SMS") ??
            getBrevoAttributeText(attributes, "PHONE") ??
            getBrevoAttributeText(attributes, "WHATSAPP") ??
            getBrevoAttributeText(attributes, "LANDLINE_NUMBER");

      const phone = brevoPhone ?? phoneByEmail.get(emailKey) ?? null;

      const createdAt =
        typeof contact.createdAt === "string"
          ? contact.createdAt
          : typeof contact.created_at === "string"
            ? contact.created_at
            : null;

      return {
        email,
        phone,
        createdAt,
        status: normalizeContactStatus(contact),
      };
    })
    .filter((contact) => Boolean(contact.email || contact.phone))
    .filter((contact) => {
      if (!normalizedQuery) return true;
      const email = contact.email?.toLowerCase() ?? "";
      const phone = contact.phone?.toLowerCase() ?? "";
      return email.includes(normalizedQuery) || phone.includes(normalizedQuery);
    })
    .sort((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
}
function getRangeStart(days: number) {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;

  if (days === 1) {
    const nowIST = new Date(Date.now() + IST_OFFSET);
    nowIST.setUTCHours(0, 0, 0, 0);
    return new Date(nowIST.getTime() - IST_OFFSET);
  }

  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function normalizeEventName(eventName: unknown) {
  return String(eventName ?? "").trim().toLowerCase();
}

function getBestEmailStatus(events: BrevoEmailEvent[]) {
  const eventNames = events.map((event) => normalizeEventName(event.event));

  if (
    eventNames.includes("click") ||
    eventNames.includes("clicks") ||
    eventNames.includes("clicked")
  ) {
    return "Clicked";
  }

  if (eventNames.includes("opened") || eventNames.includes("unique_opened")) {
    return "Opened";
  }

  if (eventNames.includes("delivered")) {
    return "Delivered";
  }

  if (
    eventNames.includes("hard_bounce") ||
    eventNames.includes("soft_bounce") ||
    eventNames.includes("hardbounces") ||
    eventNames.includes("softbounces")
  ) {
    return "Bounced";
  }

  if (
    eventNames.includes("request") ||
    eventNames.includes("requests") ||
    eventNames.includes("sent")
  ) {
    return "Sent";
  }

  return "No activity";
}

function getEventsByEmail(payload: unknown) {
  const eventsByEmail = new Map<string, BrevoEmailEvent[]>();

  if (!payload || typeof payload !== "object") {
    return eventsByEmail;
  }

  const source = payload as { events?: unknown };
  const events = Array.isArray(source.events) ? source.events : [];

  events.forEach((item) => {
    if (!item || typeof item !== "object") return;

    const event = item as BrevoEmailEvent;
    const email = typeof event.email === "string" ? event.email.toLowerCase() : "";

    if (!email) return;

    const existing = eventsByEmail.get(email) ?? [];
    existing.push(event);
    eventsByEmail.set(email, existing);
  });

  return eventsByEmail;
}

export async function GET(request: Request) {
  try {
    const { page, perPage, searchQuery, days } = parsePaginationParams(new URL(request.url));
    const rangeStartDate = getRangeStart(days);
    const offset = (page - 1) * perPage;

    const totalCountResponse = await fetchBrevo("/contacts?limit=1&offset=0");
    let totalContacts = 0;

    if (totalCountResponse.data && typeof totalCountResponse.data === "object") {
      const candidate = totalCountResponse.data as { count?: unknown; total?: unknown };
      const countValue = candidate.count ?? candidate.total;
      if (typeof countValue === "number") {
        totalContacts = countValue;
      }
    }

    const contactsResponseData = await fetchBrevo(
      `/contacts?limit=${searchQuery ? 200 : perPage}&offset=${searchQuery ? 0 : offset}&sort=desc`
    );
    const leadPhoneByEmail = await getLeadPhonesByEmail(
  getBrevoContactEmailList(contactsResponseData.data)
);

const normalizedContacts = normalizeRecentContacts(
  contactsResponseData.data,
  searchQuery,
  leadPhoneByEmail
);

    const rangeFilteredContacts = normalizedContacts.filter((contact) => {
      if (!contact.createdAt) return false;
      const createdAt = new Date(contact.createdAt);
      return createdAt >= rangeStartDate;
    });

    const recentContacts = rangeFilteredContacts.slice(0, perPage);

    let emailStats = { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0 };
    const statsResponse = await fetchBrevo(`/smtp/statistics/aggregatedReport?days=${days}`);

    if (statsResponse.data && typeof statsResponse.data === "object") {
      const stats = statsResponse.data as Record<string, unknown>;
      emailStats = {
        sent:
          typeof stats.requests === "number"
            ? stats.requests
            : typeof stats.sent === "number"
              ? stats.sent
              : 0,
        delivered: typeof stats.delivered === "number" ? stats.delivered : 0,
        opened:
          typeof stats.uniqueOpens === "number"
            ? stats.uniqueOpens
            : typeof stats.opens === "number"
              ? stats.opens
              : typeof stats.uniqueOpened === "number"
                ? stats.uniqueOpened
                : typeof stats.unique_opened === "number"
                  ? stats.unique_opened
                  : typeof stats.opened === "number"
                    ? stats.opened
                    : 0,
        clicked:
          typeof stats.uniqueClicks === "number"
            ? stats.uniqueClicks
            : typeof stats.clicks === "number"
              ? stats.clicks
              : typeof stats.clicked === "number"
                ? stats.clicked
                : 0,
        bounced:
          (typeof stats.hardBounces === "number" ? stats.hardBounces : 0) +
          (typeof stats.softBounces === "number" ? stats.softBounces : 0),
      };
    }

    const eventsResponse = await fetchBrevo(
      `/smtp/statistics/events?days=${days}&limit=5000&sort=desc`
    );
    const eventsByEmail = getEventsByEmail(eventsResponse.data);

    const contactsWithEmailStatus = recentContacts.map((contact) => {
      const email = contact.email?.toLowerCase() ?? "";
      const events = email ? eventsByEmail.get(email) ?? [] : [];

      return {
        ...contact,
        emailStatus: getBestEmailStatus(events),
      };
    });

    let brevoConnected = false;
    if (totalCountResponse.ok) brevoConnected = true;
    if (contactsResponseData.ok) brevoConnected = true;
    if (statsResponse.ok) brevoConnected = true;
    if (eventsResponse.ok) brevoConnected = true;

    const actualTotal = rangeFilteredContacts.length;
    const totalPages = Math.max(1, Math.ceil(actualTotal / perPage));

    const data = {
      totalContacts,
      currentPage: page,
      pageSize: perPage,
      totalPages,
      searchQuery,
      automationStatus: null,
      started: null,
      finished: null,
      currentlyRunning: null,
      sent: emailStats.sent,
      delivered: emailStats.delivered,
      opened: emailStats.opened,
      clicked: emailStats.clicked,
      bounced: emailStats.bounced,
      connectionStatus: brevoConnected ? "Connected" : "Disconnected",
      lastSync: new Date().toISOString(),
      recentContacts: contactsWithEmailStatus,
    };

    return NextResponse.json(
      {
        success: true,
        data,
      },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Brevo API error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to load Brevo data.",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  }
}