import { route } from "@/lib/api";
import { getInventorySummary } from "@/lib/db";
// Read-only summary used by the Catalog stock tab. Stock changes go through /api/stock and /api/receipts.
export const GET = route("inventory.view", async () => await getInventorySummary());
