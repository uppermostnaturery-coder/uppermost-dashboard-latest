import { safeEqual } from "./crypto";
import { commerceJson } from "./http";
import { runRenewals } from "./renewals";

export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.COMMERCE_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(secret && supplied && safeEqual(secret, supplied));
}

export async function handleRenewalCron(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return commerceJson({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized." } }, 401, null);
  }
  const result = await runRenewals(20);
  return commerceJson({ ok: true, ...result }, 200, null);
}
