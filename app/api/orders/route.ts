import { NextRequest } from "next/server";
import { route, body } from "@/lib/api";
import { getAllOrders, getOrderStateCounts, getOrderItems, getBusinessProfile } from "@/lib/db";
import { createOrder, updateOrder, advanceOrder, cancelOrder, fullOrder } from "@/lib/core/orders";
import { paymentsFor } from "@/lib/core/money";
import { setTransport, creditNotesFor, ewbLimitFor } from "@/lib/core/gstdocs";
import { one } from "@/lib/sql";
import { getAudit } from "@/lib/audit";
import { can } from "@/lib/authz";
import { badRequest } from "@/lib/errors";

const idemKey = (req: NextRequest, b: { idempotency_key?: unknown }) => {
  const k = req.headers.get("idempotency-key") || (typeof b.idempotency_key === "string" ? b.idempotency_key : "");
  return k && k.length >= 8 && k.length <= 100 ? k : undefined;
};

export const GET = route("orders.view", async (req, actor) => {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) {
    const order = await fullOrder(id);
    const bill = order.invoice_id ? await one("SELECT id, invoice_number, einvoice_required, irn, ack_no, ack_date FROM invoices WHERE id = ?", [order.invoice_id]) : null;
    const prof = await getBusinessProfile() as { ewb_threshold?: number; company_name?: string; gstin?: string; address?: string; city?: string } | null;
    return { order, items: order.items, bill, ewb_threshold: await ewbLimitFor(id), seller: { name: prof?.company_name || "", gstin: prof?.gstin || "", address: [prof?.address, prof?.city].filter(Boolean).join(", ") }, credit_notes: order.invoice_id ? await creditNotesFor(id) : [], payments: can(actor.role, "money.view") ? await paymentsFor(id) : [], history: await getAudit(50, "order", id) };
  }
  const orders = await Promise.all((await getAllOrders(sp.get("state") || "all")).map(async (o) => ({ ...o, items: await getOrderItems(o.id) })));
  return { orders, counts: await getOrderStateCounts() };
});

export const POST = route("orders.create", async (req, actor) => {
  const b = (await body(req)) as Record<string, unknown>;
  const r = await createOrder(b, actor, idemKey(req, b));
  return Response.json(r, { status: r.duplicate ? 200 : 201 });
});

/** { id, action: "edit" | "advance" | "cancel", ... } */
export const PATCH = route("orders.edit", async (req, actor) => {
  const b = (await body(req)) as { id?: string; action?: string; to?: string; state?: string; version?: number; reason?: string };
  if (!b.id) throw badRequest("Missing order id.");
  const action = b.action || (b.state ? "advance" : "edit");
  if (action === "advance") {
    if (!can(actor.role, "orders.advance")) throw badRequest("You can't move orders forward.");
    return { order: await advanceOrder(b.id, String(b.to || b.state), actor, b.version) };
  }
  if (action === "cancel") {
    if (!can(actor.role, "orders.cancel")) return Response.json({ error: "Only an owner or manager can cancel orders." }, { status: 403 });
    return { order: await cancelOrder(b.id, String(b.reason || ""), actor) };
  }
  if (action === "transport") return { ok: (await setTransport(b.id, b, actor)).ok, order: await fullOrder(b.id) };
  if (action === "edit") return { order: await updateOrder(b.id, b, actor) };
  throw badRequest("Unknown action.");
});
