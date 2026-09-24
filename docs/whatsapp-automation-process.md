# WhatsApp Automation Process Documentation

## 1. Objective

Website par customer lead form submit karega. Form submit ke baad:

1. Lead Supabase me save hogi.
2. WhatsApp number available hoga to backend WhatsApp automation trigger karega.
3. Customer ko WhatsApp welcome/template message send hoga.
4. Message ka status Supabase me track hoga.
5. Dashboard me WhatsApp message history aur delivery status dikhaya ja sakega.

This automation must run from backend only. Frontend se direct Meta WhatsApp API call nahi karni.

## 2. Main Workflow

```txt
Customer fills website form
        |
        v
Next.js Lead API receives form data
        |
        v
Supabase: lead saved in um_leads
        |
        v
WhatsApp send logic starts
        |
        v
Supabase: whatsapp_messages row created with queued status
        |
        v
Meta WhatsApp Cloud API sends template message
        |
        v
Supabase: message status updated to sent or failed
        |
        v
Webhook later updates delivered/read/failed
        |
        v
Dashboard shows WhatsApp automation status
```

## 3. Core Tables

### `public.um_leads`

Purpose: Website form leads store karna.

Important fields:

```txt
id
name
email
phone / whatsapp_phone
source
created_at
```

### `public.whatsapp_messages`

Purpose: Har WhatsApp automation message ka log store karna.

Important fields:

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

## 4. API Hits In Full Flow

### API 1: Website Form Submit

Frontend to backend:

```txt
POST /api/lead
```

or existing project route:

```txt
POST /api/launch-signup
```

Purpose:

- Name, email, phone, and form details receive karna.
- Data validate karna.
- Lead Supabase me save karna.

Example body:

```json
{
  "name": "Customer Name",
  "email": "customer@example.com",
  "phone": "916376203488"
}
```

### API 2: Supabase Lead Insert

Backend to Supabase:

```txt
insert into public.um_leads
```

Purpose:

- Customer lead save karna.
- Lead ID generate karna.

### API 3: Internal WhatsApp Send Route

Backend/internal call:

```txt
POST /api/whatsapp/send
```

Purpose:

- Phone clean karna.
- WhatsApp message log create karna.
- Meta WhatsApp Cloud API call karna.
- Success/failure Supabase me update karna.

Example body:

```json
{
  "phone": "916376203488",
  "templateName": "hello_world",
  "language": "en_US"
}
```

### API 4: Meta WhatsApp Cloud API

Backend to Meta:

