import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAdmin } from "../supabaseAdmin";
import { AdminError, authorizeMembership } from "./policy";

export async function operatorAuthClient() {
  const jar = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => { try { values.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server components cannot refresh cookies; login/refresh routes do. */ } },
    },
  });
}

export async function requireAdmin(request?: Request, mutation = false) {
  const bearer = request?.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const { data, error } = bearer
    ? await supabaseAdmin.auth.getUser(bearer)
    : await (await operatorAuthClient()).auth.getUser();
  if (error || !data.user) throw new AdminError("UNAUTHENTICATED", 401);
  const result = await supabaseAdmin.from("admin_memberships").select("role, active").eq("user_id", data.user.id).maybeSingle();
  if (result.error) throw new AdminError("AUTHORIZATION_UNAVAILABLE", 503);
  return authorizeMembership(data.user.id, result.data, mutation);
}

export function adminErrorResponse(error: unknown) {
  const status = error instanceof AdminError ? error.status : 500;
  if (status === 500) console.error("admin_operation_failed", { name: error instanceof Error ? error.name : "unknown" });
  return Response.json({ error: error instanceof AdminError ? error.code : "ADMIN_OPERATION_FAILED" }, { status, headers: { "Cache-Control": "no-store" } });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) throw new AdminError("INVALID_ORIGIN", 403);
}
