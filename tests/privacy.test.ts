/* Consent, data export and account deletion (India's DPDP Act). */
import { describe, it, expect, beforeAll } from "vitest";
import { one, exec, withBusiness, withoutBusiness, setTestBusiness } from "@/lib/sql";
import { authorizeCredentials } from "@/lib/auth-options";
import { createInvite, acceptInvite, changeMember } from "@/lib/core/tenancy";
import { exportBusiness, exportMe, deleteAccount, TERMS_VERSION } from "@/lib/core/privacy";
import { createProduct } from "@/lib/core/catalog";
import * as Orders from "@/app/api/orders/route";
import { req, ctx } from "./request";
import type { Actor } from "@/lib/authz";

const bizOf = async (u: string) => (await withoutBusiness(() => one<{ business_id: string }>("SELECT business_id FROM memberships WHERE user_id = ? ORDER BY created_at LIMIT 1", [u])))!.business_id;
let A: Actor, B: Actor;
beforeAll(async () => {
  setTestBusiness(undefined);
  const a = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Anita", email: "anita@p.in", password: "anita-pass-1", business_name: "Anita Foods" }, "ip-p1");
  const b = await authorizeCredentials({ action: "register", accept_terms: "true", name: "Balu", email: "balu@p.in", password: "balu-pass-1", business_name: "Balu Boxes" }, "ip-p2");
  A = { ...a, role: "owner", businessId: await bizOf(a.id) }; B = { ...b, role: "owner", businessId: await bizOf(b.id) };
  await withBusiness(A.businessId, () => createProduct({ name: "Anita Pickle", price: 90, hsn_code: "2001", gst_rate: 5 }, A));
  await withBusiness(B.businessId, () => createProduct({ name: "Balu Carton", price: 20, hsn_code: "4819", gst_rate: 18 }, B));
});

describe("consent", () => {
  it("sign-up needs the terms accepted, and records which version and when", async () => {
    await expect(authorizeCredentials({ action: "register", name: "No Consent", email: "nc@p.in", password: "nconsent-1" }, "ip-p3")).rejects.toThrow(/accept the Terms/);
    expect(await withoutBusiness(() => one("SELECT terms_version FROM users WHERE id = ?", [A.id]))).toEqual({ terms_version: TERMS_VERSION });
    const inv = await withBusiness(A.businessId, () => createInvite({ email: "new@p.in", role: "staff" }, A));
    await expect(acceptInvite(inv.token, { email: "new@p.in", password: "new-pass-12", name: "New" })).rejects.toThrow(/accept the Terms/);
  });
});

describe("downloads", () => {
  it("a business export holds that business's data and nobody else's", async () => {
    const data = await withBusiness(A.businessId, () => exportBusiness(A)) as { products: { name: string }[]; team: { email: string }[] };
    expect(data.products.map((p) => p.name)).toEqual(["Anita Pickle"]);
    expect(JSON.stringify(data)).not.toContain("Balu Carton");
    expect(data.team.map((t) => t.email)).toEqual(["anita@p.in"]);
  });
  it("a personal export holds the person's details and never their password", async () => {
    const me = (await exportMe(A.id)) as unknown as { you: { email: string }; businesses: { name: string }[] };
    expect(me.you.email).toBe("anita@p.in");
    expect(me.businesses.map((b) => b.name)).toEqual(["Anita Foods"]);
    expect(JSON.stringify(me)).not.toMatch(/password_hash|\$2[aby]\$/);
  });
});

describe("deleting an account", () => {
  it("needs the password and DELETE, and won't leave a team without an owner", async () => {
    await expect(deleteAccount(A.id, "wrong-pass", "DELETE")).rejects.toThrow(/password is not correct/);
    await expect(deleteAccount(A.id, "anita-pass-1", "delete")).rejects.toThrow(/Type DELETE/);
    const inv = await withBusiness(A.businessId, () => createInvite({ email: "ravi@p.in", role: "staff" }, A));
    const ravi = await acceptInvite(inv.token, { email: "ravi@p.in", password: "ravi-pass-12", name: "Ravi", acceptTerms: true });
    await expect(deleteAccount(A.id, "anita-pass-1", "DELETE")).rejects.toThrow(/only owner of Anita Foods/);
    await withBusiness(A.businessId, () => changeMember({ user_id: ravi.id, role: "owner" }, A));
    const oldSession = await req("GET", "/api/orders", A.id, undefined, {}, A.businessId);
    expect(await deleteAccount(A.id, "anita-pass-1", "DELETE")).toEqual({ ok: true, businesses_closed: 0 });
    const u = await withoutBusiness(() => one<{ name: string; email: string; phone: string; active: number }>("SELECT name, email, phone, active FROM users WHERE id = ?", [A.id]));
    expect(u).toMatchObject({ name: "Deleted user", phone: "", active: 0 });
    expect(u!.email).not.toContain("anita");
    await expect(authorizeCredentials({ email: "anita@p.in", password: "anita-pass-1" })).rejects.toThrow("Email or password is incorrect.");
    expect((await Orders.GET(oldSession, ctx)).status).toBe(401);
    const names = await withBusiness(A.businessId, () => one<{ n: string }>("SELECT string_agg(DISTINCT user_name, ',') n FROM audit_log WHERE user_id = ?", [A.id]));
    expect(names!.n).toBe("Deleted user");
    expect(await withBusiness(A.businessId, () => one<{ c: number }>("SELECT COUNT(*) c FROM products"))).toEqual({ c: 1 }); // the business and its records continue under Ravi
  });
  it("a one-person business is closed when its owner leaves; its records stay for the GST retention period", async () => {
    expect(await deleteAccount(B.id, "balu-pass-1", "DELETE")).toEqual({ ok: true, businesses_closed: 1 });
    expect((await withoutBusiness(() => one<{ closed_at: string | null }>("SELECT closed_at FROM businesses WHERE id = ?", [B.businessId])))!.closed_at).toBeTruthy();
    expect(await withBusiness(B.businessId, () => one<{ c: number }>("SELECT COUNT(*) c FROM products"))).toEqual({ c: 1 });
  });
});
