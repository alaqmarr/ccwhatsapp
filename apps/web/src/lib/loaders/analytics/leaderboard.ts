import { computeMedian } from "./time-utils";

type DbRow = Record<string, unknown>;

export function buildAgentLeaderboard(params: {
  userRows: DbRow[];
  assignAggRows: DbRow[];
  assignRespRows: DbRow[];
  teamNamesLower: Set<string>;
  userIdByLowerName: Map<string, string>;
  acrioRepliesCount: number;
  staffOutboundRepliesById: Map<string, number>;
  staffOutboundRepliesByName: Map<string, number>;
  resolvedByStaffId: Map<string, number>;
  resolvedByStaffName: Map<string, number>;
  openLoadByStaff: Map<string, number>;
}) {
  const {
    userRows,
    assignAggRows,
    assignRespRows,
    teamNamesLower,
    userIdByLowerName,
    acrioRepliesCount,
    staffOutboundRepliesById,
    staffOutboundRepliesByName,
    resolvedByStaffId,
    resolvedByStaffName,
    openLoadByStaff,
  } = params;

  const agentStatsMap = new Map<
    string,
    {
      staffId: string;
      staffName: string;
      role: string;
      department: string;
      isSystem: boolean;
      assignmentsCount: number;
      respondedCount: number;
      sumRespSec: number;
      minRespSec: number | null;
      maxRespSec: number | null;
      responseSecs: number[];
      under5MinCount: number;
      escalatedCount: number;
      reassignedCount: number;
    }
  >();

  agentStatsMap.set("ACRIO", {
    staffId: "ACRIO",
    staffName: "System (ACRIO)",
    role: "SYSTEM_AI",
    department: "Automated Concierge",
    isSystem: true,
    assignmentsCount: 0,
    respondedCount: 0,
    sumRespSec: 0,
    minRespSec: null,
    maxRespSec: null,
    responseSecs: [],
    under5MinCount: 0,
    escalatedCount: 0,
    reassignedCount: 0,
  });

  for (const u of userRows) {
    const uid = String(u.id);
    agentStatsMap.set(uid, {
      staffId: uid,
      staffName: String(u.name),
      role: String(u.role),
      department: String(u.department || "Sales Team"),
      isSystem: false,
      assignmentsCount: 0,
      respondedCount: 0,
      sumRespSec: 0,
      minRespSec: null,
      maxRespSec: null,
      responseSecs: [],
      under5MinCount: 0,
      escalatedCount: 0,
      reassignedCount: 0,
    });
  }

  const resolveStaffId = (rawSid: string, sName: string): string =>
    rawSid ||
    (sName && !teamNamesLower.has(sName.toLowerCase())
      ? userIdByLowerName.get(sName.toLowerCase()) || ""
      : "");

  for (const a of assignAggRows) {
    const rawSid = a.to_staff_id ? String(a.to_staff_id) : "";
    const sName = String(a.to_staff_name || "").trim();
    const sid = resolveStaffId(rawSid, sName);

    if (!sid || sid === "UNASSIGNED" || teamNamesLower.has(sName.toLowerCase())) {
      continue;
    }

    if (!agentStatsMap.has(sid)) {
      agentStatsMap.set(sid, {
        staffId: sid,
        staffName: sName || "Team Member",
        role: sid === "ACRIO" ? "SYSTEM_AI" : "STAFF",
        department: String(a.to_team_name || "Sales Team"),
        isSystem: sid === "ACRIO",
        assignmentsCount: 0,
        respondedCount: 0,
        sumRespSec: 0,
        minRespSec: null,
        maxRespSec: null,
        responseSecs: [],
        under5MinCount: 0,
        escalatedCount: 0,
        reassignedCount: 0,
      });
    }
    const st = agentStatsMap.get(sid)!;
    const cnt = Number(a.cnt ?? 0);
    const respCnt = Number(a.responded_cnt ?? 0);
    st.assignmentsCount += cnt;
    st.respondedCount += respCnt;
    st.under5MinCount += Number(a.under_5min_cnt ?? 0);
    st.sumRespSec += Number(a.sum_resp_sec ?? 0);

    if (respCnt > 0 && a.min_resp_sec !== null && a.min_resp_sec !== undefined) {
      const minV = Number(a.min_resp_sec);
      st.minRespSec = st.minRespSec === null ? minV : Math.min(st.minRespSec, minV);
    }
    if (respCnt > 0 && a.max_resp_sec !== null && a.max_resp_sec !== undefined) {
      const maxV = Number(a.max_resp_sec);
      st.maxRespSec = st.maxRespSec === null ? maxV : Math.max(st.maxRespSec, maxV);
    }

    const outcome = String(a.outcome || "");
    if (outcome === "ESCALATED") st.escalatedCount += cnt;
    else if (outcome === "REASSIGNED") st.reassignedCount += cnt;
  }

  for (const r of assignRespRows) {
    const rawSid = r.to_staff_id ? String(r.to_staff_id) : "";
    const sName = String(r.to_staff_name || "").trim();
    const sid = resolveStaffId(rawSid, sName);
    if (!sid || sid === "UNASSIGNED" || teamNamesLower.has(sName.toLowerCase())) {
      continue;
    }
    const st = agentStatsMap.get(sid);
    if (st && r.first_response_seconds !== null && r.first_response_seconds !== undefined) {
      st.responseSecs.push(Number(r.first_response_seconds));
    }
  }

  return Array.from(agentStatsMap.values())
    .map((ag) => {
      const responseRatePct =
        ag.assignmentsCount > 0
          ? Math.round((ag.respondedCount / ag.assignmentsCount) * 100)
          : 0;
      const under5MinPct =
        ag.respondedCount > 0
          ? Math.round((ag.under5MinCount / ag.respondedCount) * 100)
          : 0;
      const repliesSent = ag.isSystem
        ? acrioRepliesCount
        : staffOutboundRepliesById.get(ag.staffId) ??
          staffOutboundRepliesByName.get(ag.staffName) ??
          0;
      const resolvedCount = ag.isSystem
        ? resolvedByStaffName.get("ACRIO Smart Resolution") || 0
        : resolvedByStaffId.get(ag.staffId) ??
          resolvedByStaffName.get(ag.staffName) ??
          0;

      return {
        staffId: ag.staffId,
        staffName: ag.staffName,
        role: ag.role,
        department: ag.department,
        isSystem: ag.isSystem,
        assignmentsCount: ag.assignmentsCount,
        respondedCount: ag.respondedCount,
        responseRatePct,
        avgFirstResponseSeconds:
          ag.respondedCount > 0 ? Math.round(ag.sumRespSec / ag.respondedCount) : null,
        medianFirstResponseSeconds: computeMedian(ag.responseSecs),
        fastestFirstResponseSeconds: ag.minRespSec,
        slowestFirstResponseSeconds: ag.maxRespSec,
        under5MinPct,
        escalatedCount: ag.escalatedCount,
        reassignedCount: ag.reassignedCount,
        activeOpenChats: openLoadByStaff.get(ag.staffId) || 0,
        outboundRepliesSent: repliesSent,
        resolvedCount,
      };
    })
    .sort((a, b) => {
      if (a.isSystem !== b.isSystem) return a.isSystem ? 1 : -1;
      if (b.assignmentsCount !== a.assignmentsCount) {
        return b.assignmentsCount - a.assignmentsCount;
      }
      return b.outboundRepliesSent - a.outboundRepliesSent;
    });
}

