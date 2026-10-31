import { route, body } from "@/lib/api";
import { getAllSuppliers, getSupplierStats } from "@/lib/db";
import { createContact, updateContact } from "@/lib/core/contacts";

export const GET = route("inventory.view", async () => ({ suppliers: await Promise.all((await getAllSuppliers()).map(async (s) => ({ ...s, stats: await getSupplierStats(s.id) }))) }));
/** Add a supplier: { name, phone?, email?, address?, gstin?, state_code? } */
export const POST = route("inventory.receive", async (req, actor) => Response.json(await createContact("supplier", await body(req), actor), { status: 201 }));
/** Edit a supplier: { id, ...fields } */
export const PATCH = route("inventory.receive", async (req, actor) => updateContact("supplier", await body(req), actor));
