export function getBrevoServerEnv() {
  const BREVO_API_KEY = process.env.BREVO_API_KEY?.trim();
  const BREVO_API_BASE_URL = process.env.BREVO_API_BASE_URL?.trim() || "https://api.brevo.com/v3";
  const BREVO_MARKETING_LIST_ID = process.env.BREVO_MARKETING_LIST_ID?.trim();
  const BREVO_CUSTOMER_LIST_ID = process.env.BREVO_CUSTOMER_LIST_ID?.trim();
  const BREVO_WEBHOOK_TOKEN = process.env.BREVO_WEBHOOK_TOKEN?.trim();
  const BREVO_WELCOME_TEMPLATE_ID = process.env.BREVO_WELCOME_TEMPLATE_ID?.trim();

  return {
    BREVO_API_KEY,
    BREVO_API_BASE_URL,
    BREVO_MARKETING_LIST_ID,
    BREVO_CUSTOMER_LIST_ID,
    BREVO_WEBHOOK_TOKEN,
    BREVO_WELCOME_TEMPLATE_ID,
  };
}
