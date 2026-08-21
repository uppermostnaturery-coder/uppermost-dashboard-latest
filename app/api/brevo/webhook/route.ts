import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function normalizeEvent(event: string) {
  if (event === "request") return "sent";
  if (event === "click") return "clicked";
  if (event === "unique_opened") return "first_open";

  return event;
}

function getEventTimestamp(payload: any) {
  if (payload?.ts_event) {
    return new Date(Number(payload.ts_event) * 1000).toISOString();
  }

  if (payload?.ts_epoch) {
    const value = Number(payload.ts_epoch);

    return new Date(
      value > 10_000_000_000 ? value : value * 1000
    ).toISOString();
  }

  if (payload?.ts) {
    return new Date(Number(payload.ts) * 1000).toISOString();
  }

  return new Date().toISOString();
}

export async function POST(request: Request) {
      const authHeader = request.headers.get("authorization");
  const expectedToken = process.env.BREVO_WEBHOOK_TOKEN;

  if (!expectedToken) {
    console.error("BREVO_WEBHOOK_TOKEN is not configured");

    return NextResponse.json(
      { success: false, error: "Webhook authentication is not configured" },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${expectedToken}`) {
    return NextResponse.json(
      { success: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  try {
    const payload = await request.json();

    const tag = Array.isArray(payload?.tags)
      ? payload.tags.join(", ")
      : payload?.tag || null;

    const { error } = await supabaseAdmin
      .from("brevo_email_events")
      .insert({
        email: payload?.email || null,

        event: normalizeEvent(
          String(payload?.event || "unknown")
        ),

        message_id:
          payload?.["message-id"] ||
          payload?.message_id ||
          null,

        subject: payload?.subject || null,

        template_id:
          payload?.template_id !== undefined
            ? String(payload.template_id)
            : null,

        campaign_id:
          payload?.campaign_id !== undefined
            ? String(payload.campaign_id)
            : null,

        contact_id:
          payload?.contact_id !== undefined
            ? String(payload.contact_id)
            : null,

        tag,

        link: payload?.link || null,

        device:
          payload?.device_used ||
          payload?.device ||
          null,

        user_agent:
          payload?.user_agent ||
          null,

        event_timestamp:
          getEventTimestamp(payload),

        raw_payload: payload,
      });

    if (error) {
      console.error("SUPABASE BREVO WEBHOOK ERROR:", error);

      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error: any) {
    console.error("BREVO WEBHOOK ERROR:", error);

    return NextResponse.json(
      {
        success: false,
        error:
          error?.message ||
          "Webhook processing failed",
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    success: true,
    service: "Brevo webhook",
    status: "ready",
  });
}