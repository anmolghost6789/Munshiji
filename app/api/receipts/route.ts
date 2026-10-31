import { route, body } from "@/lib/api";
import { createReceipt, recentReceipts } from "@/lib/core/inventory";

export const GET = route("inventory.view", async () => ({ receipts: await recentReceipts() }));
export const POST = route("inventory.receive", async (req, actor) => {
  const key = req.headers.get("idempotency-key") || undefined;
  const r = await createReceipt(await body(req), actor, key && key.length >= 8 ? key : undefined);
  return Response.json(r, { status: r.duplicate ? 200 : 201 });
});
