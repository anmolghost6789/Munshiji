// Every test file gets its own fresh Postgres database with the real migrations applied.
// The app connects as an ordinary role (no superuser, no BYPASSRLS), exactly as in production,
// so Row-Level Security is really enforced in the tests.
import pg from "pg";
import { afterAll } from "vitest";
import { migrate } from "../scripts/migrate.mjs";
import { closePool } from "@/lib/sql";

const admin = process.env.TEST_PG_ADMIN_URL || "postgresql://postgres@localhost/postgres?host=/tmp";
const name = `mj_test_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
const adminDb = admin.replace(/\/postgres(\?|$)/, `/${name}$1`);
const c = new pg.Client({ connectionString: admin }); await c.connect();
await c.query(`CREATE DATABASE ${name}`);
await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'munshiji_app') THEN CREATE ROLE munshiji_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$`).catch(() => {});
await c.end();
await migrate(adminDb);
const g = new pg.Client({ connectionString: adminDb }); await g.connect();
await g.query("GRANT USAGE ON SCHEMA public TO munshiji_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO munshiji_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO munshiji_app;");
await g.end();
process.env.DATABASE_URL = adminDb.replace("postgres@", "munshiji_app@");
process.env.TEST_ADMIN_DATABASE_URL = adminDb; // for tests that need to look across businesses (as the owner role)
delete process.env.MUNSHIJI_DEMO;

afterAll(async () => {
  await closePool();
  const d = new pg.Client({ connectionString: admin }); await d.connect();
  await d.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`); await d.end();
});
