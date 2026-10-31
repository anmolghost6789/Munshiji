/* Sign-up starts with a choice: set up my business, or join my team (invite code, or ask the owner). */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import crypto from "crypto";
import { one, many, exec, withBusiness, withoutBusiness } from "@/lib/sql";
import { authorizeCredentials } from "@/lib/auth-options";
import { createInvite, normCode } from "@/lib/core/tenancy";
import { requestToJoin, myJoinRequests } from "@/lib/core/joining";
import { _resetGuard } from "@/lib/login-guard";
import * as Me from "@/app/api/me/route";
import * as JoinCode from "@/app/api/join/code/route";
import * as JoinReq from "@/app/api/join/request/route";
import * as Team from "@/app/api/team/route";
import { req, ctx } from "./request";
import { owner, TELIX, seedPilotBusiness } from "./helpers";

const businessesOf = async (u: string) => (await (await Me.GET(await req("GET", "/api/me", u))).json()).businesses as { name: string; role: string }[];
beforeAll(async () => { await seedPilotBusiness(); await withoutBusiness(() => exec("UPDATE users SET phone = '9876500001' WHERE id = ?", [owner.id])); });
beforeEach(async () => { await withoutBusiness(() => _resetGuard()); });

describe("sign-up: two paths", () => {
  it("“Set up my business” creates the business; “Join my team” creates only the account", async () => {
    const o = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "own", name: "Ravi K", email: "ravi@ke.in", password: "ravi-pass-1", business_name: "Kulkarni Electronics" }, "ip-o");
    expect(await businessesOf(o.id)).toEqual([{ id: expect.any(String), name: "Kulkarni Electronics", role: "owner" }]);
    const j = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Amit P", email: "amit@ke.in", password: "amit-pass-1" }, "ip-j");
    expect(await businessesOf(j.id)).toEqual([]);
  });
});

describe("invite codes", () => {
  let code = "";
  it("an invite has a short code (stored only as a hash) and doesn't need an email", async () => {
    const inv = await withBusiness(TELIX, () => createInvite({ role: "staff", phone: "98765 11111" }, owner));
    code = inv.code;
    expect(code).toMatch(/^[A-Z]{2}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{2}$/);
    expect(JSON.stringify(await withoutBusiness(() => many("SELECT * FROM invites")))).not.toContain(normCode(code));
    expect((await withoutBusiness(() => one<{ code_hash: string }>("SELECT code_hash FROM invites WHERE id = ?", [inv.id])))!.code_hash).toBe(crypto.createHash("sha256").update(normCode(code)).digest("hex"));
  });
  it("a signed-in person joins with the code (typed any way); it works once", async () => {
    const u = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Sunil", email: "sunil@x.in", password: "sunil-pass-1" }, "ip-s");
    const r = await JoinCode.POST(await req("POST", "/api/join/code", u.id, { code: ` ${code.toLowerCase().replace(/-/g, " ")} ` }));
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/mj_business=/);
    expect(await businessesOf(u.id)).toEqual([{ id: TELIX, name: "Telix Traders", role: "staff" }]);
    const again = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Late", email: "late@x.in", password: "late-pass-12" }, "ip-l");
    expect((await JoinCode.POST(await req("POST", "/api/join/code", again.id, { code }))).status).toBe(400);
  });
  it("wrong guesses are limited, so codes can't be guessed", async () => {
    const g = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Guesser", email: "guess@x.in", password: "guess-pass-1" }, "ip-g");
    for (let i = 0; i < 5; i++) await JoinCode.POST(await req("POST", "/api/join/code", g.id, { code: `TT-ABCD-E${i + 2}` }));
    expect((await JoinCode.POST(await req("POST", "/api/join/code", g.id, { code: "TT-ABCD-EF" }))).status).toBe(429);
  });
  it("an invite sent to an email can only be used by that email", async () => {
    const inv = await withBusiness(TELIX, () => createInvite({ email: "meena@x.in", role: "manager" }, owner));
    const other = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Other", email: "other@x.in", password: "other-pass-1" }, "ip-x");
    const r = await (await JoinCode.POST(await req("POST", "/api/join/code", other.id, { code: inv.code }))).json();
    expect(r.error).toMatch(/different email/);
  });
  it("someone can sign up and join in one step by typing the code on the sign-up form", async () => {
    const inv = await withBusiness(TELIX, () => createInvite({ role: "staff" }, owner));
    const u = await authorizeCredentials({ action: "accept_invite", accept_terms: "true", token: inv.code, name: "Neha", email: "neha@x.in", password: "neha-pass-12" }, "ip-n");
    expect(await businessesOf(u.id)).toEqual([{ id: TELIX, name: "Telix Traders", role: "staff" }]);
  });
});

