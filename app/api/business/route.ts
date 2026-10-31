import { many, one, exec, scalar } from "@/lib/sql";
import { route, body } from "@/lib/api";
import { getBusinessProfile, upsertBusinessProfile } from "@/lib/db";
import { audit } from "@/lib/audit";
import { conflict } from "@/lib/errors";

export const GET = route("settings.view", async () => ({ profile: await getBusinessProfile(), invoicesExist: !!(await one("SELECT 1 FROM invoices LIMIT 1")) }));
export const POST = route("settings.edit", async (req, actor) => {
  const b = (await body(req)) as Record<string, unknown>;
  const cur = await getBusinessProfile() as { invoice_prefix?: string; invoice_start?: number } | null;
  const billsExist = !!(await one("SELECT 1 FROM invoices LIMIT 1"));
  const changesNumbering = (b.invoice_prefix !== undefined && String(b.invoice_prefix).toUpperCase() !== (cur?.invoice_prefix || "INV")) || (b.invoice_start !== undefined && Number(b.invoice_start) !== Number(cur?.invoice_start || 1));
  if (billsExist && changesNumbering) throw conflict("Bill numbering can't change after the first bill is made.");
  delete b.treds_platform; delete b.treds_seller_id;
  await upsertBusinessProfile(b);
  await audit(actor, "settings.change", "business", "1", Object.keys(b));
  return { ok: true };
});
