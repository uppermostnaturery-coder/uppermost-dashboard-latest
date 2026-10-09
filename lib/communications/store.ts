import { supabaseAdmin } from "../supabaseAdmin";
export const db = supabaseAdmin;
export async function rpc<T = unknown>(name: string, args: Record<string,unknown> = {}): Promise<T> {
  const { data,error } = await db.rpc(name,args);
  if (error) throw new Error(error.message);
  return data as T;
}
export function assertDb(result: { error: {message:string} | null }) { if (result.error) throw new Error(result.error.message); }
