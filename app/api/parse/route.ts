import { route, body } from "@/lib/api";
import { parseOrderMessage } from "@/lib/parse";
import { badRequest } from "@/lib/errors";

/** Reads a pasted message into a draft. Nothing is saved until a person confirms the order. */
export const POST = route("orders.create", async (req) => {
  const { message } = (await body(req)) as { message?: unknown };
  if (typeof message !== "string" || !message.trim()) throw badRequest("Paste the order message first.");
  return await parseOrderMessage(message);
});
