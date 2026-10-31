import { route, body } from "@/lib/api";
import { getAllCustomers, getCustomerStats } from "@/lib/db";
import { createContact, updateContact } from "@/lib/core/contacts";

export const GET = route("orders.view", async () => ({ customers: await Promise.all((await getAllCustomers()).map(async (c) => ({ ...c, stats: await getCustomerStats(c.id) }))) }));
/** Add a customer: { name, phone?, email?, address?, gstin?, state_code? } */
export const POST = route("customers.edit", async (req, actor) => Response.json(await createContact("customer", await body(req), actor), { status: 201 }));
/** Edit a customer: { id, ...fields } */
export const PATCH = route("customers.edit", async (req, actor) => updateContact("customer", await body(req), actor));
