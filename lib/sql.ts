/* PostgreSQL access. One pool per process (reused across hot reloads and serverless invocations).
   - Queries use `?` placeholders (converted to $1, $2…).
   - Inside tx(), every query automatically runs on that transaction's connection (AsyncLocalStorage),
     so business logic reads like straight-line code.
   - tx() retries on deadlocks/serialization failures and on a unique-key race (e.g. the same
     idempotency key saved twice at the same instant); the retried run then finds the committed row.
   - The database time zone should be UTC (the default on RDS and Neon); timestamps are also converted to UTC here.
   - NUMERIC comes back as number (values are rounded to 2 dp in code), bigint COUNTs as number,
     timestamptz as "YYYY-MM-DD HH:MM:SS" in UTC, DATE as "YYYY-MM-DD". */
import { AsyncLocalStorage } from "async_hooks";
import pg from "pg";

const { Pool, types } = pg;
types.setTypeParser(1700, (v) => (v === null ? (null as unknown as number) : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => parseInt(v, 10)); // int8 (COUNT)
const utc = (v: string) => (v ? new Date(v).toISOString().replace("T", " ").slice(0, 19) : v);
types.setTypeParser(1184, utc); // timestamptz
types.setTypeParser(1114, (v) => (v ? v.replace("T", " ").slice(0, 19) : v)); // timestamp
types.setTypeParser(1082, (v) => v); // date stays a string

export function databaseUrl(): string {
  const u = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!u) throw new Error("DATABASE_URL is not set. See PILOT.md.");
  return u;
}

const g = globalThis as unknown as { __munshijiPool?: pg.Pool };
export function pool(): pg.Pool {
  if (!g.__munshijiPool) {
    const p = new Pool({
      connectionString: databaseUrl(),
      max: Number(process.env.PG_POOL_MAX || (process.env.VERCEL ? 3 : 10)),
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 10_000,
      ssl: /sslmode=require|neon\.tech|rds\.amazonaws\.com/.test(databaseUrl()) ? { rejectUnauthorized: false } : undefined,
    });
    p.on("error", (e) => console.error("[munshiji] idle database connection error", e.message));
    g.__munshijiPool = p;
  }
  return g.__munshijiPool;
}
export async function closePool() { if (g.__munshijiPool) { await g.__munshijiPool.end(); g.__munshijiPool = undefined; } }

/* Request context: the current business (for Row-Level Security) and, inside a transaction, its connection. */
interface Ctx { businessId?: string; client?: pg.PoolClient; sp?: number }
const als = new AsyncLocalStorage<Ctx>();
let testBusiness: string | undefined; // tests only: a default business when none is set
export function setTestBusiness(id: string | undefined) {
  if (process.env.NODE_ENV !== "test" && process.env.VITEST !== "true") throw new Error("setTestBusiness is for tests only");
  testBusiness = id;
}
const currentBusiness = () => als.getStore()?.businessId ?? testBusiness;
export const inTx = () => !!als.getStore()?.client;
export const businessIdInContext = () => currentBusiness();

/** Runs fn as the given business: every query inside can only see and write that business's rows. */
export function withBusiness<T>(businessId: string, fn: () => Promise<T>): Promise<T> {
  if (!businessId) throw new Error("withBusiness needs a business id");
  return als.run({ businessId }, fn);
}
/** Runs fn with no business (global tables only: users, businesses, memberships, invites). */
export function withoutBusiness<T>(fn: () => Promise<T>): Promise<T> { return als.run({}, fn); }

/** `?` → `$n`, skipping anything inside single quotes. */
export function toPg(sql: string): string {
  let n = 0, out = "", q = false;
  for (const ch of sql) {
    if (ch === "'") q = !q;
    out += !q && ch === "?" ? `$${++n}` : ch;
  }
  return out;
}
const norm = (ps: unknown[]) => ps.map((p) => (p === undefined ? null : p));

async function run(sql: string, params: unknown[]) {
  const st = als.getStore();
  if (st?.client) return st.client.query(toPg(sql), norm(params));
  if (currentBusiness()) return tx(() => als.getStore()!.client!.query(toPg(sql), norm(params))); // tenant-scoped single statement
  return pool().query(toPg(sql), norm(params));
}
export async function many<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await run(sql, params)).rows as T[];
}
export async function one<T = Record<string, any>>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await many<T>(sql, params))[0];
}
export async function exec(sql: string, params: unknown[] = []): Promise<number> {
  return (await run(sql, params)).rowCount ?? 0;
}
export async function scalar<T = number>(sql: string, params: unknown[] = []): Promise<T> {
  const r = await one<Record<string, T>>(sql, params);
  return r ? (Object.values(r)[0] as T) : (undefined as T);
}

const RETRYABLE = new Set(["40001", "40P01", "23505"]);
let spSeq = 0;
/** Runs fn in one transaction, tagged with the current business. A nested call becomes a savepoint
    (retried on the same races), so core logic keeps its guarantees inside a request-wide transaction. */
/** A short random pause before retrying, so requests that collided don't collide again. */
const backoff = (attempt: number) => new Promise((r) => setTimeout(r, Math.random() * 25 * (attempt + 1)));
export async function tx<T>(fn: () => Promise<T>, retries = 4): Promise<T> {
  const st = als.getStore();
  if (st?.client) {
    for (let attempt = 0; ; attempt++) {
      const sp = `sp_${++spSeq}`;
      await st.client.query(`SAVEPOINT ${sp}`);
      try { const out = await fn(); await st.client.query(`RELEASE SAVEPOINT ${sp}`); return out; }
      catch (e) {
        await st.client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
        const code = (e as { code?: string }).code;
        if (attempt < retries && code && RETRYABLE.has(code)) { await backoff(attempt); continue; }
        throw e;
      }
    }
  }
  const businessId = currentBusiness();
  for (let attempt = 0; ; attempt++) {
    const client = await pool().connect();
    try {
      await client.query("BEGIN");
      if (businessId) await client.query("SELECT set_config('app.business_id', $1, true)", [businessId]);
      const out = await als.run({ businessId, client }, fn);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      const code = (e as { code?: string }).code;
      if (attempt < retries && code && RETRYABLE.has(code)) { await backoff(attempt); continue; }
      throw e;
    } finally {
      client.release();
    }
  }
}
