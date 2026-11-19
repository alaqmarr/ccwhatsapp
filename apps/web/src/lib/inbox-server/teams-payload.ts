import { getCachedEcosystemCatalog } from "@cc/connections";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveSharedAnthropicApiKey,
} from "@cc/database";
import { getWhatsAppCacheSummary } from "@cc/storage";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export async function getInitialTeamsPayload(canManage: boolean) {
  await ensureDatabasesBootstrapped();
  ensureBackgroundWorkersRunning();

  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");

  const [teamsRes, membersRes, staffRes, activeLoadsRes, catalog, aiKey] =
    await Promise.all([
      conv.execute(`SELECT * FROM teams ORDER BY priority_rank ASC, name ASC`),
      conv.execute(
        `SELECT * FROM team_members
         ORDER BY CASE tier WHEN 'P0' THEN 1 WHEN 'P1' THEN 2 ELSE 3 END ASC, staff_name ASC`
      ),
      auth.execute(
        `SELECT id, name, email, whatsapp_number, role, department
         FROM users
         WHERE status = 'ACTIVE' AND role NOT IN ('CLIENT', 'DEV')
         ORDER BY name ASC`
      ),
      conv.execute(
        `SELECT assigned_staff_id, assigned_team_id, waiting_since
         FROM conversations
         WHERE status != 'RESOLVED'`
      ),
      getCachedEcosystemCatalog(),
      resolveSharedAnthropicApiKey(),
    ]);

  const loadByStaff = new Map<string, number>();
  const waitingByTeam = new Map<string, number>();
  for (const r of activeLoadsRes.rows) {
    if (r.assigned_staff_id) {
      const sid = String(r.assigned_staff_id);
      loadByStaff.set(sid, (loadByStaff.get(sid) || 0) + 1);
    }
    if (r.assigned_team_id && r.waiting_since) {
      const tid = String(r.assigned_team_id);
      waitingByTeam.set(tid, (waitingByTeam.get(tid) || 0) + 1);
    }
  }

  const members = membersRes.rows.map((m) => ({
    id: String(m.id),
    teamId: String(m.team_id),
    staffId: String(m.staff_id),
    staffName: String(m.staff_name),
    staffEmail: String(m.staff_email || ""),
    tier: String(m.tier || "P0") as "P0" | "P1" | "P2",
    maxActiveChats: Number(m.max_active_chats ?? 8),
    isAvailable: Number(m.is_available ?? 1) === 1,
    activeOpenChats: loadByStaff.get(String(m.staff_id)) || 0,
  }));

  const teams = teamsRes.rows.map((t) => {
    const id = String(t.id);
    return {
      id,
      name: String(t.name),
      description: String(t.description || ""),
      brandScope: String(t.brand_scope || "ALL"),
      routingKeywords: String(t.routing_keywords || ""),
      priorityRank: Number(t.priority_rank ?? 10),
      p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
      p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
      autoAssignEnabled: Number(t.auto_assign_enabled ?? 1) === 1,
      waitingChatsCount: waitingByTeam.get(id) || 0,
      members: members.filter((m) => m.teamId === id),
    };
  });

  const activeStaff = staffRes.rows.map((s) => ({
    id: String(s.id),
    name: String(s.name),
    email: String(s.email),
    whatsappNumber: String(s.whatsapp_number),
    role: String(s.role),
    department: String(s.department || "Operations"),
    activeOpenChats: loadByStaff.get(String(s.id)) || 0,
  }));

  const cacheSummary = getWhatsAppCacheSummary();

  return {
    canManage,
    teams,
    activeStaff,
    syncInfo: {
      classicConceptsCount: catalog.classicConceptsProducts.length,
      classicEdgeMachinesCount: catalog.classicEdgeItems.filter(
        (i) => i.itemType === "MACHINE"
      ).length,
      classicEdgeConsumablesCount: catalog.classicEdgeItems.filter(
        (i) => i.itemType === "CONSUMABLE"
      ).length,
      lastSyncedAt: cacheSummary.lastSyncedAt,
      aiConnected: Boolean(aiKey.apiKey),
      aiKeySource: aiKey.source,
      aiMaskedKey: aiKey.apiKey
        ? `${aiKey.apiKey.slice(0, 10)}...${aiKey.apiKey.slice(-4)}`
        : "",
    },
  };
}
