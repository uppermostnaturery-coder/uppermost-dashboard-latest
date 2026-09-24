import { NextResponse } from "next/server";
import { sendWhatsAppTemplate, WhatsAppApiError } from "../../../../lib/whatsapp/client";
import { getWhatsAppEnv } from "../../../../lib/whatsapp/env";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

function cleanPhone(phone: unknown) {
  return String(phone || "").replace(/\D/g, "");
}

function getMetaMessageId(result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "messages" in result &&
    Array.isArray((result as { messages?: unknown[] }).messages)
  ) {
    const firstMessage = (result as { messages: Array<{ id?: string }> }).messages[0];
    return firstMessage?.id || null;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      message: "Use POST request to send WhatsApp message.",
    },
    { status: 405 }
  );
}

export async function POST(req: Request) {
  let phone = "";
  let templateName = "";
  let templateLanguage = "";
  let requestPayload: Record<string, unknown> | null = null;

  try {
    const body = await req.json();
    const env = getWhatsAppEnv();

    phone = cleanPhone(body.phone);
    templateName = body.templateName || env.welcomeTemplate;
    templateLanguage = body.language || env.templateLanguage;

    if (!phone || phone.length < 10 || phone.length > 15) {
      return NextResponse.json(
        { success: false, error: "Valid phone number with country code is required" },
        { status: 400 }
      );
    }

    requestPayload = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: {
          code: templateLanguage,
        },
      },
    };

    const result = await sendWhatsAppTemplate({
      to: phone,
      templateName,
      language: templateLanguage,
    });

    const metaMessageId = getMetaMessageId(result);

    const { error: insertError } = await supabaseAdmin.from("whatsapp_messages").insert({
      phone,
      template_name: templateName,
      template_language: templateLanguage,
      status: "sent",
      meta_message_id: metaMessageId,
      request_payload: requestPayload,
      response_payload: result,
      sent_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("WhatsApp Supabase sent insert failed:", insertError);
    }

    return NextResponse.json({
      success: true,
      metaMessageId,
      result,
    });
  } catch (error) {
    console.error("WhatsApp send route failed:", error);

    const errorPayload =
      error instanceof WhatsAppApiError
        ? error.response
        : { message: getErrorMessage(error) };

    if (phone && templateName) {
      const { error: insertError } = await supabaseAdmin.from("whatsapp_messages").insert({
        phone,
        template_name: templateName,
        template_language: templateLanguage || "en_US",
        status: "failed",
        request_payload: requestPayload,
        error_payload: errorPayload,
        error_message: getErrorMessage(error),
        failed_at: new Date().toISOString(),
      });

      if (insertError) {
        console.error("WhatsApp Supabase failed insert failed:", insertError);
      }
    }

    if (error instanceof WhatsAppApiError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
          meta: error.response,
        },
        { status: error.status }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}