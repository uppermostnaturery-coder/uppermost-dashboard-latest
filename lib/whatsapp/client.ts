import { getWhatsAppEnv } from "./env";
import {communicationSendSuppressionReason} from '../communications/sendSafety';

export class WhatsAppApiError extends Error {
  status: number;
  response: unknown;

  constructor(message: string, status: number, response: unknown) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
    this.response = response;
  }
}

export async function sendWhatsAppTemplate({
  to,
  templateName,
  language,
}: {
  to: string;
  templateName: string;
  language: string;
}) {
  const suppression=communicationSendSuppressionReason();
  if(suppression)throw new Error(suppression);
  const env = getWhatsAppEnv();

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: language,
      },
    },
  };

  const response = await fetch(
    `https://graph.facebook.com/${env.apiVersion}/${env.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new WhatsAppApiError("WhatsApp message send failed", response.status, data);
  }

  return data;
}
