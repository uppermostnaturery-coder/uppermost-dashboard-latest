function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

export function getWhatsAppEnv() {
  return {
    apiVersion: process.env.WHATSAPP_API_VERSION || "v25.0",
    accessToken: requiredEnv("WHATSAPP_ACCESS_TOKEN"),
    phoneNumberId: requiredEnv("WHATSAPP_PHONE_NUMBER_ID"),
    businessAccountId: requiredEnv("WHATSAPP_BUSINESS_ACCOUNT_ID"),
    welcomeTemplate: process.env.WHATSAPP_WELCOME_TEMPLATE || "hello_world",
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en_US",
  };
}