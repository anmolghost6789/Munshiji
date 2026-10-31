import { route, body } from "@/lib/api";
import { getAllPurchaseOrders, getPurchaseItems, createPurchaseOrder, updatePurchaseOrderState, getPurchaseStateCounts } from "@/lib/db";
import { receivePurchaseOrder } from "@/lib/core/inventory";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const GET = route("inventory.view", async (req) => {
  const orders = await Promise.all((await getAllPurchaseOrders(req.nextUrl.searchParams.get("state") || "all")).map(async (po) => ({ ...po, items: await getPurchaseItems(po.id) })));
  return { orders, counts: await getPurchaseStateCounts() };
});
export const POST = route("inventory.receive", async (req, actor) => {
  const b = (await body(req)) as { id?: string };
  await createPurchaseOrder(b as never); await audit(actor, "po.create", "purchase_order", String(b.id || ""));
  return Response.json({ ok: true }, { status: 201 });
});
export const PATCH = route("inventory.receive", async (req, actor) => {
  const { id, state } = (await body(req)) as { id?: string; state?: string };
  if (!id || !state) throw badRequest("Missing id or state.");
  if (state === "received") return await receivePurchaseOrder(id, actor); // stock moves once, in one transaction
  await updatePurchaseOrderState(id, state); await audit(actor, "po.state", "purchase_order", id, { state });
  return { ok: true };
});
