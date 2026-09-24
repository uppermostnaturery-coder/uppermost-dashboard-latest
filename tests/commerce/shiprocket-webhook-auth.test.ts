import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const or = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ or }));
  const from = vi.fn(() => ({ select }));

  return { from, maybeSingle, or, select };
});

vi.mock("@/lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("@/lib/commerce/messages", () => ({
  createCustomerMessage: vi.fn(),
}));

describe("Shiprocket webhook authentication", () => {
  let POST: (request: Request) => Promise<Response>;
  let carrierEventsPOST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
    process.env.SHIPROCKET_PICKUP_POSTCODE = "122001";
    process.env.SHIPROCKET_WEBHOOK_SECRET = "shiprocket-test-secret";

    ({ POST } = await import("../../app/api/webhooks/shiprocket/route"));
    ({ POST: carrierEventsPOST } = await import(
      "../../app/api/webhooks/carrier-events/route"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  });

  function webhookRequest(headers?: HeadersInit) {
    return new Request("https://api.example.com/api/webhooks/shiprocket", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ awb: "AWB-TEST" }),
    });
  }

  it("accepts a valid x-api-key", async () => {
    const response = await POST(webhookRequest({ "x-api-key": "shiprocket-test-secret" }));

    expect(response.status).toBe(202);
    expect(mocks.from).toHaveBeenCalledWith("shipments");
  });

  it("serves the authenticated webhook through the carrier-events alias", async () => {
    const response = await carrierEventsPOST(
      webhookRequest({ "x-api-key": "shiprocket-test-secret" })
    );

    expect(response.status).toBe(202);
    expect(mocks.from).toHaveBeenCalledWith("shipments");
  });

  it("rejects an invalid x-api-key", async () => {
    const response = await POST(webhookRequest({ "x-api-key": "wrong-secret" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "INVALID_WEBHOOK_SECRET" },
    });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    const response = await POST(webhookRequest());

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("accepts the legacy X-Shiprocket-Webhook-Secret header", async () => {
    const response = await POST(webhookRequest({
      "X-Shiprocket-Webhook-Secret": "shiprocket-test-secret",
    }));

    expect(response.status).toBe(202);
    expect(mocks.from).toHaveBeenCalledWith("shipments");
  });

  it("treats x-api-key as authoritative when both headers are present", async () => {
    const response = await POST(webhookRequest({
      "x-api-key": "wrong-secret",
      "X-Shiprocket-Webhook-Secret": "shiprocket-test-secret",
    }));

    expect(response.status).toBe(401);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
