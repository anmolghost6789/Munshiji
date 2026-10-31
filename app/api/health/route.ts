import { NextResponse } from "next/server";
import { one } from "@/lib/sql";

export const dynamic = "force-dynamic";

/** Uptime and deployment check. Returns no business data: just whether Postgres answers and which schema version is applied. */
export async function GET() {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) {
    return NextResponse.json({ ok: false, database: "postgres", problem: "DATABASE_URL is not set for this deployment." }, { status: 503 });
  }
  try {
    const m = await one<{ v: string | null }>("SELECT MAX(version) v FROM schema_migrations").catch(() => undefined);
    if (!m?.v) return NextResponse.json({ ok: false, database: "postgres", problem: "Database is reachable but not migrated. Run: npm run db:migrate" }, { status: 503 });
    return NextResponse.json({ ok: true, database: "postgres", schema: m.v });
  } catch {
    return NextResponse.json({ ok: false, database: "postgres", problem: "Can't reach the database. Check DATABASE_URL (use Neon's pooled URL on Vercel)." }, { status: 503 });
  }
}
