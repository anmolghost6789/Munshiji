#!/usr/bin/env node
/* Applies migrations/*.sql in order, once each, inside a transaction, holding an advisory lock so two deploys
   can't migrate at the same time. Run at deploy time: `npm run db:migrate` (Vercel build step, or an EKS Job). */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

export async function migrate(url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL, dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "migrations")) {
  if (!url) throw new Error("DATABASE_URL is not set.");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727274)");
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT now())");
    const done = new Set((await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
    const applied = [];
    for (const f of fs.readdirSync(dir).filter((x) => /^\d+_.+\.sql$/.test(x)).sort()) {
      if (done.has(f)) continue;
      await client.query("BEGIN");
      try { await client.query(fs.readFileSync(path.join(dir, f), "utf8")); await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [f]); await client.query("COMMIT"); applied.push(f); }
      catch (e) { await client.query("ROLLBACK"); throw new Error(`Migration ${f} failed: ${e.message}`); }
    }
    return applied;
  } finally { await client.query("SELECT pg_advisory_unlock(727274)").catch(() => {}); await client.end(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrate().then((a) => console.log(JSON.stringify({ ok: true, applied: a }))).catch((e) => { console.error(e.message); process.exit(1); });
}
