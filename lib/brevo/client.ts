import { getBrevoServerEnv } from "./env";

type BrevoRequestBody = BodyInit | Record<string, unknown> | null | undefined;

type BrevoRequestInit = Omit<RequestInit, "body"> & { body?: BrevoRequestBody };

function isBodyInit(value: BrevoRequestBody): value is BodyInit {
  return (
    typeof value === "string" ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof Blob ||
    value instanceof FormData ||
    value instanceof URLSearchParams ||
    value instanceof ReadableStream
  );
}

export async function brevoFetch(path: string, init: BrevoRequestInit = {}) {
  const { BREVO_API_KEY, BREVO_API_BASE_URL } = getBrevoServerEnv();

  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing.");
  }

  const serializedBody = init.body && !isBodyInit(init.body) ? JSON.stringify(init.body) : init.body;

  const response = await fetch(`${BREVO_API_BASE_URL}${path}`, {
    method: "GET",
    headers: {
      "api-key": BREVO_API_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    ...init,
    body: serializedBody,
  });

  const text = await response.text();
  let parsedBody: unknown = null;

  if (text) {
    try {
      parsedBody = JSON.parse(text);
    } catch {
      parsedBody = text;
    }
  }

  if (!response.ok) {
    throw new Error(
      typeof parsedBody === "string"
        ? parsedBody.slice(0, 200)
        : `Brevo request failed with status ${response.status}`
    );
  }

  return parsedBody;
}
