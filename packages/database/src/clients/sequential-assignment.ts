import { ensureDatabasesBootstrapped } from "../bootstrap";
import { getRawLibSqlClient } from "./handles";

export interface SequentialStaffCandidate {
  id: string;
  name: string;
}

let cursorTableReady: Promise<void> | null = null;

async function ensureSequentialCursorTable(): Promise<void> {
  if (!cursorTableReady) {
    cursorTableReady = (async () => {
      await ensureDatabasesBootstrapped();
      const conv = getRawLibSqlClient("conversations");
      await conv.execute(`CREATE TABLE IF NOT EXISTS assignment_round_robin_cursors (
        scope TEXT PRIMARY KEY,
        last_staff_id TEXT NOT NULL DEFAULT '',
        last_staff_name TEXT NOT NULL DEFAULT '',
        assigned_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )`);
    })().catch((err) => {
      cursorTableReady = null;
      throw err;
    });
  }
  return cursorTableReady;
}

const scopeLocks = new Map<string, Promise<unknown>>();

async function withScopeLock<T>(scope: string, fn: () => Promise<T>): Promise<T> {
  const prev = scopeLocks.get(scope) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  const tracked = next.finally(() => {
    if (scopeLocks.get(scope) === tracked) {
      scopeLocks.delete(scope);
    }
  });
  scopeLocks.set(scope, tracked);
  return next;
}

/** Sorts eligible staff members alphabetically A to Z by name, tie-broken deterministically by id. */
export function sortStaffAlphabeticallyAtoZ<T extends SequentialStaffCandidate>(
  candidates: T[]
): T[] {
  return [...candidates].sort((a, b) => {
    const nameA = String(a.name || "").trim();
    const nameB = String(b.name || "").trim();
    const cmp = nameA.localeCompare(nameB, "en", { sensitivity: "base" });
    return cmp !== 0 ? cmp : String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Picks the next staff member in A-to-Z sequence irrespective of current chat/lead load.
 * Wraps back to the first alphabetical member after the last member completes ("if all completed then repeat").
 */
export async function pickNextSequentialStaffAtoZ<T extends SequentialStaffCandidate>(
  candidates: T[],
  scope: string
): Promise<{ chosen: T; position: number; total: number } | null> {
  if (candidates.length === 0) return null;
  const sorted = sortStaffAlphabeticallyAtoZ(candidates);

  return withScopeLock(scope, async () => {
    await ensureSequentialCursorTable();
    const conv = getRawLibSqlClient("conversations");
    const rowRes = await conv.execute({
      sql: `SELECT last_staff_id, last_staff_name
            FROM assignment_round_robin_cursors
            WHERE scope = ?
            LIMIT 1`,
      args: [scope],
    });
    const lastId = rowRes.rows[0]?.last_staff_id
      ? String(rowRes.rows[0].last_staff_id)
      : "";
    const lastName = rowRes.rows[0]?.last_staff_name
      ? String(rowRes.rows[0].last_staff_name)
      : "";

    let nextIdx = 0;
    if (lastId) {
      const exactIdx = sorted.findIndex((c) => c.id === lastId);
      if (exactIdx >= 0) {
        nextIdx = (exactIdx + 1) % sorted.length;
      } else if (lastName) {
        const afterIdx = sorted.findIndex(
          (c) =>
            String(c.name || "")
              .trim()
              .localeCompare(lastName.trim(), "en", { sensitivity: "base" }) > 0
        );
        nextIdx = afterIdx >= 0 ? afterIdx : 0;
      }
    }

    const chosen = sorted[nextIdx];
    const nowIso = new Date().toISOString();
    await conv.execute({
      sql: `INSERT INTO assignment_round_robin_cursors (
              scope, last_staff_id, last_staff_name, assigned_count, updated_at
            ) VALUES (?, ?, ?, 1, ?)
            ON CONFLICT(scope) DO UPDATE SET
              last_staff_id = excluded.last_staff_id,
              last_staff_name = excluded.last_staff_name,
              assigned_count = assignment_round_robin_cursors.assigned_count + 1,
              updated_at = excluded.updated_at`,
      args: [scope, chosen.id, String(chosen.name || ""), nowIso],
    });

    return {
      chosen,
      position: nextIdx + 1,
      total: sorted.length,
    };
  });
}

export async function resetSequentialAssignmentCursorForTest(scope?: string): Promise<void> {
  await ensureSequentialCursorTable();
  const conv = getRawLibSqlClient("conversations");
  if (scope) {
    await conv.execute({
      sql: `DELETE FROM assignment_round_robin_cursors WHERE scope = ?`,
      args: [scope],
    });
  } else {
    await conv.execute(`DELETE FROM assignment_round_robin_cursors`);
  }
}
