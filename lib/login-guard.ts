/* Slows down password guessing: 5 failures per email or IP within 15 minutes locks that key for 15 minutes.
   Stored in Postgres so it holds across serverless instances and pods. */
import { exec, scalar } from "./sql";

const MAX = 5;
export async function isLocked(keys: string[]) {
  const n = await scalar<number>("SELECT COALESCE(MAX(c), 0) FROM (SELECT COUNT(*) c FROM login_attempts WHERE key = ANY(?) AND at > now() - interval '15 minutes' GROUP BY key) t", [keys]);
  return n >= MAX;
}
export async function noteFailure(keys: string[]) {
  for (const k of keys) await exec("INSERT INTO login_attempts (key) VALUES (?)", [k]);
  if (Math.random() < 0.05) await exec("DELETE FROM login_attempts WHERE at < now() - interval '1 day'");
}
export async function clearFailures(keys: string[]) { await exec("DELETE FROM login_attempts WHERE key = ANY(?)", [keys]); }
export async function _resetGuard() { await exec("DELETE FROM login_attempts"); }