describe("asking to join", () => {
  let asker: { id: string };
  it("asking by the owner's phone or email gives the same answer as asking someone who isn't on Munshiji", async () => {
    asker = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Kiran", email: "kiran@x.in", password: "kiran-pass-1" }, "ip-k");
    const known = await (await JoinReq.POST(await req("POST", "/api/join/request", asker.id, { contact: "+91 98765 00001" }))).json();
    const unknown = await (await JoinReq.POST(await req("POST", "/api/join/request", asker.id, { contact: "nobody@nowhere.in" }))).json();
    expect(known.message.replace("98765 00001", "X")).toBe(unknown.message.replace("nobody@nowhere.in", "X"));
    const mine = await myJoinRequests(asker.id);
    expect(mine.map((r) => [r.contact, r.status]).sort()).toEqual([["98765 00001", "pending"], ["nobody@nowhere.in", "pending"]]);
    expect(JSON.stringify(mine)).not.toContain("Telix"); // never reveals which business matched
  });
  it("the owner sees the request, lets them in with a role, and they're in", async () => {
    expect((await (await Me.GET(await req("GET", "/api/me", owner.id, undefined, {}, TELIX))).json()).join_requests).toBe(1);
    const t = await (await Team.GET(await req("GET", "/api/team", owner.id, undefined, {}, TELIX), ctx)).json();
    expect(t.requests.map((r: { name: string }) => r.name)).toEqual(["Kiran"]);
    expect((await Team.PATCH(await req("PATCH", "/api/team", owner.id, { request_id: t.requests[0].id, decision: "approve", role: "manager" }, {}, TELIX), ctx)).status).toBe(200);
    expect(await businessesOf(asker.id)).toEqual([{ id: TELIX, name: "Telix Traders", role: "manager" }]);
    expect((await Team.PATCH(await req("PATCH", "/api/team", owner.id, { request_id: t.requests[0].id, decision: "decline" }, {}, TELIX), ctx)).status).toBe(409);
  });
  it("owners can decline; only owners receive requests; limits stop spamming", async () => {
    const d = await authorizeCredentials({ action: "register", accept_terms: "true", intent: "join", name: "Stranger", email: "stranger@x.in", password: "strange-pass-1" }, "ip-st");
    await requestToJoin(d.id, "owner@telix.test");
    const t = await (await Team.GET(await req("GET", "/api/team", owner.id, undefined, {}, TELIX), ctx)).json();
    await Team.PATCH(await req("PATCH", "/api/team", owner.id, { request_id: t.requests[0].id, decision: "decline" }, {}, TELIX), ctx);
    expect((await myJoinRequests(d.id))[0].status).toBe("declined");
    expect(await businessesOf(d.id)).toEqual([]);
    await requestToJoin(d.id, "staff@telix.test"); // staff aren't owners: nothing reaches the business
    expect((await (await Team.GET(await req("GET", "/api/team", owner.id, undefined, {}, TELIX), ctx)).json()).requests).toEqual([]);
    for (const n of [1, 2, 3, 4]) await requestToJoin(d.id, `x${n}@nowhere.in`);
    await expect(requestToJoin(d.id, "x9@nowhere.in")).rejects.toThrow(/5 requests waiting/);
  });
});
