import { route, body } from "@/lib/api";
import { recordPayment, voidPayment, paymentsFor } from "@/lib/core/money";
import { can } from "@/lib/authz";
import { badRequest, forbidden } from "@/lib/errors";

export const GET = route("money.view", async (req) => {
  const id = req.nextUrl.searchParams.get("order_id");
  if (!id) throw badRequest("Missing order_id.");
  return { payments: await paymentsFor(id) };
});
/** Record a payment: { order_id, amount, mode, reference, received_on }, header Idempotency-Key */
export const POST = route("payments.record", async (req, actor) => {
  const b = (await body(req)) as { order_id?: string };
  if (!b.order_id) throw badRequest("Missing order_id.");
  const key = req.headers.get("idempotency-key") || undefined;
  return await recordPayment(b.order_id, b, actor, key && key.length >= 8 ? key : undefined);
});
/** Remove a payment recorded by mistake: { payment_id, reason } */
export const PATCH = route("payments.record", async (req, actor) => {
  if (!can(actor.role, "payments.void")) throw forbidden("Only the owner can remove a recorded payment.");
  const b = (await body(req)) as { payment_id?: string; reason?: string };
  if (!b.payment_id) throw badRequest("Missing payment_id.");
  return await voidPayment(b.payment_id, String(b.reason || ""), actor);
});
