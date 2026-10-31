import { route } from "@/lib/api";
import { can } from "@/lib/authz";
import { getOverviewStats, getReceivablesAging, getPayablesAging, getSalesSeries, getNewestPendingOrder, getStateCount, getBusinessProfile } from "@/lib/db";
import { prepareReturns } from "@/lib/gst-returns";
import { parseRegistration } from "@/lib/gst";

export const GET = route("orders.view", async (_req, actor) => {
  const money = can(actor.role, "money.view");
  const reg = parseRegistration((await getBusinessProfile())?.gst_registration);
  let gst: { label: string; amount: number; due: string } | null = null;
  if (reg !== "none" && money) {
    try {
      const r = await prepareReturns(new Date().toISOString().slice(0, 7));
      if ("gstr3b" in r && r.gstr3b) gst = { label: "GST this month", amount: r.gstr3b.estimatedPayable, due: r.gstr1.due };
      else if ("cmp08" in r && r.cmp08) gst = { label: "Composition tax this quarter", amount: r.cmp08.tax, due: r.cmp08.due };
    } catch { gst = null; }
  }
  const stats = { ...(await getOverviewStats()), preparing: await getStateCount("preparing") };
  // Staff see orders and today's work, not money figures.
  if (!money) Object.assign(stats, { salesThisMonth: null, receivables: null, payables: null, netWorkingCapital: null });
  return {
    canSeeMoney: money,
    stats,
    receivablesAging: money ? await getReceivablesAging() : [],
    payablesAging: money ? await getPayablesAging() : [],
    sales: money ? await getSalesSeries() : null,
    pending: await getNewestPendingOrder(),
    gst: money ? gst : null,
  };
});