```txt
POST https://graph.facebook.com/v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

Headers:

```txt
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json
```

Payload:

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

Meta success response usually contains a message ID. That ID should be saved as:

```txt
meta_message_id
```

### API 5: WhatsApp Webhook Verification

Meta to backend:

```txt
GET /api/whatsapp/webhook
```

Purpose:

- Meta webhook setup verify karna.
- Verify token match karna.
- Challenge return karna.

### API 6: WhatsApp Webhook Events

Meta to backend:

```txt
POST /api/whatsapp/webhook
```

Purpose:

- Delivery/read/failed status receive karna.
- `meta_message_id` ke basis par Supabase row update karna.

Webhook status updates:

```txt
sent
delivered
read
failed
```

## 5. Backend Responsibility

Backend ka kaam:

1. Form data validate karna.
2. Phone number clean karna.
3. Lead Supabase me save karna.
4. WhatsApp message ko `queued` status ke sath log karna.
5. Meta WhatsApp API hit karna.
6. Success par status `sent` karna.
7. Error par status `failed` karna.
8. Webhook se final delivery status update karna.

Backend must not expose:

```txt
WHATSAPP_ACCESS_TOKEN
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SECRET_KEY
```

## 6. Environment Variables

Required:

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

- WhatsApp token me `Bearer` mat lagana.
- WhatsApp token quotes me mat rakhna.
- Service role key sirf backend me use karni hai.
- `SUPABASE_SERVICE_ROLE_KEY` ko `NEXT_PUBLIC_` prefix nahi dena.

## 7. Phone Number Rules

WhatsApp API ke liye phone number country code ke sath digits-only hona chahiye.

Correct:

```txt
916376203488
```

Wrong:

```txt
+91 63762 03488
6376203488
06376203488
```

Recommended form design:

```txt
Country code dropdown + phone input
```

Backend final number:

```txt
countryCode + phoneDigits
```

## 8. Message Template Strategy

### Testing Template

Current test:

```txt
hello_world
en_US
```

### Production Welcome Template

Template name:

```txt
uppermost_welcome
```

Suggested content:

```txt
Hi {{1}}, welcome to Uppermost. Thanks for showing interest in our products. Our team will contact you shortly.
```

If offer, discount, or promotion mention hota hai, template category usually Marketing hogi.

If order, update, confirmation, or service info hai, template category usually Utility hogi.

## 9. Automation Trigger Scenarios

### Phase 1 Trigger

```txt
Lead form submit + WhatsApp number available
```

Action:

```txt
Send welcome message
```

### Future Triggers

```txt
Welcome user
Abandoned lead follow-up
Limited jars/low stock urgency
Stock out update
Stock back in refill alert
Festival campaign
Repeat purchase reminder
LTV increase campaign
Inactive customer win-back
Order confirmation
Delivery update
Support follow-up
```

## 10. Consent Plan

Phase 1:

```txt
Consent can be added later if testing only.
```

Production:

Form me checkbox add karna recommended hai:

```txt
I agree to receive WhatsApp updates from Uppermost.
```

Store in Supabase:

```txt
whatsapp_consent = true
whatsapp_consent_at = now()
whatsapp_consent_source = website_form
```

Production trigger condition:

```txt
phone exists AND whatsapp_consent = true
```

## 11. Status Lifecycle

```txt
queued -> sent -> delivered -> read
```

Failure path:

```txt
queued -> failed
sent -> failed
```

Meaning:

- `queued`: System ne send attempt start kiya.
- `sent`: Meta ne message accept kar liya.
- `delivered`: Customer ke WhatsApp tak message deliver hua.
- `read`: Customer ne message read kiya.
- `failed`: Message reject/fail hua.

Important:

`sent` ka matlab delivery confirm nahi hoti. Final delivery/read webhook se confirm hota hai.

## 12. Error Handling

### Error: Meta code 190

Meaning:

```txt
WhatsApp access token invalid/expired/wrong hai.
```

Fix:

```txt
Meta dashboard se new token generate karo.
.env.local me WHATSAPP_ACCESS_TOKEN replace karo.
Next.js server restart karo.
```

### Error: Invalid phone

Meaning:

```txt
Phone country code ke bina hai ya wrong format hai.
```

Fix:

```txt
Digits-only country code format use karo.
Example: 916376203488
```

### Error: Template not found

Meaning:

```txt
Template name/language wrong hai ya template approved nahi hai.
```

Fix:

```txt
Meta Business Manager me template name aur language verify karo.
```

### Error: Supabase insert failed

Meaning:

```txt
Service role key missing/wrong hai ya table permission issue hai.
```

Fix:

```txt
SUPABASE_SERVICE_ROLE_KEY check karo.
supabaseAdmin.ts backend client check karo.
whatsapp_messages table permission check karo.
```

## 13. Testing Process

### Test 1: GET Route Check

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

### Test 2: POST WhatsApp Send

Terminal:

```bash
curl -X POST http://localhost:3000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"916376203488"}'
```

### Test 3: Supabase Log Check

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

Expected:

```txt
status = sent
```

or if token/template error:

```txt
status = failed
```

## 14. Implementation Phases

### Phase 1: Manual API Send

Goal:

```txt
/api/whatsapp/send se one real WhatsApp message send ho aur Supabase me log save ho.
```

Tasks:

```txt
Token fix
POST curl test
Supabase log verify
WhatsApp received verify
```

Done criteria:

```txt
whatsapp_messages table me sent ya failed row automatic aaye.
```

### Phase 2: Lead Form Integration

Goal:

```txt
Website form submit ke baad WhatsApp welcome message automatically send ho.
```

Tasks:

```txt
Lead API inspect
Lead save ke baad WhatsApp send trigger
lead_id whatsapp_messages me save
Duplicate message prevention
```

Done criteria:

```txt
Form submit -> lead saved -> WhatsApp log created -> message sent
```

### Phase 3: Webhook + Dashboard

Goal:

```txt
Message delivery/read tracking dashboard me dikhe.
```

Tasks:

```txt
Webhook GET verification
Webhook POST status updates
Dashboard WhatsApp section
Status filters
Failure reports
```

Done criteria:

```txt
sent, delivered, read, failed lifecycle dashboard me visible ho.
```

### Phase 4: Production Setup

Goal:

```txt
Real business number se customer-ready automation run ho.
```

Tasks:

```txt
Real WhatsApp business number setup
Payment setup
Approved production templates
Consent checkbox
Permanent token/system user token
Webhook live URL
Vercel env variables
```

Done criteria:

```txt
Real website leads ko approved WhatsApp templates automatically receive hon.
```

## 15. Dashboard Requirements

Metrics:

```txt
Total messages
Queued messages
Sent messages
Delivered messages
Read messages
Failed messages
Success rate
Failure rate
```

Table:

```txt
Phone
Lead
Template
Status
Meta message ID
Error
Created at
Sent at
Delivered at
Read at
Failed at
```

Filters:

```txt
Date range
Status
Template
Phone search
Lead search
```

## 16. Final Recommended Build Order

```txt
1. Fix token and make /api/whatsapp/send fully working.
2. Confirm whatsapp_messages automatic logging.
3. Connect WhatsApp send after lead save.
4. Add consent field.
5. Create production welcome template.
6. Add webhook for delivery/read status.
7. Build dashboard section.
8. Move all env variables to Vercel.
9. Test production flow end to end.
```

