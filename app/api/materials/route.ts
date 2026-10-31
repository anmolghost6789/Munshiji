import { route, body } from "@/lib/api";
import { getAllRawMaterials, createRawMaterial, deleteRawMaterial } from "@/lib/db";
import { audit } from "@/lib/audit";
import { badRequest } from "@/lib/errors";

export const GET = route("inventory.view", async () => ({ materials: await getAllRawMaterials() }));
export const POST = route("catalog.edit", async (req, actor) => {
  const b = (await body(req)) as { name?: string; unit?: string };
  if (!b.name || b.name.trim().length < 2) throw badRequest("Material name is too short.");
  const id = `m-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await createRawMaterial({ ...(b as object), id, name: b.name.trim(), unit: b.unit || "kg" } as never);
  await audit(actor, "material.create", "material", id, { name: b.name });
  return Response.json({ id }, { status: 201 });
});
export const DELETE = route("catalog.edit", async (req, actor) => {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) throw badRequest("Missing id.");
  await deleteRawMaterial(id); await audit(actor, "material.deactivate", "material", id);
  return { ok: true };
});
