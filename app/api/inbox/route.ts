import { many, one, exec, scalar } from "@/lib/sql";
import { route, body } from "@/lib/api";
import { inbox, processInbound } from "@/lib/whatsapp";
import { } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

/** WhatsApp drafts waiting for a person. Approving happens through POST /api/orders with inbound_id. */
export const GET = route("inbox.review", async () => ({ messages: await inbox() }));
export const POST = route("inbox.review", async (req, actor) => {
  const { id, action } = (await body(req)) as { id?: string; action?: string };
  if (!id) throw badRequest("Missing id.");
  if (action === "dismiss") {
    (await exec("UPDATE inbound_messages SET status = 'dismissed', updated_at = now() WHERE id = ? AND order_id = ''", [id]));
    await audit(actor, "inbox.dismiss", "inbound", id); return { ok: true };
  }
  if (action === "retry") return { status: await processInbound(id, actor.businessId) };
  throw badRequest("Unknown action.");
});
