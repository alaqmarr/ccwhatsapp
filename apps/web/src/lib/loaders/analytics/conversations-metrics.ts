import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import { buildAgentLeaderboard, buildTeamBreakdown } from "./leaderboard";
import {
  APP_TIMEZONE,
  formatHourLabel,
  toIstDateKey,
} from "./time-utils";

type DbRow = Record<string, unknown>;

export function buildConversationAndMessageMetrics(params: {
  convStatusRows: DbRow[];
  convCatPriRows: DbRow[];
  convDailyNewRows: DbRow[];
  convDailyResolvedRows: DbRow[];
  msgSummaryRows: DbRow[];
  msgDailyRows: DbRow[];
  msgHourlyRows: DbRow[];
  assignAggRows: DbRow[];
  assignDailyRows: DbRow[];
  assignRespRows: DbRow[];
  acrioAutonRow: DbRow;
  teamAssignAggRows: DbRow[];
  teamConvAggRows: DbRow[];
  teamRows: DbRow[];
  userRows: DbRow[];
  daysSpan: number;
  nowMs: number;
}) {
  const {
    convStatusRows,
    convCatPriRows,
    convDailyNewRows,
    convDailyResolvedRows,
    msgSummaryRows,
    msgDailyRows,
    msgHourlyRows,
    assignAggRows,
    assignDailyRows,
    assignRespRows,
    acrioAutonRow,
    teamAssignAggRows,
    teamConvAggRows,
    teamRows,
    userRows,
    daysSpan,
    nowMs,
  } = params;

  const userIdByLowerName = new Map<string, string>();
  const teamNamesLower = new Set<string>();
  for (const u of userRows) {
    userIdByLowerName.set(String(u.name || "").trim().toLowerCase(), String(u.id));
  }
  for (const t of teamRows) {
    teamNamesLower.add(String(t.name || "").trim().toLowerCase());
  }

  let totalConvsCount = 0;
  let openChatsCount = 0;
  let assignedChatsCount = 0;
  let resolvedChatsCount = 0;
  let waitingNowCount = 0;
  let waitingP0Count = 0;
  let waitingP1Count = 0;
  let waitingP2Count = 0;
  let acrioLiveChatsCount = 0;

  const openLoadByStaff = new Map<string, number>();
  const resolvedByStaffName = new Map<string, number>();
  const resolvedByStaffId = new Map<string, number>();

  for (const r of convStatusRows) {
    const cnt = Number(r.cnt ?? 0);
    const st = String(r.status || "OPEN");
    const staffId = String(r.staff_id || "ACRIO");
    const esc = String(r.esc_level || "P0");
    const isWaiting = Number(r.is_waiting ?? 0) === 1;
    totalConvsCount += cnt;

    if (st === "RESOLVED") {
      resolvedChatsCount += cnt;
      const explicitResId = r.resolved_by_id ? String(r.resolved_by_id) : "";
      const rName = r.resolved_by_name ? String(r.resolved_by_name).trim() : "";
      if (rName) {
        resolvedByStaffName.set(rName, (resolvedByStaffName.get(rName) || 0) + cnt);
      }
      const mappedUid =
        explicitResId || (rName ? userIdByLowerName.get(rName.toLowerCase()) || "" : "");
      if (mappedUid) {
        resolvedByStaffId.set(mappedUid, (resolvedByStaffId.get(mappedUid) || 0) + cnt);
      }
    } else {
      if (st === "ASSIGNED") assignedChatsCount += cnt;
      else openChatsCount += cnt;

      openLoadByStaff.set(staffId, (openLoadByStaff.get(staffId) || 0) + cnt);
      if (staffId === "ACRIO") acrioLiveChatsCount += cnt;

      if (isWaiting && staffId !== "ACRIO") {
        waitingNowCount += cnt;
        if (esc === "P2") waitingP2Count += cnt;
        else if (esc === "P1") waitingP1Count += cnt;
        else waitingP0Count += cnt;
      }
    }
  }

  const categoryCounts = new Map<string, number>();
  const priorityCounts = new Map<string, number>();
  for (const r of convCatPriRows) {
    const cnt = Number(r.cnt ?? 0);
    const cat = String(r.category || "General Enquiry");
    const pri = String(r.priority || "NORMAL");
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + cnt);
    priorityCounts.set(pri, (priorityCounts.get(pri) || 0) + cnt);
  }

  let humanAssignmentsCount = 0;
  let acrioAssignmentsCount = 0;
  let humanRespondedCount = 0;
  let humanSumRespSec = 0;
  let humanMinRespSec: number | null = null;
  let humanMaxRespSec: number | null = null;
  let humanUnder5MinCount = 0;
  let autoEscalationsCount = 0;
  let acrioRespondedCount = 0;
  let acrioSumRespSec = 0;

  for (const a of assignAggRows) {
    const cnt = Number(a.cnt ?? 0);
    const respCnt = Number(a.responded_cnt ?? 0);
    const sumSec = Number(a.sum_resp_sec ?? 0);
    const staffId = String(a.to_staff_id || "");

    if (staffId === "ACRIO") {
      acrioAssignmentsCount += cnt;
      acrioRespondedCount += respCnt;
      acrioSumRespSec += sumSec;
    } else {
      humanAssignmentsCount += cnt;
      if (String(a.assignment_source) === "AUTO_ESCALATION") {
        autoEscalationsCount += cnt;
      }
      humanRespondedCount += respCnt;
      humanSumRespSec += sumSec;
      humanUnder5MinCount += Number(a.under_5min_cnt ?? 0);

      if (respCnt > 0 && a.min_resp_sec !== null && a.min_resp_sec !== undefined) {
        const minV = Number(a.min_resp_sec);
        humanMinRespSec =
          humanMinRespSec === null ? minV : Math.min(humanMinRespSec, minV);
      }
      if (respCnt > 0 && a.max_resp_sec !== null && a.max_resp_sec !== undefined) {
        const maxV = Number(a.max_resp_sec);
        humanMaxRespSec =
          humanMaxRespSec === null ? maxV : Math.max(humanMaxRespSec, maxV);
      }
    }
  }

  const humanResponseTimes: number[] = [];
  for (const r of assignRespRows) {
    if (String(r.to_staff_id || "") !== "ACRIO" && r.first_response_seconds !== null && r.first_response_seconds !== undefined) {
      humanResponseTimes.push(Number(r.first_response_seconds));
    }
  }

  const convsWithAcrioAsgCount = Number(acrioAutonRow.acrio_convs ?? 0);
  const acrioAutonomousChats = Number(acrioAutonRow.autonomous_convs ?? 0);
  const avgHumanFirstResponseSeconds =
    humanRespondedCount > 0 ? Math.round(humanSumRespSec / humanRespondedCount) : null;
  const acrioAvgResponseSeconds =
    acrioRespondedCount > 0 ? Math.round(acrioSumRespSec / acrioRespondedCount) : null;

  let inboundMessagesCount = 0;
  let outboundMessagesCount = 0;
  let freeStaffRepliesCount = 0;
  let acrioRepliesCount = 0;
  let templateMessagesCount = 0;
  let internalNotesCount = 0;
  const tickCounts = { sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };

  const staffOutboundRepliesByName = new Map<string, number>();
  const staffOutboundRepliesById = new Map<string, number>();

  for (const m of msgSummaryRows) {
    const cnt = Number(m.cnt ?? 0);
    const dir = String(m.direction);
    const mType = String(m.message_type);
    const bCat = String(m.billing_category);
    const dStat = String(m.d_stat || "SENT").toUpperCase();

    if (dir === "INBOUND") {
      inboundMessagesCount += cnt;
    } else if (dir === "OUTBOUND") {
      outboundMessagesCount += cnt;
      if (bCat === "ACRIO") acrioRepliesCount += cnt;
      else if (mType === "TEMPLATE") templateMessagesCount += cnt;
      else freeStaffRepliesCount += cnt;

      const sName = String(m.sender_name || "").trim();
      const sStaffId = m.sender_staff_id
        ? String(m.sender_staff_id)
        : sName
        ? userIdByLowerName.get(sName.toLowerCase()) || ""
        : "";
      if (sName) {
        staffOutboundRepliesByName.set(
          sName,
          (staffOutboundRepliesByName.get(sName) || 0) + cnt
        );
      }
      if (sStaffId) {
        staffOutboundRepliesById.set(
          sStaffId,
          (staffOutboundRepliesById.get(sStaffId) || 0) + cnt
        );
      }

      if (dStat === "SENDING") tickCounts.sending += cnt;
      else if (dStat === "SENT") tickCounts.sent += cnt;
      else if (dStat === "DELIVERED") tickCounts.delivered += cnt;
      else if (dStat === "READ") tickCounts.read += cnt;
      else if (dStat === "FAILED") tickCounts.failed += cnt;
      else tickCounts.delivered += cnt;
    } else if (mType === "INTERNAL_NOTE") {
      internalNotesCount += cnt;
    }
  }

  const hourlyIst = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    label: formatHourLabel(h),
    inboundCount: 0,
    outboundCount: 0,
  }));
  for (const r of msgHourlyRows) {
    const hr = r.ist_hour !== null && r.ist_hour !== undefined ? Number(r.ist_hour) : -1;
    if (hr < 0 || hr > 23) continue;
    const cnt = Number(r.cnt ?? 0);
    if (String(r.direction) === "INBOUND") hourlyIst[hr].inboundCount += cnt;
    else if (String(r.direction) === "OUTBOUND") hourlyIst[hr].outboundCount += cnt;
  }

  const chartDays = Math.min(daysSpan, 30);
  const dailyMap = new Map<
    string,
    {
      date: string;
      label: string;
      inboundMessages: number;
      outboundMessages: number;
      newConversations: number;
      resolvedConversations: number;
      humanAssignments: number;
      avgFirstResponseSeconds: number | null;
    }
  >();

  for (let i = chartDays - 1; i >= 0; i--) {
    const dMs = nowMs - i * 24 * 60 * 60 * 1000;
    const key = toIstDateKey(new Date(dMs).toISOString());
    const parsed = fromZonedTime(`${key} 00:00:00`, APP_TIMEZONE);
    const label = formatInTimeZone(parsed, APP_TIMEZONE, "d MMM");
    dailyMap.set(key, {
      date: key,
      label,
      inboundMessages: 0,
      outboundMessages: 0,
      newConversations: 0,
      resolvedConversations: 0,
      humanAssignments: 0,
      avgFirstResponseSeconds: null,
    });
  }

  for (const r of msgDailyRows) {
    const bucket = dailyMap.get(String(r.ist_day || ""));
    if (!bucket) continue;
    const cnt = Number(r.cnt ?? 0);
    if (String(r.direction) === "INBOUND") bucket.inboundMessages += cnt;
    else if (String(r.direction) === "OUTBOUND") bucket.outboundMessages += cnt;
  }
  for (const r of convDailyNewRows) {
    const bucket = dailyMap.get(String(r.ist_day || ""));
    if (bucket) bucket.newConversations += Number(r.cnt ?? 0);
  }
  for (const r of convDailyResolvedRows) {
    const bucket = dailyMap.get(String(r.ist_day || ""));
    if (bucket) bucket.resolvedConversations += Number(r.cnt ?? 0);
  }
  for (const r of assignDailyRows) {
    const bucket = dailyMap.get(String(r.ist_day || ""));
    if (!bucket) continue;
    bucket.humanAssignments += Number(r.cnt ?? 0);
    if (r.avg_resp_sec !== null && r.avg_resp_sec !== undefined) {
      bucket.avgFirstResponseSeconds = Math.round(Number(r.avg_resp_sec));
    }
  }

  const dailySeries = Array.from(dailyMap.values());

  const agentLeaderboard = buildAgentLeaderboard({
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
  });

  const teamBreakdown = buildTeamBreakdown({
    teamRows,
    teamAssignAggRows,
    teamConvAggRows,
  });

  return {
    totalConvsCount,
    humanAssignmentsCount,
    acrioAssignmentsCount,
    convsWithAcrioAsgCount,
    acrioAutonomousChats,
    acrioAvgResponseSeconds,
    avgHumanFirstResponseSeconds,
    humanMinRespSec,
    humanMaxRespSec,
    humanResponseTimes,
    humanRespondedCount,
    humanUnder5MinCount,
    autoEscalationsCount,
    openChatsCount,
    assignedChatsCount,
    resolvedChatsCount,
    waitingNowCount,
    waitingP0Count,
    waitingP1Count,
    waitingP2Count,
    acrioLiveChatsCount,
    inboundMessagesCount,
    outboundMessagesCount,
    freeStaffRepliesCount,
    acrioRepliesCount,
    templateMessagesCount,
    internalNotesCount,
    tickCounts,
    hourlyIst,
    dailySeries,
    agentLeaderboard,
    teamBreakdown,
    categoryCounts,
    priorityCounts,
  };
}
