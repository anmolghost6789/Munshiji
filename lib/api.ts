import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { AppError } from "./errors";
import { requireUser, type Actor, type Permission } from "./authz";
import { withBusiness, tx } from "./sql";

/** Wraps a route: checks the user and permission, turns errors into clear JSON, never leaks stack traces. */
export function route(perm: Permission | null, fn: (req: NextRequest, actor: Actor, ctx: { params: Promise<Record<string, string>> }) => Promise<unknown>) {
  return async (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      const actor = await requireUser(req, perm ?? undefined);
      // The whole request runs as this business: Row-Level Security limits every query to its rows.
      const out = await withBusiness(actor.businessId, () => tx(() => fn(req, actor, ctx)));
      return out instanceof Response ? out : NextResponse.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof AppError) return NextResponse.json({ error: e.message, code: e.code, details: e.details }, { status: e.status });
  if (e instanceof ZodError) return NextResponse.json({ error: e.issues[0]?.message || "Some details are missing or invalid.", code: "invalid", details: e.issues }, { status: 400 });
  const msg = String((e as Error)?.message || e);
  if ((e as { code?: string })?.code === "23505" || /UNIQUE constraint failed|duplicate key value/.test(msg)) return NextResponse.json({ error: "This was already saved.", code: "duplicate" }, { status: 409 });
  if ((e as { code?: string })?.code === "23514") return NextResponse.json({ error: "That would make a balance invalid (for example negative stock or overpayment). Nothing was changed.", code: "invalid" }, { status: 409 });
  console.error("[munshiji] unexpected error:", e);
  return NextResponse.json({ error: "Something went wrong. Your data was not changed. Please try again.", code: "server_error" }, { status: 500 });
}

const bodies = new WeakMap<NextRequest, Promise<unknown>>();
export async function body(req: NextRequest): Promise<unknown> {
  if (!bodies.has(req)) bodies.set(req, req.json().catch(() => { throw new AppError(400, "The request was not valid JSON.", "invalid"); }));
  return bodies.get(req)!;
}
