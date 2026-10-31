import { route } from "@/lib/api";
import { getAudit } from "@/lib/audit";
export const GET = route("audit.view", async (req) => ({ entries: await getAudit(Math.min(500, Number(req.nextUrl.searchParams.get("limit")) || 200)) }));
