#!/usr/bin/env node
/* Splits people out of a business they were put into by mistake (e.g. everyone landing in one demo business
   after the multi-business update). Keeps the named people; everyone else leaves that business, and anyone
   left with no business gets a new, empty one they own. Nothing is deleted.
   Run as the database owner role:
     DATABASE_URL=... node scripts/split-business.mjs --business "Sharma Corrugated Industries" --keep owner@example.in
   Shows the plan; add --yes to apply. */
import pg from "pg";
import crypto from "crypto";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const which = arg("business"), keep = (arg("keep") || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean), apply = process.argv.includes("--yes");
if (!which || !keep.length) { console.error('Usage: node scripts/split-business.mjs --business "<name or id>" --keep a@x.in[,b@y.in] [--yes]'); process.exit(1); }
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error("Set DATABASE_URL (the database owner role)."); process.exit(1); }

const c = new pg.Client({ connectionString: url }); await c.connect();
const q = async (sql, p = []) => (await c.query(sql, p)).rows;
const found = await q("SELECT id, name FROM businesses WHERE id = $1 OR LOWER(name) = LOWER($1)", [which]);
if (found.length !== 1) { console.error(found.length ? `Several businesses are called "${which}". Use its id: ${found.map((b) => b.id).join(", ")}` : `No business "${which}".`); await c.end(); process.exit(1); }
const biz = found[0];
const members = await q(`SELECT u.id, u.name, u.email, m.role,
    (SELECT COUNT(*) FROM memberships x WHERE x.user_id = u.id AND x.active = 1 AND x.business_id <> $1)::int AS others
  FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.business_id = $1 AND m.active = 1 ORDER BY m.created_at`, [biz.id]);
const kept = members.filter((m) => keep.includes(m.email.toLowerCase()));
if (!kept.some((m) => m.role === "owner")) { console.error(`--keep must include an active owner of "${biz.name}". Owners: ${members.filter((m) => m.role === "owner").map((m) => m.email).join(", ") || "none"}`); await c.end(); process.exit(1); }
const leaving = members.filter((m) => !keep.includes(m.email.toLowerCase()));
console.log(`Business: ${biz.name} (${biz.id})`);
console.log(`Stays:   ${kept.map((m) => `${m.email} (${m.role})`).join(", ")}`);
for (const m of leaving) console.log(`Leaves:  ${m.email} → ${m.others ? "keeps their other business" : `gets a new business "${m.name}'s business"`}`);
if (!leaving.length) { console.log("Nobody to move."); await c.end(); process.exit(0); }
if (!apply) { console.log("\nNothing changed. Add --yes to apply."); await c.end(); process.exit(0); }

await c.query("BEGIN");
try {
  for (const m of leaving) {
    await c.query("UPDATE memberships SET active = 0 WHERE user_id = $1 AND business_id = $2", [m.id, biz.id]);
    if (!m.others) {
      const id = `b-${crypto.randomBytes(8).toString("hex")}`, name = `${m.name}'s business`;
      await c.query("INSERT INTO businesses (id, name) VALUES ($1, $2)", [id, name]);
      await c.query("INSERT INTO memberships (user_id, business_id, role) VALUES ($1, $2, 'owner')", [m.id, id]);
      await c.query("SELECT set_config('app.business_id', $1, true)", [id]); // Row-Level Security: write as the new business
      await c.query("INSERT INTO business_profile (business_id, company_name) VALUES ($1, $2)", [id, name]);
      await c.query("UPDATE users SET last_business_id = $1 WHERE id = $2", [id, m.id]);
    } else {
      await c.query("UPDATE users SET last_business_id = '' WHERE id = $1 AND last_business_id = $2", [m.id, biz.id]);
    }
  }
  await c.query("COMMIT");
  console.log(`\nDone: ${leaving.length} ${leaving.length === 1 ? "person" : "people"} moved out of ${biz.name}.`);
} catch (e) { await c.query("ROLLBACK"); console.error("Nothing changed:", e.message); process.exitCode = 2; }
await c.end();
