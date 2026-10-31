/* Roles and permissions. Checked on the server for every request; the UI only hides what you can't use. */
import { getToken } from "next-auth/jwt";
import type { NextRequest } from "next/server";
import { authSecret } from "./env";
import { one, withoutBusiness } from "./sql";
import { activeMembership } from "./core/tenancy";
import { AppError, forbidden } from "./errors";

export type Role = "owner" | "manager" | "staff";
export const ROLES: { key: Role; label: string; help: string }[] = [
  { key: "owner", label: "Owner", help: "Everything, including team and business settings" },
  { key: "manager", label: "Manager", help: "Orders, bills, payments, stock and GST" },
  { key: "staff", label: "Staff", help: "Create and update orders; move them through dispatch and delivery" },
];

const P = {
  "orders.view": ["owner", "manager", "staff"],
  "orders.create": ["owner", "manager", "staff"],
  "orders.edit": ["owner", "manager", "staff"],
  "orders.advance": ["owner", "manager", "staff"],
  "orders.price_override": ["owner", "manager"],
  "orders.cancel": ["owner", "manager"],
  "invoices.create": ["owner", "manager"],
  "payments.record": ["owner", "manager"],
  "payments.void": ["owner"],
  "inventory.view": ["owner", "manager", "staff"],
  "inventory.receive": ["owner", "manager"],
  "inventory.adjust": ["owner", "manager"],
  "catalog.edit": ["owner", "manager"],
  "customers.edit": ["owner", "manager", "staff"],
  "money.view": ["owner", "manager"],
  "gst.view": ["owner", "manager"],
  "inbox.review": ["owner", "manager", "staff"],
  "settings.view": ["owner", "manager", "staff"],
  "settings.edit": ["owner"],
  "team.manage": ["owner"],
  "audit.view": ["owner", "manager"],
  "data.export": ["owner"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof P;

export const can = (role: string, perm: Permission) => (P[perm] as readonly string[]).includes(role);
export const permissionsFor = (role: string) => (Object.keys(P) as Permission[]).filter((k) => can(role, k));

export interface Actor { id: string; name: string; email: string; role: Role; businessId: string }
export const BUSINESS_COOKIE = "mj_business";
/** Sessions from before a password reset stop working. */
export const sessionStale = (token: unknown, current: number) => Number((token as { sv?: number } | null)?.sv ?? 1) !== Number(current ?? 1);

/** The signed-in, still-active user and the business this request acts for. Re-checked on every request,
    so removing someone from a business takes effect immediately. */
export async function requireUser(req: NextRequest, perm?: Permission): Promise<Actor> {
  const token = await getToken({ req, secret: authSecret() });
  const id = (token as { id?: string } | null)?.id;
  if (!id) throw new AppError(401, "Please sign in again.", "unauthorized");
  const u = await withoutBusiness(() => one<{ id: string; name: string; email: string; active: number; session_version: number }>("SELECT id, name, email, active, session_version FROM users WHERE id = ?", [id]));
  if (!u || !u.active) throw new AppError(401, "Your account is no longer active.", "unauthorized");
  if (sessionStale(token, u.session_version)) throw new AppError(401, "Your password was changed. Please sign in again.", "unauthorized");
  const m = await activeMembership(u.id, req.cookies.get(BUSINESS_COOKIE)?.value);
  if (!m) throw new AppError(403, "You're not part of any business yet. Create one or ask for an invite.", "no_business");
  if (perm && !can(m.role, perm)) throw forbidden();
  return { id: u.id, name: u.name, email: u.email, role: m.role, businessId: m.id };
}
