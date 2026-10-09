import { z } from "zod";
import { validateAnalyticsId } from "./identity";

const id = (prefix: "v_" | "s_") => z.string().refine((value) => validateAnalyticsId(value, prefix) !== null);
function boundedMetadata(value: unknown, depth = 0): boolean {
  if (depth > 4) return false;
  if (typeof value === "string") return value.length <= 512;
  if (value === null || typeof value === "boolean" || typeof value === "number") return true;
  if (Array.isArray(value)) return value.length <= 20 && value.every((v) => boundedMetadata(v, depth + 1));
  if (typeof value !== "object" || !value) return false;
  return Object.entries(value).length <= 40 && Object.entries(value).every(([key, v]) =>
    /^[a-zA-Z0-9_]{1,64}$/.test(key) && (!/email|phone|address|customer_id|password|token|name|authorization/i.test(key)||['class_name','tag_name','product_name'].includes(key)) && boundedMetadata(v, depth + 1));
}
const safeUrl = z.string().max(2048).refine((s) => {
  try { const u = new URL(s); return ["https:", "http:"].includes(u.protocol) && !u.username && !u.password && !u.search && !u.hash; } catch { return false; }
});
const event = z.object({
  client_event_id: z.uuid().optional(),
  event_name: z.string().regex(/^[a-zA-Z0-9_.:-]{1,64}$/),
  created_at: z.iso.datetime().refine((v) => Math.abs(Date.now() - Date.parse(v)) <= 86400000),
  page_url: safeUrl.optional(), page_path: z.string().max(512).regex(/^\/[^?#]*$/).optional(), page_title: z.string().max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}).refine((v) => boundedMetadata(v) && JSON.stringify(v).length <= 4096),
}).strict();
export const analyticsBatchSchema = z.object({
  visitorId: id("v_"), sessionId: id("s_"),
  operation: z.enum(["INITIALIZE", "SESSION_TOUCH", "EVENT"]).default("EVENT"),
  events: z.array(event).max(50).default([]),
  device_type: z.string().max(32).optional(), browser: z.string().max(64).optional(), os: z.string().max(64).optional(), timezone: z.string().max(64).optional(),
  is_online:z.boolean().optional(),country:z.string().max(100).nullable().optional(),city:z.string().max(100).nullable().optional(),region:z.string().max(100).nullable().optional(),ip_timezone:z.string().max(64).nullable().optional(),
  referrer:safeUrl.nullable().optional(),utm_source:z.string().max(200).nullable().optional(),utm_medium:z.string().max(200).nullable().optional(),utm_campaign:z.string().max(200).nullable().optional(),
}).strict();
export function parseAnalyticsBatch(value: unknown) { return analyticsBatchSchema.parse(value); }
