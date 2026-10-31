#!/usr/bin/env node
/* Portable backup with pg_dump (custom format), verified by reading it back. Keeps the newest N.
   Run it as a role that can read every business (Row-Level Security): the database owner or a BYPASSRLS role.
   Managed databases (RDS, Neon) also have their own automated backups; this is the provider-independent copy.
   Usage: DATABASE_URL=... node scripts/backup.mjs   (env: MUNSHIJI_BACKUP_DIR, MUNSHIJI_BACKUP_KEEP) */
import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";

const url = process.env.DATABASE_URL;
const dir = process.env.MUNSHIJI_BACKUP_DIR || path.join(process.cwd(), "backups");
const keep = Math.max(1, Number(process.env.MUNSHIJI_BACKUP_KEEP || 30));
if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date(Date.now() + 330 * 60_000).toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15); // IST
const dest = path.join(dir, `munshiji-${stamp}.dump`);
try {
  execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${dest}`, url], { stdio: ["ignore", "ignore", "pipe"] });
  const toc = execFileSync("pg_restore", ["--list", dest], { encoding: "utf8" });
  const tables = (toc.match(/ TABLE DATA public /g) || []).length;
  if (tables < 10) throw new Error(`backup looks incomplete (${tables} tables)`);
  const old = fs.readdirSync(dir).filter((f) => /^munshiji-\d{8}-\d{6}\.dump$/.test(f)).sort().reverse().slice(keep);
  for (const f of old) fs.unlinkSync(path.join(dir, f));
  console.log(JSON.stringify({ ok: true, backup: dest, bytes: fs.statSync(dest).size, tables, removed_old: old.length }));
} catch (e) {
  if (fs.existsSync(dest)) fs.renameSync(dest, dest + ".FAILED");
  const msg = e.stderr?.toString() || e.message;
  if (/row-level security|row security/i.test(msg)) console.error("Backup failed: pg_dump must run as a database role that can read every business (the database owner on RDS/Neon, or a role with BYPASSRLS). The app's own role deliberately can't. Set DATABASE_URL to that role for backups.");
  else console.error(`Backup failed: ${msg}`);
  process.exit(2);
}
