import { route, body } from "@/lib/api";
import { recordIrn, pendingIrns } from "@/lib/core/gstdocs";
import { badRequest } from "@/lib/errors";

/** Bills that need an IRN and don't have one yet. */
export const GET = route("gst.view", async () => ({ pending: await pendingIrns() }));
/** Record the IRP's response: { kind: "invoice" | "credit_note", id, irn, ack_no, ack_date, signed_qr } */
export const POST = route("invoices.create", async (req, actor) => {
  const b = (await body(req)) as { kind?: string; id?: string };
  if (!b.id || (b.kind !== "invoice" && b.kind !== "credit_note")) throw badRequest("Say which bill or credit note.");
  return recordIrn(b.kind, b.id, b, actor);
});
