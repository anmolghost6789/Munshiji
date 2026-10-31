/* The four issues reported from the pilot deployment, each reproduced and fixed. */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { execFileSync } from "child_process";
import { one, many, exec, withBusiness, withoutBusiness } from "@/lib/sql";
import { createContact, updateContact } from "@/lib/core/contacts";
import { emailFrom, emailStatus, TEST_SENDER } from "@/lib/email";
import * as Customers from "@/app/api/customers/route";
import * as Suppliers from "@/app/api/suppliers/route";
import * as Orders from "@/app/api/orders/route";
import * as Me from "@/app/api/me/route";
import * as Session from "@/app/api/session/business/route";
import * as Businesses from "@/app/api/businesses/route";
import * as Email from "@/app/api/email/route";
import { req, ctx } from "./request";
import { owner, staff, TELIX, seedPilotBusiness } from "./helpers";

beforeAll(async () => { await seedPilotBusiness(); });

describe("Contacts: add and edit customers and suppliers", () => {
  it("adds a customer; GSTIN is checked and sets the state; duplicates and bad input are refused", async () => {
    const r = await Customers.POST(await req("POST", "/api/customers", staff.id, { name: "Deccan Agro Products", phone: "+91 98490 45678" }), ctx);
    expect(r.status).toBe(201); // staff can add a customer
    const ok = await createContact("customer", { name: "Mehta Pharma", phone: "098250 34567", gstin: "24aagfm4321d1zu", email: "Accounts@Mehta.in" }, owner);
    const c = await one<{ phone: string; state_code: string; email: string; gstin: string }>("SELECT phone, state_code, email, gstin FROM customers WHERE id = ?", [ok.id]);
    expect(c).toEqual({ phone: "9825034567", state_code: "24", email: "accounts@mehta.in", gstin: "24AAGFM4321D1ZU" }); // Gujarat, from the GSTIN
    await expect(createContact("customer", { name: "Copy Co", gstin: "24AAGFM4321D1ZU" }, owner)).rejects.toThrow(/Mehta Pharma already has this GSTIN/);
    await expect(createContact("customer", { name: "Typo Co", gstin: "24AAGFM4321D1ZX" }, owner)).rejects.toThrow(/last character/);
    await expect(createContact("customer", { name: "Bad Mail", email: "not-an-email" }, owner)).rejects.toThrow(/valid email/);
    await expect(createContact("customer", { name: "Short", phone: "12345" }, owner)).rejects.toThrow(/10-digit/);
  });
  it("a customer without a GSTIN keeps the state you choose (used for IGST); edits are saved", async () => {
    const { id } = await createContact("customer", { name: "Anita Rao", phone: "9845011111", state_code: "29" }, owner);
    await updateContact("customer", { id, name: "Anita Rao (Bengaluru)", email: "anita@rao.in" }, owner);
    expect(await one("SELECT name, email, state_code FROM customers WHERE id = ?", [id])).toEqual({ name: "Anita Rao (Bengaluru)", email: "anita@rao.in", state_code: "29" });
    const r = await Customers.PATCH(await req("PATCH", "/api/customers", owner.id, { id, phone: "98450 22222" }), ctx);
    expect(r.status).toBe(200);
  });
  it("adds suppliers too, with the same GSTIN check (their GSTIN is what makes input credit count)", async () => {
    const r = await Suppliers.POST(await req("POST", "/api/suppliers", owner.id, { name: "Pune Electronics Distributors", gstin: "27AAKFP3344Q1ZL", phone: "9822000000" }), ctx);
    expect(r.status).toBe(201);
    const bad = await Suppliers.POST(await req("POST", "/api/suppliers", owner.id, { name: "Fake Supplier", gstin: "27AAPFU0939F1ZX" }), ctx);
    expect(bad.status).toBe(400);
    const { id } = await r.json();
    await updateContact("supplier", { id, email: "sales@ped.in" }, owner);
    expect((await one<{ email: string; state_code: string }>("SELECT email, state_code FROM suppliers WHERE id = ?", [id]))).toEqual({ email: "sales@ped.in", state_code: "27" });
    expect((await Suppliers.POST(await req("POST", "/api/suppliers", staff.id, { name: "Staff Supplier" }), ctx)).status).toBe(403); // staff can add customers, not suppliers
  });
});

