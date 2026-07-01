# Uppermôst. Analytics Dashboard

Live analytics dashboard for uppermost.store, built with Next.js 14 (App Router) + Supabase Realtime + Chart.js.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Copy `.env.local.example` to `.env.local` and fill in your Supabase project URL + anon key:
   ```
   cp .env.local.example .env.local
   ```

3. Run locally:
   ```
   npm run dev
   ```

   Open http://localhost:3000

## Required Supabase tables

- `analytics_visitors`
- `analytics_sessions`
- `analytics_events` (with a `metadata` jsonb column for UTM/source data)

Make sure Realtime is enabled on `analytics_events` (Database → Replication → enable for that table) so the live event feed updates without polling.

## Structure

```
app/
  layout.tsx       — root layout, loads globals.css
  page.tsx          — renders the Dashboard component
  globals.css       — brown/gold theme variables + animations
components/
  Dashboard.tsx     — the full dashboard (sidebar left, 8 pages)
lib/
  supabase.ts       — Supabase client (reads env vars)
public/
  uppermost-logo.png — brand logo used in the sidebar
```

## Notes

- Sidebar is on the left, main content on the right.
- Color theme: warm chocolate/coffee (`#1c1410` background, `#c98a4b` terracotta accent, gold `#d4af6a` for the wordmark).
- Build production bundle: `npm run build && npm start`.
