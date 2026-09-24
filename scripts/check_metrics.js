const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

function loadEnv(path) {
  if (!fs.existsSync(path)) return;
  const raw = fs.readFileSync(path, 'utf8');
  raw.split(/\r?\n/).forEach(line => {
    const m = line.match(/^\s*([A-Z0-9_]+)=(.*)$/);
    if (m) {
      const k = m[1];
      let v = m[2];
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      process.env[k] = v;
    }
  });
}

loadEnv(__dirname + '/../.env.local');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Missing supabase env in project/.env.local');
  process.exit(2);
}

const supabase = createClient(url, key);

async function main() {
  const now = Date.now();
  const onlineCutoff = new Date(now - 3 * 60 * 1000).toISOString();
  const sessionCutoff = new Date(now - 90 * 1000).toISOString();

  const [vRes, onRes, sRes, pvRes, evRes, atcRes, coRes, purRes] = await Promise.all([
    supabase.from('analytics_visitors').select('visitor_id', { count: 'exact', head: true }),
    supabase.from('analytics_visitors').select('visitor_id', { count: 'exact', head: true }).gte('last_seen_at', onlineCutoff),
    supabase.from('analytics_sessions').select('session_id', { count: 'exact', head: true }).eq('is_active', true).gt('last_seen_at', sessionCutoff),
    supabase.from('analytics_events').select('event_name', { count: 'exact', head: true }).eq('event_name', 'page_view'),
    supabase.from('analytics_events').select('event_name', { count: 'exact', head: true }),
    supabase.from('analytics_events').select('event_name', { count: 'exact', head: true }).eq('event_name', 'add_to_cart'),
    supabase.from('analytics_events').select('event_name', { count: 'exact', head: true }).eq('event_name', 'checkout_started'),
    supabase.from('analytics_events').select('event_name', { count: 'exact', head: true }).ilike('event_name', 'purchase%'),
  ]);

  console.log('Visitors total:', vRes.count);
  console.log('Online (3m):', onRes.count);
  console.log('Active sessions:', sRes.count);
  console.log('Page Views total:', pvRes.count);
  console.log('Events total:', evRes.count);
  console.log('Add to cart:', atcRes.count);
  console.log('Checkouts:', coRes.count);
  console.log('Purchases:', purRes.count);
}

main().catch(err => { console.error(err); process.exit(1); });
