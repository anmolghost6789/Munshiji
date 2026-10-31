import { route, body } from "@/lib/api";
import { listTeam, createInvite, revokeInvite, changeMember } from "@/lib/core/tenancy";
import { badRequest } from "@/lib/errors";
import { pendingRequests, decideJoinRequest } from "@/lib/core/joining";

export const GET = route("team.manage", async (_req, actor) => ({ ...(await listTeam(actor)), requests: await pendingRequests(actor.businessId) }));
/** Invite someone: { email, role, phone? } → a single-use link, shown once. */
export const POST = route("team.manage", async (req, actor) => {
  const inv = await createInvite(await body(req), actor);
  return { ...inv, url: new URL(inv.path, req.nextUrl.origin).toString() };
});
/** Change a member's role or remove them from this business: { user_id, role?, active? } */
export const PATCH = route("team.manage", async (req, actor) => {
  const b = (await body(req)) as { request_id?: string; decision?: "approve" | "decline"; role?: "owner" | "manager" | "staff" };
  if (b.request_id) { if (b.decision !== "approve" && b.decision !== "decline") throw badRequest("Approve or decline?"); return decideJoinRequest(actor, b.request_id, b.decision, b.role || "staff"); }
  return changeMember(b, actor);
});
export const DELETE = route("team.manage", async (req, actor) => {
  const id = req.nextUrl.searchParams.get("invite_id");
  if (!id) throw badRequest("Missing invite_id.");
  return revokeInvite(id, actor);
});
