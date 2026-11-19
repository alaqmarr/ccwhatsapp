import { getRawLibSqlClient } from "@cc/database";
import { socketHub } from "@cc/sockets";

export async function handleTemplateStatusUpdate(
  val: Record<string, any>,
  nowIso: string
): Promise<void> {
  const mkt = getRawLibSqlClient("marketing");
  const eventRaw = String(val?.event || "").toUpperCase();
  const cleanMetaTplId = String(val?.message_template_id || "").trim();
  const cleanMetaTplName = String(val?.message_template_name || "").trim();
  const reason =
    val?.reason && String(val.reason) !== "NONE" ? String(val.reason) : null;

  const mappedStatus =
    eventRaw === "APPROVED"
      ? "APPROVED"
      : eventRaw === "REJECTED" || eventRaw === "DISABLED"
      ? "REJECTED"
      : eventRaw === "PAUSED"
      ? "PAUSED"
      : "PENDING_APPROVAL";

  if (!cleanMetaTplId && !cleanMetaTplName) return;

  const matchClauses: string[] = [];
  const matchArgs: any[] = [];
  if (cleanMetaTplId) {
    matchClauses.push(`(meta_template_id = ? AND meta_template_id != '')`);
    matchArgs.push(cleanMetaTplId);
  }
  if (cleanMetaTplName) {
    matchClauses.push(`(LOWER(name) = LOWER(?) AND name != '')`);
    matchArgs.push(cleanMetaTplName);
  }
  if (matchClauses.length === 0) return;

  await mkt
    .execute({
      sql: `UPDATE templates
            SET approval_status = ?,
                rejection_reason = ?,
                meta_template_id = COALESCE(NULLIF(?, ''), meta_template_id),
                updated_at = ?
            WHERE ${matchClauses.join(" OR ")}`,
      args: [
        mappedStatus,
        reason,
        cleanMetaTplId || null,
        nowIso,
        ...matchArgs,
      ],
    })
    .catch(() => {});

  socketHub.emit("template:updated", {
    metaTemplateId: cleanMetaTplId,
    name: cleanMetaTplName,
    status: mappedStatus,
  });
}
