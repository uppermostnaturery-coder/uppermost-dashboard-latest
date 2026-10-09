import { requireAdmin, adminErrorResponse, assertSameOrigin } from "@/lib/admin/auth";
import { legacyWhatsAppWelcome } from "@/lib/whatsapp/legacy";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request, true);
    return await legacyWhatsAppWelcome(request);
  } catch (error) { return adminErrorResponse(error); }
}
