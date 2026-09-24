# WhatsApp Lead Trigger Workflow

## Goal

Website form submit hone ke baad customer ka lead Supabase me save hoga. Uske turant baad backend WhatsApp Cloud API ke through customer ko automatic welcome message bhejega. Har message ka status Supabase me track hoga.

## Required Connectivity

```txt
Website form
  -> Next.js lead API
  -> Supabase lead table
  -> WhatsApp send logic
  -> Supabase whatsapp_messages table
  -> Meta WhatsApp Cloud API
  -> Customer WhatsApp
  -> Meta webhook
  -> Supabase status update
  -> Dashboard
```

## Required Pieces

### 1. Website Form

Form me ye fields required honi chahiye:

```txt
name
email
phone / whatsapp_phone
country_code
message / product_interest
whatsapp_consent
```

Minimum automation ke liye required:

```txt
phone with country code
```

Production ke liye recommended:

```txt
name
email
phone
whatsapp_consent
```

### 2. Lead API

Form submit hone par frontend backend ko hit karega.

Possible route:

```txt
POST /api/lead
```

Ya existing route:

```txt
POST /api/launch-signup
```

Lead API ka kaam:

1. Form data receive karna.
2. Basic validation karna.
3. Phone number normalize karna.
4. Lead Supabase me save karna.
5. Lead ID receive karna.
6. WhatsApp send trigger karna.

### 3. Supabase Lead Table

Lead data likely `public.um_leads` me save hoga.

Required fields:

```txt
id
name
email
phone
country_code
whatsapp_phone
whatsapp_consent
whatsapp_consent_at
source
created_at
```

If table already exists, new fields add karne pad sakte hain.

### 4. WhatsApp Send API

Current route:

```txt
POST /api/whatsapp/send
```

Request body:

```json
{
  "phone": "916376203488",
  "templateName": "hello_world",
  "language": "en_US",
  "leadId": "lead-uuid",
  "email": "customer@example.com"
}
```

This route should:

1. Phone clean kare.
2. `whatsapp_messages` me `queued` row create kare.
3. Meta WhatsApp API hit kare.
4. Success par row ko `sent` update kare.
5. Fail par row ko `failed` update kare.

### 5. Supabase WhatsApp Messages Table

Table:

```txt
public.whatsapp_messages
```

Purpose:

```txt
Har WhatsApp message ka complete log store karna.
```

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

Status flow:

```txt
queued -> sent -> delivered -> read
queued -> failed
sent -> failed
```

### 6. Meta WhatsApp Cloud API

Endpoint:

```txt
POST https://graph.facebook.com/v25.0/{WHATSAPP_PHONE_NUMBER_ID}/messages
```

Headers:

```txt
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json
```

Template payload:

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

Meta success response me `messages[0].id` milta hai. Isko `meta_message_id` me save karna hai.

### 7. Webhook

Webhook later add hoga.

Routes:

```txt
GET /api/whatsapp/webhook
POST /api/whatsapp/webhook
```

GET route:

```txt
Meta verification challenge handle karega.
```

POST route:

```txt
Meta delivery/read/failed status receive karega.
```

Webhook se update hone wale statuses:

```txt
sent
delivered
read
failed
```

## Full Automation Process

### Step 1: User Form Fill Karega

User website par form fill karega:

```txt
Name: Rahul
Email: rahul@example.com
Phone: 6376203488
Country: India +91
Consent: checked
```

Frontend final phone banayega:

```txt
916376203488
```

### Step 2: Frontend Lead API Hit Karega

Frontend backend ko request bhejega:

```txt
POST /api/lead
```

Example:

```json
{
  "name": "Rahul",
  "email": "rahul@example.com",
  "phone": "916376203488",
  "whatsappConsent": true,
  "source": "website_form"
}
```

### Step 3: Backend Lead Validate Karega

Backend check karega:

```txt
phone exists
phone country code ke sath hai
email valid hai
consent true hai, if production rule enabled
```

### Step 4: Lead Supabase Me Save Hoga

Backend Supabase me insert karega:

```txt
insert into public.um_leads
```

Insert ke baad lead ID milega:

