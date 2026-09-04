export function getBrevoServerEnv() {
  const BREVO_API_KEY = process.env.BREVO_API_KEY?.trim();
  const BREVO_API_BASE_URL =
    process.env.BREVO_API_BASE_URL?.trim() || "https://api.brevo.com/v3";
  const BREVO_MARKETING_LIST_ID =
    process.env.BREVO_MARKETING_LIST_ID?.trim();
  const BREVO_WELCOME_TEMPLATE_ID =
    process.env.BREVO_WELCOME_TEMPLATE_ID?.trim();

  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY is missing.");
  }

  return {
    BREVO_API_KEY,
    BREVO_API_BASE_URL,
    BREVO_MARKETING_LIST_ID,
    BREVO_WELCOME_TEMPLATE_ID,
  };
}
