# WhatsApp Lead Automation Documentation

## Goal

Website form submit hone ke baad customer ka lead Supabase me save hoga. Agar customer ne WhatsApp number diya hai, backend Meta WhatsApp Cloud API ko hit karega aur customer ko automated welcome/template message send karega.

## Current System Status

- Next.js project: `uppermost-dashboard/project`
- WhatsApp API route: `app/api/whatsapp/send/route.ts`
- WhatsApp helper files:
  - `lib/whatsapp/env.ts`
  - `lib/whatsapp/client.ts`
- Supabase admin helper: `lib/supabaseAdmin.ts`
- WhatsApp log table: `public.whatsapp_messages`
- Manual Supabase insert test working.
- Browser `GET /api/whatsapp/send` working and returns: `Use POST request to send WhatsApp message.`

## Main Workflow

1. User fills website form.
2. Form sends data to backend API.
3. Backend validates required fields.
4. Lead gets saved into Supabase lead table, likely `public.um_leads`.
5. Backend checks if WhatsApp number is available.
6. Backend normalizes phone number into country-code digits format.
7. Backend inserts a row into `public.whatsapp_messages` with `status = queued`.
8. Backend calls Meta WhatsApp Cloud API.
9. If Meta accepts the message, backend updates row to `status = sent`.
10. If Meta rejects the message, backend updates row to `status = failed`.
11. Later webhook updates message status to `delivered`, `read`, or `failed`.
12. Dashboard reads `public.whatsapp_messages` and displays WhatsApp automation history.

## Data Flow Diagram

```txt
Website Form
   |
   v
Next.js API: form submit / lead API
   |
   v
Supabase: public.um_leads
   |
   v
Next.js API: /api/whatsapp/send
   |
   v
Supabase: public.whatsapp_messages status=queued
   |
   v
Meta WhatsApp Cloud API
   |
   v
Supabase: public.whatsapp_messages status=sent or failed
   |
   v
Webhook later updates delivered/read/failed
```

## WhatsApp API Used

Endpoint:

```txt
POST https://graph.facebook.com/v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

Headers:

```txt
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json
```

Payload for current test template:

```json
{
  "messaging_product": "whatsapp",
  "to": "916376203488",
  "type": "template",
  "template": {
    "name": "hello_world",
    "language": {
      "code": "en_US"
    }
  }
}
```

Expected success response:

```json
{
  "messaging_product": "whatsapp",
  "contacts": [
    {
      "input": "916376203488",
      "wa_id": "916376203488"
    }
  ],
  "messages": [
    {
      "id": "wamid..."
    }
  ]
}
```

## Environment Variables

Required in `.env.local`:

```env
WHATSAPP_API_VERSION=v25.0
WHATSAPP_ACCESS_TOKEN=FULL_META_ACCESS_TOKEN
WHATSAPP_PHONE_NUMBER_ID=1290022074203183
WHATSAPP_BUSINESS_ACCOUNT_ID=1534077061817684
WHATSAPP_WELCOME_TEMPLATE=hello_world
WHATSAPP_TEMPLATE_LANGUAGE=en_US

