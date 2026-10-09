"use server";
import { redirect } from "next/navigation";
import { operatorAuthClient, requireAdmin } from "../../lib/admin/auth";

export async function signIn(form: FormData) {
  const client = await operatorAuthClient();
  const email = String(form.get("email") || "").slice(0, 254);
  const password = String(form.get("password") || "").slice(0, 1024);
  const result = await client.auth.signInWithPassword({ email, password });
  if (result.error) redirect("/login?error=signin");
  try { await requireAdmin(); } catch { await client.auth.signOut(); redirect("/login?error=access"); }
  redirect("/");
}
export async function signOut() { await (await operatorAuthClient()).auth.signOut(); redirect("/login"); }
