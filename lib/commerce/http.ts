import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { configuredCommerceOrigins, normalizeOrigin } from "./env";

const DEFAULT_ORIGIN = "https://www.uppermost.store";
const MAX_BODY_BYTES = 128 * 1024;

export class CommerceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "CommerceError";
  }
}

export function isAllowedCommerceOrigin(origin: string | null): boolean {
  return origin === null || configuredCommerceOrigins().has(normalizeOrigin(origin));
}

export function commerceCorsHeaders(
  origin: string | null,
  methods = "GET, POST, OPTIONS"
): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers":
      "Content-Type, Idempotency-Key, Authorization, X-Customer-Token, X-Shiprocket-Webhook-Secret",
    "Access-Control-Max-Age": "86400",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    Vary: "Origin",
  };

  if (origin && isAllowedCommerceOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  } else if (!origin) {
    headers["Access-Control-Allow-Origin"] = DEFAULT_ORIGIN;
  }

  return headers;
}

export function commerceJson(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
  methods?: string
) {
  return NextResponse.json(body, {
    status,
    headers: commerceCorsHeaders(origin, methods),
  });
}

export function assertCommerceOrigin(request: Request): string | null {
  const origin = request.headers.get("origin");
  if (!isAllowedCommerceOrigin(origin)) {
    throw new CommerceError("ORIGIN_NOT_ALLOWED", "Origin is not allowed.", 403);
  }
  return origin;
}

export function assertJsonRequest(request: Request): void {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    throw new CommerceError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Content-Type must be application/json.",
      415
    );
  }
}

export async function readJsonBody(request: Request): Promise<unknown> {
  assertJsonRequest(request);
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    throw new CommerceError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    throw new CommerceError("PAYLOAD_TOO_LARGE", "Request body is too large.", 413);
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new CommerceError("INVALID_JSON", "Request body must be valid JSON.", 400);
  }
}

export function requireIdempotencyKey(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim();
  if (!key || key.length < 8 || key.length > 200) {
    throw new CommerceError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "A valid Idempotency-Key header is required.",
      400
    );
  }
  return key;
}

export function errorResponse(error: unknown, origin: string | null) {
  if (error instanceof CommerceError) {
    return commerceJson(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
      },
      error.status,
      origin
    );
  }

  if (error instanceof ZodError) {
    return commerceJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          fields: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
      origin
    );
  }

  console.error("Unexpected commerce error:", error);
  return commerceJson(
    {
      ok: false,
      error: {
        code: "SYSTEM_ERROR",
        message: "The commerce service is temporarily unavailable.",
      },
    },
    500,
    origin
  );
}

type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

export function enforceRateLimit(
  request: Request,
  route: string,
  limit = 30,
  windowMs = 60_000
): void {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const key = `${route}:${ip}`;
  const now = Date.now();
  const current = rateBuckets.get(key);

  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (current.count >= limit) {
    throw new CommerceError(
      "RATE_LIMITED",
      "Too many requests. Please try again shortly.",
      429
    );
  }

  current.count += 1;
}