export function buildTeamBreakdown(params: {
  teamRows: DbRow[];
  teamAssignAggRows: DbRow[];
  teamConvAggRows: DbRow[];
}) {
  const { teamRows, teamAssignAggRows, teamConvAggRows } = params;
  const assignByTeam = new Map<string, DbRow>();
  for (const r of teamAssignAggRows) {
    const tid = String(r.team_id || "");
    if (tid) assignByTeam.set(tid, r);
  }
  const convByTeam = new Map<string, DbRow>();
  for (const r of teamConvAggRows) {
    const tid = String(r.team_id || "");
    if (tid) convByTeam.set(tid, r);
  }

  return teamRows.map((t) => {
    const tid = String(t.id);
    const asg = assignByTeam.get(tid);
    const conv = convByTeam.get(tid);
    const responded = Number(asg?.responded_cnt ?? 0);
    const avgRaw = asg?.avg_resp_sec;

    return {
      teamId: tid,
      teamName: String(t.name),
      brandScope: String(t.brand_scope || "ALL"),
      p0WaitMinutes: Number(t.p0_wait_minutes ?? 5),
      p1WaitMinutes: Number(t.p1_wait_minutes ?? 12),
      assignmentsCount: Number(asg?.assignments_cnt ?? 0),
      respondedCount: responded,
      avgFirstResponseSeconds:
        responded > 0 && avgRaw !== null && avgRaw !== undefined
          ? Math.round(Number(avgRaw))
          : null,
      p0Count: Number(asg?.p0_cnt ?? 0),
      p1Count: Number(asg?.p1_cnt ?? 0),
      p2Count: Number(asg?.p2_cnt ?? 0),
      escalatedCount: Number(asg?.escalated_cnt ?? 0),
      openChatsCount: Number(conv?.open_cnt ?? 0),
      currentlyWaitingCount: Number(conv?.waiting_cnt ?? 0),
    };
  });
}
