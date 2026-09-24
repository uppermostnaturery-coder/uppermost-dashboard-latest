import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { CommerceError } from "./http";

export async function requireCustomer(request: Request) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new CommerceError("AUTH_REQUIRED", "Authentication is required.", 401);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Supabase public environment is not configured.");
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new CommerceError("AUTH_INVALID", "Authentication is invalid.", 401);
  const customer = await supabaseAdmin.from("customers")
    .select("id")
    .eq("auth_user_id", data.user.id)
    .maybeSingle();
  if (customer.error) throw new Error(`Customer lookup failed: ${customer.error.message}`);
  if (!customer.data) throw new CommerceError("CUSTOMER_NOT_FOUND", "No commerce customer is linked to this account.", 404);
  return { userId: data.user.id, customerId: customer.data.id as string };
}