NEXT_PUBLIC_SUPABASE_URL=https://obnxzdicpvsptuttffot.supabase.co
SUPABASE_SERVICE_ROLE_KEY=YOUR_SUPABASE_SERVICE_ROLE_KEY
```

Rules:

- `WHATSAPP_ACCESS_TOKEN` me `Bearer` word mat lagana.
- Token browser/client side expose nahi hona chahiye.
- `SUPABASE_SERVICE_ROLE_KEY` sirf server-side code me use hona chahiye.
- `SUPABASE_SERVICE_ROLE_KEY` ko kabhi `NEXT_PUBLIC_` prefix mat dena.

## Supabase Tables

### `public.whatsapp_messages`

Purpose: WhatsApp automation messages ka log.

Important columns:

```txt
id
lead_id
email
phone
template_name
template_language
status
meta_message_id
request_payload
response_payload
error_payload
error_message
created_at
sent_at
delivered_at
read_at
failed_at
```

Allowed status:

```txt
queued
sent
delivered
read
failed
```

### `public.um_leads`

Purpose: Website leads/customer form data.

Expected fields for WhatsApp automation:

```txt
id
name
email
phone / whatsapp_phone
created_at
```

Exact field names project ke existing lead schema ke hisab se use karne hain.

## Phone Number Format

Backend me phone number clean hona chahiye:

```txt
+91 63762 03488 -> 916376203488
06376203488 -> invalid unless country code added
6376203488 -> not ideal for WhatsApp API because country code missing
```

Recommended rule:

- India users ke liye form me country code dropdown rakho.
- API me final phone digits-only format me save/send karo.
- Example: `916376203488`

## Trigger Rules

Phase 1 me trigger:

```txt
When lead form submits successfully AND phone number exists
```

System should send:

```txt
Welcome message template
```

Future triggers:

- Welcome user after signup/lead form.
- Product stock-in alert.
- Stock-out alternative suggestion.
- Limited jars / low stock urgency.
- Festival offer.
- Repeat purchase/LTV campaign.
- Abandoned interest follow-up.
- Order confirmation.
- Delivery/update message.
- Refill reminder.
- Win-back inactive customer.

## Consent Logic

Current Phase 1:

- WhatsApp consent can be added later, but recommended for production.

Production recommendation:

- Form me checkbox add karo:

```txt
I agree to receive WhatsApp updates from Uppermost.
```

- Store consent in Supabase:

```txt
whatsapp_consent = true
whatsapp_consent_at = timestamp
whatsapp_consent_source = "website_form"
```

Production trigger condition:

```txt
phone exists AND whatsapp_consent = true
```

## Template Strategy

### Phase 1 Test

Use Meta default template:

```txt
hello_world
en_US
```

### Production Welcome Template

Create template in Meta Business Manager:

Template name:

```txt
uppermost_welcome
```

Category:

```txt
Utility or Marketing
```

Suggested body:

```txt
Hi {{1}}, welcome to Uppermost. Thanks for showing interest in our products. Our team will contact you shortly.
```

If template includes promotional offer, category should be Marketing.

## Backend Route Responsibility

Route:

```txt
POST /api/whatsapp/send
```

Input:

```json
{
  "phone": "916376203488",
  "templateName": "hello_world",
  "language": "en_US"
}
```

Route should:

1. Read body.
2. Clean phone number.
3. Validate phone length.
4. Insert queued row into `public.whatsapp_messages`.
5. Send template message via Meta API.
6. Update same row to `sent` if accepted.
7. Update same row to `failed` if API rejects.
8. Return JSON response.

## Form Integration Plan

Existing lead/form API should call WhatsApp send logic after lead save.

Recommended pattern:

```txt
Lead API receives form
Lead API saves lead to Supabase
Lead API calls sendWhatsAppTemplate or internal helper
Lead API stores WhatsApp message log
Lead API returns success to frontend
```

Avoid:

```txt
Frontend directly calling Meta WhatsApp API
```

Reason:

- Access token leak risk.
- Service role key leak risk.
- User can spam API from browser.

## Webhook Plan

Webhook endpoint to add later:

```txt
GET  /api/whatsapp/webhook
POST /api/whatsapp/webhook
```

GET:

- Meta verification challenge handle karega.
- Verify token match karega.

POST:

- Meta status events receive karega.
- `wamid` / `meta_message_id` se `whatsapp_messages` row find karega.
- Status update karega:
  - `sent`
  - `delivered`
  - `read`
  - `failed`

## Dashboard Plan

Dashboard me ek WhatsApp section add karna:

Metrics:

```txt
Total WhatsApp messages
Queued
Sent
Delivered
Read
Failed
Success rate
Failure rate
```

Table columns:

```txt
Phone
Template
Status
Meta Message ID
Error
Created At
Sent At
Delivered At
Read At
Failed At
```

Filters:

```txt
Status
Template
Date range
Phone search
```

## Error Handling

Common errors:

### Meta `code 190`

Meaning:

```txt
Access token invalid, expired, or wrong token.
```

Fix:

- Generate new token.
- Paste full token into `.env.local`.
- Do not include `Bearer`.
- Restart Next.js server.

### Phone invalid

Meaning:

```txt
Country code missing or number format wrong.
```

Fix:

- Send digits only with country code.

### Template not found

Meaning:

```txt
Template name/language wrong or not approved for that WABA.
```

Fix:

- Check Meta template name.
- Check language code.
- Use approved template.

### Supabase insert failed

Meaning:

```txt
Service role key missing/wrong, table permission issue, or wrong env.
```

Fix:

- Check `SUPABASE_SERVICE_ROLE_KEY`.
- Check `supabaseAdmin.ts`.
- Check table exists.

## Testing Checklist

### Test 1: Server route exists

Browser:

```txt
http://localhost:3000/api/whatsapp/send
```

Expected:

```json
{
  "success": false,
  "message": "Use POST request to send WhatsApp message."
}
```

### Test 2: Manual Supabase insert

Already passed.

### Test 3: API POST

Terminal:

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"916376203488"}'
```

Expected:

- `success: true` if WhatsApp token is valid.
- `success: false` with Meta error if token/template issue.
- In both cases, `public.whatsapp_messages` should have a row.

### Test 4: Supabase row check

```sql
select
  id,
  phone,
  template_name,
  status,
  meta_message_id,
  error_message,
  error_payload,
  created_at
from public.whatsapp_messages
order by created_at desc
limit 10;
```

## Phase Plan

### Phase 1: Working Send + Log

Goal:

```txt
One real WhatsApp template message should be sent from Next.js API and logged in Supabase.
```

Tasks:

- Fix valid WhatsApp token.
- Run curl POST.
- Confirm Supabase row.
- Confirm message received in WhatsApp.

Done criteria:

```txt
curl returns success true
whatsapp_messages has status sent
phone receives WhatsApp message
```

### Phase 2: Lead Form Automation

Goal:

```txt
Website form submit automatically triggers WhatsApp welcome message.
```

Tasks:

- Inspect lead form API.
- Add phone normalization.
- Save lead to `um_leads`.
- Trigger WhatsApp send after lead save.
- Save `lead_id` in `whatsapp_messages`.

Done criteria:

```txt
Submitting website form creates lead and WhatsApp log row automatically.
```

### Phase 3: Production Setup

Goal:

```txt
Real customer-ready WhatsApp automation.
```

Tasks:

- Add real business phone number.
- Add payment in Meta.
- Create and approve welcome template.
- Replace `hello_world` with production template.
- Add consent checkbox.
- Add webhook.
- Add dashboard.

Done criteria:

```txt
Real customer leads receive approved welcome template and dashboard tracks message lifecycle.
```

## Current Next Best Step

1. Fix Meta token.
2. Run POST curl.
3. Confirm `whatsapp_messages` row changes from `queued` to `sent` or `failed`.
4. Then connect this route to lead form submit.

