import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { one, exec, withoutBusiness } from "@/lib/sql";
import { authorizeCredentials } from "@/lib/auth-options";
import { _resetGuard } from "@/lib/login-guard";
import { can } from "@/lib/authz";
import { req, ctx } from "./request";
import * as Team from "@/app/api/team/route";
import * as Payments from "@/app/api/payments/route";
import * as Orders from "@/app/api/orders/route";
import * as Business from "@/app/api/business/route";
import * as Overview from "@/app/api/overview/route";
import * as Me from "@/app/api/me/route";
import { seedPilotBusiness, staff, manager, owner, TELIX } from "./helpers";

beforeEach(async () => { await withoutBusiness(() => _resetGuard()); });

describe("sign-up and sign-in", () => {
  it("sign-up creates a person, their own business and an owner membership — no setup code", async () => {
    const u = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Asha Mehta", email: "Asha@Example.in", password: "strongpass1", business_name: "Mehta Plastics" }, "ip-1");
    const m = await withoutBusiness(() => one<{ role: string; name: string }>("SELECT m.role, b.name FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = ?", [u.id]));
    expect(m).toEqual({ role: "owner", name: "Mehta Plastics" });
    await expect(authorizeCredentials({ action: "register", accept_terms: "true", name: "Asha again", email: "asha@example.in", password: "strongpass1" }, "ip-1")).rejects.toThrow(/already exists/);
    await expect(authorizeCredentials({ action: "register", accept_terms: "true", name: "X", email: "x@example.in", password: "short" }, "ip-1")).rejects.toThrow();
  });
  it("limits sign-ups per network", async () => {
    for (let i = 0; i < 5; i++) await authorizeCredentials({ action: "register", accept_terms: "true", name: "Bulk User", email: `bulk${i}@spam.in`, password: "strongpass1" }, "ip-spam").catch(() => {});
    await expect(authorizeCredentials({ action: "register", accept_terms: "true", name: "Bulk User", email: "bulk9@spam.in", password: "strongpass1" }, "ip-spam")).rejects.toThrow(/Too many sign-ups/);
  });
  it("gives one generic message for a wrong email or password, and locks after 5 failures", async () => {
    await expect(authorizeCredentials({ email: "nobody@example.in", password: "whatever1" })).rejects.toThrow("Email or password is incorrect.");
    await expect(authorizeCredentials({ email: "asha@example.in", password: "wrongpass1" })).rejects.toThrow("Email or password is incorrect.");
    for (let i = 0; i < 4; i++) await authorizeCredentials({ email: "asha@example.in", password: "wrongpass1" }).catch(() => {});
    await expect(authorizeCredentials({ email: "asha@example.in", password: "strongpass1" })).rejects.toThrow(/Too many attempts/);
  });
});

describe("roles are enforced on the server", () => {
  beforeAll(async () => { await seedPilotBusiness(); });
  it("has the intended permission matrix", () => {
    expect(can("staff", "orders.create")).toBe(true);
    expect(["payments.record", "invoices.create", "orders.cancel", "orders.price_override", "team.manage", "settings.edit", "money.view"].map((p) => can("staff", p as never))).toEqual(Array(7).fill(false));
    expect(can("manager", "payments.record")).toBe(true);
    expect(can("manager", "team.manage")).toBe(false);
  });
  it("rejects requests with no session, and staff calling owner/manager APIs", async () => {
    expect((await Orders.GET(await req("GET", "/api/orders"), ctx)).status).toBe(401);
    expect((await Team.GET(await req("GET", "/api/team", staff.id), ctx)).status).toBe(403);
    expect((await Payments.POST(await req("POST", "/api/payments", staff.id, { order_id: "x", amount: 1 }), ctx)).status).toBe(403);
    expect((await Business.POST(await req("POST", "/api/business", manager.id, { company_name: "Hacked" }), ctx)).status).toBe(403);
    expect((await Orders.PATCH(await req("PATCH", "/api/orders", staff.id, { id: "x", action: "cancel", reason: "no" }), ctx)).status).toBe(403);
  });
  it("hides money figures from staff on the overview", async () => {
    const s = await (await Overview.GET(await req("GET", "/api/overview", staff.id), ctx)).json();
    expect(s.canSeeMoney).toBe(false);
    expect(s.stats.receivables).toBeNull();
    expect((await (await Overview.GET(await req("GET", "/api/overview", manager.id), ctx)).json()).canSeeMoney).toBe(true);
  });
  it("removing someone from the business locks them out at once", async () => {
    expect((await Orders.GET(await req("GET", "/api/orders", staff.id), ctx)).status).toBe(200);
    expect((await Team.PATCH(await req("PATCH", "/api/team", owner.id, { user_id: staff.id, active: false }), ctx)).status).toBe(200);
    expect((await Orders.GET(await req("GET", "/api/orders", staff.id), ctx)).status).toBe(403);
    expect((await (await Me.GET(await req("GET", "/api/me", staff.id))).json()).businesses).toEqual([]);
    await Team.PATCH(await req("PATCH", "/api/team", owner.id, { user_id: staff.id, active: true }), ctx);
  });
  it("every business keeps an active owner, and owners can't change themselves", async () => {
    expect((await Team.PATCH(await req("PATCH", "/api/team", owner.id, { user_id: owner.id, role: "staff" }), ctx)).status).toBe(400);
    await withoutBusiness(() => exec("UPDATE memberships SET role = 'owner' WHERE user_id = ? AND business_id = ?", [manager.id, TELIX]));
    expect((await Team.PATCH(await req("PATCH", "/api/team", manager.id, { user_id: owner.id, active: false }), ctx)).status).toBe(200);
    expect((await Team.PATCH(await req("PATCH", "/api/team", manager.id, { user_id: manager.id, role: "staff" }), ctx)).status).toBe(400);
    await withoutBusiness(() => exec("UPDATE memberships SET active = 1 WHERE user_id = ?", [owner.id]));
    expect((await Team.PATCH(await req("PATCH", "/api/team", owner.id, { user_id: manager.id, role: "manager" }), ctx)).status).toBe(200);
    // now Ramesh is the only owner; nobody can remove him
    await withoutBusiness(() => exec("INSERT INTO users (id, name, email, password_hash) VALUES ('u-x', 'X', 'x@t.in', 'x') ON CONFLICT DO NOTHING"));
  });
  it("never leaks internals in error responses", async () => {
    const r = await Orders.POST(await req("POST", "/api/orders", manager.id, { customer: { id: "c-hfl" }, items: [{ product_id: "'; DROP TABLE orders; --", qty: 1 }] }), ctx);
    const j = await r.json();
    expect(r.status).toBe(400);
    expect(j.error).toMatch(/isn't in your catalog/);
    expect(JSON.stringify(j)).not.toMatch(/stack|postgres|at Object/i);
  });
});
