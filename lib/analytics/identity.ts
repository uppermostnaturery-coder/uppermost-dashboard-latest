export type AnalyticsContext = { visitorId: string | null; sessionId: string | null };
export function validateAnalyticsId(value: string | null, prefix: "v_" | "s_"): string | null {
  const pattern = new RegExp(`^${prefix}[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`, "i");
  const legacy=new RegExp(`^${prefix}id-[0-9]{13}-[a-z0-9]{1,20}$`,"i");
  return value && value.length<=80 && (pattern.test(value)||legacy.test(value)) ? value : null;
}
type Link = AnalyticsContext & { customerId: string };
async function linkAnalyticsIdentity(context: Link) {
  const { supabaseAdmin } = await import("../supabaseAdmin");
  const { error } = await supabaseAdmin.rpc("link_analytics_identity", {
    p_visitor_id: context.visitorId, p_session_id: context.sessionId, p_customer_id: context.customerId,
  }).abortSignal(AbortSignal.timeout(750));
  if (error) throw new Error("Identity link unavailable");
}

// Browser IDs are observational context, not customer authentication or commerce input.
export async function bestEffortIdentityLink(context: Link, link = linkAnalyticsIdentity) {
  if (!context.visitorId) return;
  try { await link(context); } catch (error) {
    console.warn("analytics_identity_link_failed", { customerId: context.customerId, reason: error instanceof Error ? error.name : "unknown" });
  }
}
