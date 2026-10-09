export type Failure = "FAILED_RETRYABLE" | "FAILED_PERMANENT" | "RECONCILIATION_PENDING";
export function classifyProviderFailure(status?: number, ambiguous = false): Failure {
  if (ambiguous || status === undefined) return "RECONCILIATION_PENDING";
  return status === 429 || status >= 500 ? "FAILED_RETRYABLE" : "FAILED_PERMANENT";
}
export function retryDelay(attempt: number, retryAfterSeconds = 0, random = Math.random()) {
  return Math.max(retryAfterSeconds*1000,Math.min(3600000,5000*2**Math.min(attempt,10))*(1+random*0.25));
}
export class ProviderError extends Error {
  constructor(public state: Failure, public retryAfter = 0, public code = "PROVIDER_FAILED") { super(code); }
}
export async function providerRequest(url: string, init: RequestInit, fetcher = fetch) {
  let response: Response;
  try { response = await fetcher(url,{...init,signal:AbortSignal.timeout(15000)}); }
  catch { throw new ProviderError("RECONCILIATION_PENDING",0,"AMBIGUOUS_TRANSPORT"); }
  const retryAfter = response.headers.get("retry-after");
  const delay = retryAfter ? Number(retryAfter) || Math.max(0,(Date.parse(retryAfter)-Date.now())/1000) : 0;
  if (!response.ok) throw new ProviderError(classifyProviderFailure(response.status),delay,`PROVIDER_HTTP_${response.status}`);
  const text = await response.text();
  if (!text) return {} as Record<string,unknown>;
  try { return JSON.parse(text) as Record<string,unknown>; } catch { throw new ProviderError("RECONCILIATION_PENDING",0,"AMBIGUOUS_RESPONSE"); }
}
