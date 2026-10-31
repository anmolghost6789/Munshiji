import { route, body } from "@/lib/api";
import { stockSummary, ledgerFor, adjustStock, type ItemType } from "@/lib/core/inventory";

export const GET = route("inventory.view", async (req) => {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("item_id");
  if (id) return { entries: await ledgerFor((sp.get("item_type") as ItemType) || "product", id) };
  return await stockSummary();
});
/** Set stock to a counted quantity: { item_type, item_id, new_qty, reason } */
export const POST = route("inventory.adjust", async (req, actor) => await adjustStock(await body(req), actor));
