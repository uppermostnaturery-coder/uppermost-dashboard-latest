import { brevoFetch } from "./client";
import { getBrevoServerEnv } from "./env";

type BrevoContactPayload = {
  email: string;
  phone?: string | null;
  listIds?: number[];
  updateEnabled?: boolean;
  attributes?: Record<string, unknown>;
};

function normalizeIndianPhone(phone: string | null | undefined) {
  const digits = `${phone ?? ""}`.replace(/\D/g, "");

  if (!digits) {
    return null;
  }

  if (digits.length <= 10) {
    return `+91${digits}`;
  }

  if (digits.startsWith("91") && digits.length === 12) {
    return `+${digits}`;
  }

  return `+${digits}`;
}

export function buildBrevoContactPayload(payload: BrevoContactPayload) {
  const normalizedPhone = normalizeIndianPhone(payload.phone);

  return {
    email: payload.email,
    listIds: payload.listIds,
    updateEnabled: payload.updateEnabled ?? true,
    attributes: {
      ...(payload.attributes ?? {}),
      ...(normalizedPhone
        ? {
            SMS: normalizedPhone,
            WHATSAPP: normalizedPhone,
            LANDLINE_NUMBER: normalizedPhone,
          }
        : {}),
    },
  };
}

export async function upsertBrevoContact(payload: BrevoContactPayload) {
  return brevoFetch("/contacts", {
    method: "POST",
    body: buildBrevoContactPayload(payload),
  });
}

export async function syncLeadToBrevo(email: string, phone?: string | null, listId?: string) {
  const { BREVO_MARKETING_LIST_ID } = getBrevoServerEnv();
  const resolvedListId = listId ?? BREVO_MARKETING_LIST_ID;

  if (!resolvedListId) {
    return null;
  }

  return upsertBrevoContact({
    email,
    phone,
    listIds: [Number(resolvedListId)],
    updateEnabled: true,
  });
}