describe("“Everyone is tagged to Sharma”: people stuck in one shared business", () => {
  let other: string;
  it("remembers the business you last chose, even without this browser's cookie", async () => {
    other = "b-own";
    await withoutBusiness(async () => {
      await exec("INSERT INTO businesses (id, name) VALUES ('b-own', 'Staff Own Shop') ON CONFLICT DO NOTHING");
      await exec("INSERT INTO memberships (user_id, business_id, role) VALUES (?, 'b-own', 'owner') ON CONFLICT DO NOTHING", [staff.id]);
    });
    expect((await Session.POST(await req("POST", "/api/session/business", staff.id, { business_id: other }))).status).toBe(200);
    const me = await (await Me.GET(await req("GET", "/api/me", staff.id))).json(); // no cookie sent
    expect(me.current.id).toBe(other);
  });
  it("someone with no business gets a way to create one (not an error)", async () => {
    await withoutBusiness(async () => {
      await exec("INSERT INTO users (id, name, email, password_hash) VALUES ('u-lone', 'Lone Tester', 'lone@x.in', 'x') ON CONFLICT DO NOTHING");
    });
    expect((await (await Me.GET(await req("GET", "/api/me", "u-lone"))).json()).businesses).toEqual([]);
    expect((await Orders.GET(await req("GET", "/api/orders", "u-lone"), ctx)).status).toBe(403);
    expect((await Businesses.POST(await req("POST", "/api/businesses", "u-lone", { name: "Lone Traders" }))).status).toBe(201);
    expect((await (await Me.GET(await req("GET", "/api/me", "u-lone"))).json()).current.name).toBe("Lone Traders");
  });
  it("the repair command moves everyone except the named owner out of the shared business", async () => {
    await withoutBusiness(async () => {
      await exec("INSERT INTO businesses (id, name) VALUES ('b-sharma', 'Sharma Corrugated Industries') ON CONFLICT DO NOTHING");
      for (const [id, email] of [["u-s1", "sharma@owner.in"], ["u-s2", "tester2@x.in"], ["u-s3", "tester3@x.in"]]) {
        await exec("INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, 'x') ON CONFLICT DO NOTHING", [id, email.split("@")[0], email]);
        await exec("INSERT INTO memberships (user_id, business_id, role) VALUES (?, 'b-sharma', ?) ON CONFLICT DO NOTHING", [id, id === "u-s1" ? "owner" : "manager"]);
      }
      await exec("INSERT INTO businesses (id, name) VALUES ('b-t3', 'Tester3 Shop') ON CONFLICT DO NOTHING");
      await exec("INSERT INTO memberships (user_id, business_id, role) VALUES ('u-s3', 'b-t3', 'owner') ON CONFLICT DO NOTHING");
    });
    const run = (...a: string[]) => execFileSync("node", ["scripts/split-business.mjs", ...a], { env: { ...process.env, DATABASE_URL: process.env.TEST_ADMIN_DATABASE_URL }, encoding: "utf8" });
    expect(() => run("--business", "Sharma Corrugated Industries", "--keep", "tester2@x.in")).toThrow(); // must keep an owner
    const plan = run("--business", "Sharma Corrugated Industries", "--keep", "sharma@owner.in");
    expect(plan).toMatch(/Nothing changed/);
    expect(await withoutBusiness(() => one<{ c: number }>("SELECT COUNT(*)::int c FROM memberships WHERE business_id = 'b-sharma' AND active = 1"))).toEqual({ c: 3 });
    run("--business", "Sharma Corrugated Industries", "--keep", "sharma@owner.in", "--yes");
    const left = await withoutBusiness(() => many<{ email: string }>("SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = 'b-sharma' AND m.active = 1"));
    expect(left.map((x) => x.email)).toEqual(["sharma@owner.in"]);
    const t2 = await withoutBusiness(() => many<{ name: string; role: string }>("SELECT b.name, m.role FROM memberships m JOIN businesses b ON b.id = m.business_id WHERE m.user_id = 'u-s2' AND m.active = 1"));
    expect(t2).toEqual([{ name: "tester2's business", role: "owner" }]);
    expect((await (await Me.GET(await req("GET", "/api/me", "u-s3"))).json()).current.name).toBe("Tester3 Shop");
  });
});

describe("Email through Resend: visible and forgiving", () => {
  const saved = { ...process.env };
  afterAll(() => { process.env = saved; vi.unstubAllGlobals(); });
  it("accepts common sender settings; with only a key it uses Resend's test sender and says so", () => {
    delete process.env.MUNSHIJI_EMAIL_FROM; process.env.RESEND_API_KEY = "re_x"; process.env.RESEND_FROM = "Munshiji <hi@ok.in>";
    expect(emailFrom()).toBe("Munshiji <hi@ok.in>");
    delete process.env.RESEND_FROM;
    expect(emailFrom()).toBe(TEST_SENDER);
    expect(emailStatus().problem).toMatch(/test sender/);
    delete process.env.RESEND_API_KEY;
    expect(emailStatus()).toMatchObject({ configured: false, problem: expect.stringMatching(/RESEND_API_KEY is not set/) });
  });
  it("the test button shows Resend's exact error, and the failure appears under recent emails", async () => {
    process.env.RESEND_API_KEY = "re_x"; process.env.MUNSHIJI_EMAIL_FROM = "Munshiji <hello@unverified.in>";
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ statusCode: 403, name: "validation_error", message: "The unverified.in domain is not verified." }), { status: 403 }));
    const r = await (await Email.POST(await req("POST", "/api/email", owner.id, {}, {}, TELIX), ctx)).json();
    expect(r).toMatchObject({ sent: false, error: "Resend 403: The unverified.in domain is not verified." });
    const st = await (await Email.GET(await req("GET", "/api/email", owner.id, undefined, {}, TELIX), ctx)).json();
    expect(st.recent[0]).toMatchObject({ kind: "test", status: "failed", recipient: owner.email });
    expect((await Email.POST(await req("POST", "/api/email", staff.id, {}, {}, TELIX), ctx)).status).toBe(403);
  });
});
