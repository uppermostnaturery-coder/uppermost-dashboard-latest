import { describe, expect, it } from "vitest";
import { authorizeMembership } from "../../lib/admin/policy";

describe("operator authorization", () => {
  it("denies anonymous callers, missing memberships and inactive memberships", () => {
    expect(() => authorizeMembership(null, null, false)).toThrow("UNAUTHENTICATED");
    expect(() => authorizeMembership("customer-auth-id", null, false)).toThrow("FORBIDDEN");
    expect(() => authorizeMembership("operator", { role: "ADMIN", active: false }, true)).toThrow("FORBIDDEN");
  });
  it("allows viewers to read but only admins to mutate", () => {
    expect(authorizeMembership("operator", { role: "VIEWER", active: true }, false)).toEqual({ userId: "operator", role: "VIEWER" });
    expect(() => authorizeMembership("operator", { role: "VIEWER", active: true }, true)).toThrow("FORBIDDEN");
    expect(authorizeMembership("operator", { role: "ADMIN", active: true }, true).role).toBe("ADMIN");
  });
});
