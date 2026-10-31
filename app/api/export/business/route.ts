import { route } from "@/lib/api";
import { exportBusiness } from "@/lib/core/privacy";
/** Owner: download all of this business's data as JSON. */
export const GET = route("data.export", async (_req, actor) => {
  const data = await exportBusiness(actor);
  return new Response(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="munshiji-business-${actor.businessId}-${new Date().toISOString().slice(0, 10)}.json"` } });
});
