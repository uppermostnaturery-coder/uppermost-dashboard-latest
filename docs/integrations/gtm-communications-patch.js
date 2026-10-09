/* EXTERNAL MANUAL CHANGE. Insert inside the existing Custom Tracker IIFE,
   immediately after `window.uppermostTrack = track;`. These declarations
   replace only the three network writers; keep tracking/ID/session logic intact.
   Set the deployed dashboard domain before GTM Preview. Never publish automatically. */
var UPPERMOST_INGEST_URL = "https://YOUR_DASHBOARD_DOMAIN/api/analytics/ingest";

function uppermostSafeUrl(value) {
  try {
    if (!value) return null;
    var url = new URL(value, window.location.href);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.search = "";
    url.hash = "";
    url.username = "";
    url.password = "";
    return url.href;
  } catch (_) { return null; }
}

function uppermostSafeMetadata(input, depth) {
  depth = depth || 0;
  if (depth > 4) return null;
  if (input === null || typeof input === "boolean") return input;
  if (typeof input === "number") return isFinite(input) ? input : null;
  if (typeof input === "string") return input.slice(0, 512);
  if (Array.isArray(input)) return input.slice(0, 20).map(function (v) { return uppermostSafeMetadata(v, depth + 1); });
  if (!input || typeof input !== "object") return null;
  var safe = Object.create(null);
  Object.keys(input).slice(0, 40).forEach(function (key) {
    if (!/^[a-zA-Z0-9_]{1,64}$/.test(key)) return;
    if (/email|phone|address|customer_id|password|token|name|authorization/i.test(key) &&
        ["class_name", "tag_name", "product_name"].indexOf(key) === -1) return;
    // Arbitrary button text can contain account/contact information. Keep action_type instead.
    if (key === "text" || key === "__proto__" || key === "constructor") return;
    var value = input[key];
    if (["href", "destination_url", "page_url", "referrer"].indexOf(key) !== -1) value = uppermostSafeUrl(value);
    if (["page_path", "from_path", "last_page"].indexOf(key) !== -1 && typeof value === "string") value = value.split(/[?#]/)[0].slice(0, 512);
    safe[key] = uppermostSafeMetadata(value, depth + 1);
  });
  return safe;
}

function ingestUppermost(operation, events, isOnline) {
  try {
    var batch = {
      operation: operation,
      visitorId: visitorId,
      sessionId: sessionId,
      events: events || [],
      is_online: isOnline !== false,
      device_type: getDeviceType(),
      browser: getBrowser(),
      os: getOS(),
      timezone: getTimeZone(),
      country: getGeoField("country"),
      city: getGeoField("city"),
      region: getGeoField("region"),
      ip_timezone: getGeoField("ip_timezone"),
      referrer: uppermostSafeUrl(document.referrer),
      utm_source: (getUTM("utm_source") || "").slice(0, 200) || null,
      utm_medium: (getUTM("utm_medium") || "").slice(0, 200) || null,
      utm_campaign: (getUTM("utm_campaign") || "").slice(0, 200) || null
    };
    return fetch(UPPERMOST_INGEST_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "omit", keepalive: true, body: JSON.stringify(batch)
    }).catch(function () {});
  } catch (_) { return Promise.resolve(); }
}

function upsertVisitor(isOnline) {
  return ingestUppermost("SESSION_TOUCH", [], isOnline);
}
function upsertSession(isActive) {
  return ingestUppermost("SESSION_TOUCH", [], isActive);
}
function track(eventName, metadata) {
  var safe = uppermostSafeMetadata(metadata || {}, 0);
  // Bounds reject a malformed event without interrupting the storefront.
  if (JSON.stringify(safe).length > 4096) safe = { source: "uppermost_tracker_v2" };
  return ingestUppermost("EVENT", [{
    event_name: eventName,
    created_at: new Date().toISOString(),
    page_url: uppermostSafeUrl(window.location.href),
    page_path: (window.location.pathname || "/").split(/[?#]/)[0].slice(0, 512),
    page_title: (document.title || "").slice(0, 200),
    metadata: safe
  }], eventName !== "session_end");
}

window.uppermostTrack = track;
window.uppermostAnalytics = {
  getIdentity: function () { return { visitorId: visitorId, sessionId: sessionId }; },
  track: track
};
