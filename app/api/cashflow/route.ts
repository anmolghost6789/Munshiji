import { route } from "@/lib/api";
import { getCashFlowStats, getAllInvoices } from "@/lib/db";
export const GET = route("money.view", async () => ({ stats: await getCashFlowStats(), invoices: await getAllInvoices() }));
