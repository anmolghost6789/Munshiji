/* Customers and suppliers, added and edited directly from Contacts.
   - GSTIN is validated (checksum) and unique within the business; its state fills the contact's state.
   - Phone numbers are stored as 10 digits; emails are checked.
   - A supplier's GSTIN matters: without a valid one, purchases from them can't count as input credit. */
import crypto from "crypto";
import { z } from "zod";
import { one, exec, tx } from "../sql";
import { audit } from "../audit";
import type { Actor } from "../authz";
import { badRequest, conflict, notFound } from "../errors";
import { checkGstin, stateCodeFromGstin, GST_STATES } from "../gst";

const base = {
  name: z.string().trim().min(2, "Name is too short").max(120),
  phone: z.string().trim().max(20).optional(),
  email: z.union([z.string().trim().toLowerCase().email("Enter a valid email"), z.literal("")]).optional(),
  address: z.string().trim().max(300).optional(),
  gstin: z.string().trim().toUpperCase().max(15).optional(),
  state_code: z.string().trim().refine((s) => !s || !!GST_STATES[s], "Choose a state").optional(),
};
export const ContactInput = z.object(base);
export const ContactPatch = z.object({ id: z.string().min(1), ...Object.fromEntries(Object.entries(base).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()])) });

type Kind = "customer" | "supplier";
const TABLE: Record<Kind, string> = { customer: "customers", supplier: "suppliers" };
const LABEL: Record<Kind, string> = { customer: "customer", supplier: "supplier" };
const normPhone = (p?: string) => (p || "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, "");

async function clean(kind: Kind, v: z.infer<typeof ContactInput> | Partial<z.infer<typeof ContactInput>>, selfId?: string) {
  const out: Record<string, string> = {};
  if (v.name !== undefined) out.name = v.name;
  if (v.phone !== undefined) {
    const p = normPhone(v.phone);
    if (p && !/^\d{10}$/.test(p)) throw badRequest("Enter a 10-digit phone number.");
    out.phone = p;
  }
  if (v.email !== undefined) out.email = v.email || "";
  if (v.address !== undefined) out.address = v.address || "";
  if (v.gstin !== undefined) {
    const g = v.gstin || "";
    if (g) {
      const k = checkGstin(g);
      if (!k.valid) throw badRequest(`GSTIN: ${k.error}.`);
      const dup = await one<{ id: string; name: string }>(`SELECT id, name FROM ${TABLE[kind]} WHERE UPPER(gstin) = ? AND id <> ?`, [g, selfId || ""]);
      if (dup) throw conflict(`${dup.name} already has this GSTIN.`);
      out.state_code = stateCodeFromGstin(g) || ""; // a registered contact's state comes from its GSTIN
    }
    out.gstin = g;
  }
  if (v.state_code !== undefined && !(out.gstin)) out.state_code = v.state_code || "";
  return out;
}

export async function createContact(kind: Kind, raw: unknown, actor: Actor) {
  const v = ContactInput.parse(raw);
  return tx(async () => {
    const c = await clean(kind, v);
    const id = `${kind === "customer" ? "c" : "s"}-${crypto.randomBytes(6).toString("hex")}`;
    const cols = ["id", ...Object.keys(c)], vals = [id, ...Object.values(c)];
    await exec(`INSERT INTO ${TABLE[kind]} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, vals);
    await audit(actor, `${kind}.create`, kind, id, { name: v.name });
    return { id };
  });
}

export async function updateContact(kind: Kind, raw: unknown, actor: Actor) {
  const { id, ...rest } = ContactPatch.parse(raw) as { id: string } & Partial<z.infer<typeof ContactInput>>;
  return tx(async () => {
    if (!(await one(`SELECT 1 FROM ${TABLE[kind]} WHERE id = ? FOR UPDATE`, [id]))) throw notFound(`That ${LABEL[kind]} wasn't found.`);
    const c = await clean(kind, rest, id);
    if (!Object.keys(c).length) return { ok: true };
    await exec(`UPDATE ${TABLE[kind]} SET ${Object.keys(c).map((k) => `${k} = ?`).join(", ")}, updated_at = now() WHERE id = ?`, [...Object.values(c), id]);
    await audit(actor, `${kind}.update`, kind, id, c);
    return { ok: true };
  });
}