```txt
lead_id = uuid
```

### Step 5: WhatsApp Trigger Condition Check Hoga

Send condition:

```txt
phone exists
AND phone valid
AND template exists
AND no duplicate welcome already sent for this lead
AND consent true, if production consent enabled
```

### Step 6: WhatsApp Queued Row Create Hogi

Backend `public.whatsapp_messages` me row create karega:

```txt
status = queued
lead_id = saved lead id
phone = customer phone
template_name = welcome template
```

### Step 7: Meta WhatsApp API Hit Hogi

Backend Meta endpoint ko call karega:

```txt
POST /{PHONE_NUMBER_ID}/messages
```

### Step 8: Success Ya Failure Save Hoga

If Meta accepts:

```txt
status = sent
meta_message_id = wamid...
sent_at = now()
```

If Meta rejects:

```txt
status = failed
error_payload = Meta error
failed_at = now()
```

### Step 9: Customer Ko WhatsApp Message Milega

Customer ke WhatsApp par approved template message receive hoga.

### Step 10: Webhook Final Status Update Karega

Meta webhook later events bhejega:

```txt
sent
delivered
read
failed
```

Backend `meta_message_id` ke basis par row update karega.

## APIs That Will Be Hit

### Frontend to Backend

```txt
POST /api/lead
```

### Backend to Supabase

```txt
insert into public.um_leads
insert/update public.whatsapp_messages
```

### Backend to Internal WhatsApp Route

```txt
POST /api/whatsapp/send
```

or direct helper call:

```txt
sendWhatsAppTemplate()
```

### Backend to Meta

```txt
POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages
```

### Meta to Backend

```txt
GET /api/whatsapp/webhook
POST /api/whatsapp/webhook
```

## Pending Work

### Required For Lead Automation

1. Existing lead form route identify karna.
2. Lead form me WhatsApp phone field confirm karna.
3. Country code handling add karna.
4. Lead API me WhatsApp trigger connect karna.
5. `lead_id`, `email`, and `name` ko WhatsApp log me save karna.
6. Duplicate welcome prevention add karna.
7. Supabase automatic log verify karna.
8. Production welcome template create karna.

### Required For Production

1. Real WhatsApp business number setup.
2. Payment setup in Meta.
3. Permanent/System User access token.
4. Approved welcome template.
5. Consent checkbox.
6. Webhook live URL.
7. Vercel env variables.
8. Dashboard WhatsApp section.

## Duplicate Prevention

Welcome message duplicate na jaye, iske liye check:

```sql
select id
from public.whatsapp_messages
where lead_id = 'LEAD_ID'
  and template_name = 'uppermost_welcome'
  and status in ('queued', 'sent', 'delivered', 'read')
limit 1;
```

If row exists:

```txt
Do not send again.
```

## Recommended Phase Plan

### Phase 1: Completed / Almost Completed

Goal:

```txt
Manual WhatsApp API send working.
```

Current result:

```txt
success: true
message_status: accepted
```

Remaining:

```txt
Supabase auto log verify.
```

### Phase 2: Lead Form Trigger

Goal:

```txt
Form submit ke baad automatic welcome message send ho.
```

Tasks:

```txt
Lead API inspect
Lead save ke baad WhatsApp send call
lead_id attach
duplicate prevention
test form submission
```

### Phase 3: Webhook Status Tracking

Goal:

```txt
delivered/read/failed lifecycle track ho.
```

Tasks:

```txt
GET webhook verification
POST webhook parser
meta_message_id based update
status timestamps
```

### Phase 4: Dashboard And Production

Goal:

```txt
Business-ready WhatsApp automation.
```

Tasks:

```txt
Dashboard metrics
Production template
Permanent token
Vercel env
Payment
Real business number
End-to-end live test
```

## Success Criteria

Automation complete tab maana jayega jab:

```txt
Website form submit hota hai
lead Supabase me save hoti hai
whatsapp_messages me queued row banti hai
Meta message accepted hota hai
row sent update hoti hai
customer ko WhatsApp message receive hota hai
webhook delivered/read status update karta hai
dashboard me message visible hota hai
```

