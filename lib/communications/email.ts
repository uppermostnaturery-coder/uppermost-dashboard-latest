import sanitizeHtml from "sanitize-html";
const escape = (v: string) => v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
export function secureUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("UNSAFE_ASSET_URL");
  return value;
}
export function compileEmail(source: string, variables: Record<string, unknown>) {
  if (source.length > 200000 || /<(script|iframe|form|input|object|embed|video|audio|base|meta)\b|\bon\w+\s*=|javascript\s*:|expression\s*\(|@import/i.test(source)) throw new Error("UNSAFE_EMAIL_HTML");
  const unresolved: string[] = [];
  const html = source.replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g,(_,key: string) => {
    if (!(key in variables)) { unresolved.push(key); return ""; }
    return escape(String(variables[key]));
  });
  if (unresolved.length || /{{|}}/.test(html)) throw new Error("UNRESOLVED_TEMPLATE_VARIABLES");
  const assets: string[] = [];
  for (const match of html.matchAll(/\b(?:src|href|background)\s*=\s*["']([^"']+)["']/gi)) {
    const value = match[1];
    if (/^mailto:[^\s<>]+$/.test(value) || /^#[\w-]+$/.test(value)) continue;
    secureUrl(value);assets.push(value);
  }
  if (/url\s*\(/i.test(html)) throw new Error("CSS_ASSETS_NOT_SUPPORTED");
  const clean = sanitizeHtml(html, {
    allowedTags: ["html","head","title","body","table","thead","tbody","tfoot","tr","td","th","div","span","p","br","hr","h1","h2","h3","h4","a","img","strong","b","em","i","ul","ol","li","blockquote"],
    allowedAttributes: { "*": ["style","class","id","align","valign","width","height","role","aria-label"], a:["href","target","rel"],img:["src","alt","width","height"],table:["cellpadding","cellspacing","border","width","role"],td:["colspan","rowspan","width","height","align","valign"] },
    allowedSchemes: ["https","mailto"], allowProtocolRelative: false,
  });
  return { html: clean, text: sanitizeHtml(clean,{allowedTags:[],allowedAttributes:{}}), assets:[...new Set(assets)] };
}
export function videoPoster(destination: string, poster: string, alt: string) {
  return `<a href="${escape(secureUrl(destination))}"><img src="${escape(secureUrl(poster))}" alt="${escape(alt)}" /></a>`;
}
// Sanitize canonical HTML with inert values first, then restore only declared provider placeholders.
export function compileLemlistEmail(source:string,parameters:string[]){
 const markers=Object.fromEntries(parameters.map((key,i)=>[key,`UPPERMOSTPARAMETER${i}END`]));
 let html=compileEmail(source,markers).html;
 for(const [key,marker] of Object.entries(markers))html=html.replaceAll(marker,`{{${key}}}`);
 return html;
}
export function assertProviderReady(channel: string, category: string, artifact: Record<string,unknown> | null) {
  if (channel === "WHATSAPP" && artifact?.provider_status !== "APPROVED") throw new Error("PROVIDER_APPROVAL_REQUIRED");
  if (channel === "SMS" && (artifact?.dlt_status !== "APPROVED" || artifact.msg91_status !== "READY" || !artifact.dlt_entity_id || !artifact.dlt_header_id || !artifact.dlt_template_id || !artifact.msg91_template_id)) throw new Error("DLT_MAPPING_REQUIRED");
  if (channel === "LEMLIST" && (category !== "MARKETING" || !artifact?.lemlist_campaign_id || !artifact.lemlist_sequence_id || !artifact.lemlist_step_id)) throw new Error("LEMLIST_NURTURE_MAPPING_REQUIRED");
}
