#!/usr/bin/env node
/* Restore a pg_dump backup into DATABASE_URL (as the database owner or a BYPASSRLS role). Stop the app (or scale it to 0) first.
   A safety backup of the current database is taken before anything is replaced.
   Set MUNSHIJI_APP_ROLE to the app's database role so its access is restored too.
   Usage: DATABASE_URL=... node scripts/restore.mjs backups/munshiji-20261026-230000.dump --yes */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const file = process.argv[2], url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
if (!file || !fs.existsSync(file)) { console.error("Give the backup file to restore."); process.exit(1); }
if (!process.argv.includes("--yes")) { console.error(`This replaces the database with ${file}.\nStop the app first, then run again with --yes.`); process.exit(1); }
let toc;
try { toc = execFileSync("pg_restore", ["--list", file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch { console.error("Not a readable Munshiji backup."); process.exit(2); }
if (!/TABLE DATA public orders/.test(toc) || !/TABLE DATA public invoices/.test(toc)) { console.error("Not a Munshiji backup (orders/invoices missing)."); process.exit(2); }
const safety = path.join(path.dirname(file), `before-restore-${Date.now()}.dump`);
execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${safety}`, url], { stdio: ["ignore", "ignore", "pipe"] });
execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"], { stdio: ["ignore", "ignore", "pipe"] });
execFileSync("pg_restore", ["--no-owner", "--no-privileges", "--exit-on-error", "-d", url, file], { stdio: ["ignore", "ignore", "pipe"] });
// The schema was recreated, so give the app's role its access back (it never gets BYPASSRLS).
const appRole = process.env.MUNSHIJI_APP_ROLE;
if (appRole) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(appRole)) { console.error("MUNSHIJI_APP_ROLE is not a valid role name."); process.exit(1); }
  execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", "-q", "-c", `GRANT USAGE ON SCHEMA public TO ${appRole}; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${appRole}; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${appRole};`], { stdio: ["ignore", "ignore", "pipe"] });
}
console.log(JSON.stringify({ ok: true, restored: file, previous_kept_as: safety, app_role_regranted: appRole || null }));
