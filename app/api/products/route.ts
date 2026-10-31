import { route, body } from "@/lib/api";
import { getAllProducts } from "@/lib/db";
import { createProduct, updateProduct, removeProduct } from "@/lib/core/catalog";
import { badRequest } from "@/lib/errors";

export const GET = route("orders.view", async () => ({ products: await getAllProducts() }));
export const POST = route("catalog.edit", async (req, actor) => Response.json(await createProduct(await body(req), actor), { status: 201 }));
export const PATCH = route("catalog.edit", async (req, actor) => {
  const { id, ...rest } = (await body(req)) as { id?: string };
  if (!id) throw badRequest("Missing product id.");
  return await updateProduct(id, rest, actor);
});
export const DELETE = route("catalog.edit", async (req, actor) => {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) throw badRequest("Missing product id.");
  return await removeProduct(id, actor);
});
