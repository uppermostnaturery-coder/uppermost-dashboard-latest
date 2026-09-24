import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "crypto";

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForStableJson);
  }

  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = normalizeForStableJson(
          (value as Record<string, unknown>)[key]
        );
        return result;
      }, {});
  }

  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function requestHash(value: unknown): string {
  return sha256(stableStringify(value));
}

export function createPublicToken(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function tokenHash(token: string, pepper: string): string {
  return createHmac("sha256", pepper).update(token).digest("hex");
}

export function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

export function verifyHmacHex(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return safeEqual(expected, signature);
}

