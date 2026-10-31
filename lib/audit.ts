import { many, one, exec, tx, scalar } from "./sql";
import type { Actor } from "./authz";

/** Who did what, when. Owners and managers can read it in Settings. */
export async function audit(actor: Actor, action: string, entityType: string, entityId: string, details?: unknown) {
  (await exec("INSERT INTO audit_log (user_id, user_name, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)", [actor.id, actor.name, action, entityType, entityId, details === undefined ? "" : JSON.stringify(details)]));
}
export async function getAudit(limit = 200, entityType?: string, entityId?: string) {
  const where = entityType ? "WHERE entity_type = ? AND entity_id = ?" : "";
  const args = entityType ? [entityType, entityId, limit] : [limit];
  return (await many(`SELECT * FROM audit_log ${where} ORDER BY id DESC LIMIT ?`, [...args]));
}
