import { route, body } from "@/lib/api";
import { createCreditNote, creditNotesFor } from "@/lib/core/gstdocs";
import { badRequest } from "@/lib/errors";

export const GET = route("orders.view", async (req) => {
  const id = req.nextUrl.searchParams.get("order_id");
  if (!id) throw badRequest("Missing order_id.");
  return { credit_notes: await creditNotesFor(id) };
});
/** Issue a credit note against a billed order: { order_id, reason, reason_note, restock, lines: [{ product_id, qty | amount }] } */
export const POST = route("invoices.create", async (req, actor) => {
  const b = (await body(req)) as { order_id?: string };
  if (!b.order_id) throw badRequest("Missing order_id.");
  const key = req.headers.get("idempotency-key") || undefined;
  const r = await createCreditNote(b.order_id, b, actor, key && key.length >= 8 ? key : undefined);
  return Response.json(r, { status: r.duplicate ? 200 : 201 });
});
