export type AdminRole = "ADMIN" | "VIEWER";
export class AdminError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

// Membership comes from a server-owned table, never editable Auth metadata.
export function authorizeMembership(userId: string | null, membership: { role: string; active: boolean } | null, mutation: boolean) {
  if (!userId) throw new AdminError("UNAUTHENTICATED", 401);
  if (!membership?.active || !["ADMIN", "VIEWER"].includes(membership.role) || (mutation && membership.role !== "ADMIN")) {
    throw new AdminError("FORBIDDEN", 403);
  }
  return { userId, role: membership.role as AdminRole };
}
