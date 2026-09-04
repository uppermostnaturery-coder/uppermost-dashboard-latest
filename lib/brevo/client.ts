import { getBrevoServerEnv } from "./env";

type BrevoFetchOptions = {
  method?: string;
  body?: unknown;
};

export async function brevoFetch(
  path: string,
  options: BrevoFetchOptions = {}
) {
  const { BREVO_API_KEY, BREVO_API_BASE_URL } =
    getBrevoServerEnv();

  const response = await fetch(`${BREVO_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "api-key": BREVO_API_KEY,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body:
      options.body === undefined
        ? undefined
        : JSON.stringify(options.body),
    cache: "no-store",
  });

  const text = await response.text();
  let data: unknown = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    throw new Error(`Brevo API failed (${response.status}): ${text}`);
  }

  return data;
}
