import Dashboard from "@/components/Dashboard";
import { requireAdmin } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import { signOut } from "./login/actions";

export const dynamic = "force-dynamic";
export default async function Page() {
  try { await requireAdmin(); } catch { redirect("/login"); }
  return <><form action={signOut} style={{ position: "fixed", right: 12, bottom: 12, zIndex: 100 }}><button type="submit">Sign out</button></form><Dashboard /></>;
}
