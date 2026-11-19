import type { AuthenticatedUser } from "@cc/auth";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  listActiveNonClientStaff,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { rememberWhatsAppCache } from "@cc/storage";
import { chunkArray, parseJsonArray } from "./helpers";

function buildContactsSqlWhere(filters?: {
  q?: string;
  stage?: string;
  optIn?: string;
  orgType?: string;
  source?: string;
  groupId?: string;
  tag?: string;
}): { whereSql: string; args: (string | number)[] } {
  const q = (filters?.q || "").trim().toLowerCase();
  const stageFilter = (filters?.stage || "ALL").trim();
  const optInFilter = (filters?.optIn || "ALL").trim();
  const orgFilter = (filters?.orgType || "ALL").trim();
  const sourceFilter = (filters?.source || "ALL").trim();
  const groupFilter = (filters?.groupId || "ALL").trim();
  const tagFilter = (filters?.tag || "ALL").trim();

  const clauses: string[] = [];
  const args: (string | number)[] = [];

  if (stageFilter !== "ALL") {
    if (stageFilter === "BUYERS_ALL") {
      clauses.push(
        `(COALESCE(total_orders_count, 0) > 0 OR stage IN ('CUSTOMER', 'REPEAT_BUYER', 'VIP'))`
      );
    } else {
      clauses.push(`stage = ?`);
      args.push(stageFilter);
    }
  }

  if (optInFilter === "OPTED_IN") {
    clauses.push(`COALESCE(opt_in_marketing, 1) = 1`);
  } else if (optInFilter === "OPTED_OUT") {
    clauses.push(`COALESCE(opt_in_marketing, 1) != 1`);
  }

  if (orgFilter !== "ALL") {
    clauses.push(`COALESCE(organization_type, 'Business') = ?`);
    args.push(orgFilter);
  }

  if (sourceFilter !== "ALL") {
    clauses.push(`COALESCE(source, 'MANUAL') = ?`);
    args.push(sourceFilter);
  }

  if (groupFilter !== "ALL") {
    clauses.push(`groups_json LIKE ?`);
    args.push(`%"${groupFilter}"%`);
  }

  if (tagFilter !== "ALL") {
    clauses.push(`tags_json LIKE ?`);
    args.push(`%"${tagFilter}"%`);
  }

  if (q) {
    const like = `%${q}%`;
    clauses.push(
      `(LOWER(COALESCE(name, '')) LIKE ? OR LOWER(COALESCE(whatsapp_name, '')) LIKE ? OR LOWER(phone) LIKE ? OR LOWER(COALESCE(email, '')) LIKE ? OR LOWER(COALESCE(company_name, '')) LIKE ? OR LOWER(COALESCE(designation, '')) LIKE ? OR LOWER(COALESCE(organization_type, '')) LIKE ? OR LOWER(COALESCE(city, '')) LIKE ? OR LOWER(COALESCE(state, '')) LIKE ? OR LOWER(COALESCE(gst_number, '')) LIKE ? OR LOWER(COALESCE(acrio_segment, '')) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ? OR LOWER(COALESCE(tags_json, '')) LIKE ?)`
    );
    for (let i = 0; i < 13; i++) args.push(like);
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "",
    args,
  };
}

function buildContactsSqlOrder(sortBy: string): string {
  switch (sortBy) {
    case "name":
      return "ORDER BY LOWER(COALESCE(NULLIF(name, ''), phone)) ASC";
    case "ltv":
      return "ORDER BY COALESCE(lifetime_value_inr, 0) DESC, updated_at DESC";
    case "orders":
      return "ORDER BY COALESCE(total_orders_count, 0) DESC, updated_at DESC";
    case "created":
      return "ORDER BY created_at DESC";
    default:
      return "ORDER BY COALESCE(last_contacted_at, updated_at) DESC, updated_at DESC";
  }
}

async function loadCachedContactsMeta() {
  return rememberWhatsAppCache(
    "contacts:meta:v1",
    ["contacts-meta"],
    15,
    async () => {
      const contactsDb = getRawLibSqlClient("contacts");
      const convDb = getRawLibSqlClient("conversations");

      const [groupCountsRes, tagCountsRes, groupsRes, convPhonesRes] =
        await Promise.all([
          contactsDb.execute(
            `SELECT CAST(j.value AS TEXT) AS gid, COUNT(*) AS cnt
             FROM contacts,
                  json_each(CASE WHEN json_valid(groups_json) AND json_type(groups_json) = 'array' THEN groups_json ELSE '[]' END) j
             WHERE j.value IS NOT NULL AND CAST(j.value AS TEXT) != ''
             GROUP BY gid`
          ),
          contactsDb.execute(
            `SELECT CAST(j.value AS TEXT) AS tag, COUNT(*) AS cnt
             FROM contacts,
                  json_each(CASE WHEN json_valid(tags_json) AND json_type(tags_json) = 'array' THEN tags_json ELSE '[]' END) j
             WHERE j.value IS NOT NULL AND CAST(j.value AS TEXT) != ''
             GROUP BY tag`
          ),
          contactsDb.execute(
            `SELECT id, name, description, color FROM contact_groups ORDER BY name ASC`
          ),
          convDb.execute(
            `SELECT DISTINCT customer_phone FROM conversations WHERE customer_phone IS NOT NULL AND customer_phone != ''`
          ),
        ]);

      const activeChatPhones = Array.from(
        new Set(
          convPhonesRes.rows
            .map((c) => String(c.customer_phone || ""))
            .filter(Boolean)
        )
      );

      let withActiveChatCount = 0;
      if (activeChatPhones.length > 0) {
        const chunks = await Promise.all(
          chunkArray(activeChatPhones, 400).map((phoneChunk) => {
            const placeholders = phoneChunk.map(() => "?").join(",");
            return contactsDb.execute({
              sql: `SELECT COUNT(*) AS cnt FROM contacts WHERE phone IN (${placeholders})`,
              args: phoneChunk,
            });
          })
        );
        for (const res of chunks) {
          withActiveChatCount += Number(res.rows[0]?.cnt ?? 0);
        }
      }

      const groupMemberCounts = new Map<string, number>();
      for (const g of groupCountsRes.rows) {
        const gid = String(g.gid || "");
        if (gid) groupMemberCounts.set(gid, Number(g.cnt ?? 0));
      }

      const tagCounts = new Map<string, number>();
      for (const t of tagCountsRes.rows) {
        const tag = String(t.tag || "");
        if (tag) tagCounts.set(tag, Number(t.cnt ?? 0));
      }

      return {
        withActiveChatCount,
        groups: groupsRes.rows.map((g) => ({
          id: String(g.id),
          name: String(g.name),
          description: String(g.description || ""),
          color: String(g.color || "emerald"),
          membersCount: groupMemberCounts.get(String(g.id)) ?? 0,
        })),
        allTags: Array.from(tagCounts.entries())
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
      };
    },
    { skipClone: true }
  );
}

export async function loadContactsPayload(
  user: AuthenticatedUser,
  filters?: {
    q?: string;
    stage?: string;
    optIn?: string;
    orgType?: string;
    source?: string;
    groupId?: string;
    tag?: string;
    sort?: string;
    limit?: number;
  }
) {
  await ensureDatabasesBootstrapped();
  const contactsDb = getRawLibSqlClient("contacts");
  const convDb = getRawLibSqlClient("conversations");
  const crmDb = getRawLibSqlClient("crm_orders");
  const mktDb = getRawLibSqlClient("marketing");

  const q = (filters?.q || "").trim().toLowerCase();
  const stageFilter = (filters?.stage || "ALL").trim();
  const optInFilter = (filters?.optIn || "ALL").trim();
  const orgFilter = (filters?.orgType || "ALL").trim();
  const sourceFilter = (filters?.source || "ALL").trim();
  const groupFilter = (filters?.groupId || "ALL").trim();
  const tagFilter = (filters?.tag || "ALL").trim();
  const sortBy = (filters?.sort || "recent").trim();
  const limit =
    filters?.limit && Number.isFinite(filters.limit) && filters.limit > 0
      ? Math.min(Math.floor(filters.limit), 5000)
      : 1000;

  const { whereSql, args } = buildContactsSqlWhere(filters);
  const hasSqlFilter = whereSql.length > 0;
  const sqlOrderBy = buildContactsSqlOrder(sortBy);

  const [
    filteredContactsRes,
    matchedCountRes,
    baseKpiRes,
    cachedMeta,
    logsRes,
    listsRes,
    allStaff,
  ] = await Promise.all([
    contactsDb.execute({
      sql: `SELECT * FROM contacts ${whereSql} ${sqlOrderBy} LIMIT ?`,
      args: [...args, limit],
    }),
    hasSqlFilter
      ? contactsDb.execute({
          sql: `SELECT COUNT(*) AS cnt FROM contacts ${whereSql}`,
          args,
        })
      : Promise.resolve(null),
    contactsDb.execute(
      `SELECT COUNT(*) AS total_contacts,
              COALESCE(SUM(CASE WHEN COALESCE(opt_in_marketing, 1) = 1 THEN 1 ELSE 0 END), 0) AS opted_in_count,
              COALESCE(SUM(CASE WHEN COALESCE(opt_in_marketing, 1) != 1 THEN 1 ELSE 0 END), 0) AS opted_out_count,
              COALESCE(SUM(CASE WHEN COALESCE(total_orders_count, 0) > 0 OR stage IN ('CUSTOMER', 'REPEAT_BUYER', 'VIP') THEN 1 ELSE 0 END), 0) AS customers_count,
              COALESCE(SUM(CASE WHEN stage IN ('REPEAT_BUYER', 'VIP') OR COALESCE(total_orders_count, 0) >= 2 THEN 1 ELSE 0 END), 0) AS repeat_vip_count,
              COALESCE(SUM(COALESCE(lifetime_value_inr, 0)), 0) AS total_ltv_inr
       FROM contacts`
    ),
    loadCachedContactsMeta(),
    contactsDb.execute(
      `SELECT id, source_label, imported_count, updated_count, skipped_count, imported_by_name, created_at
       FROM contact_import_logs
       ORDER BY created_at DESC
       LIMIT 10`
    ),
    mktDb.execute(
      `SELECT id, name, members_count FROM marketing_lists ORDER BY updated_at DESC`
    ),
    listActiveNonClientStaff(),
  ]);

  const matchedPhones = Array.from(
    new Set(
      filteredContactsRes.rows.map((r) => String(r.phone || "")).filter(Boolean)
    )
  );

  const nowMs = Date.now();
  const convByPhone = new Map<
    string,
    {
      id: string;
      status: string;
      unreadCount: number;
      lastMessageAt: string;
      windowOpen: boolean;
      assignedTo: string;
    }
  >();
  const msgCountByPhone = new Map<string, number>();
  const ordersByPhone = new Map<string, { count: number; ltv: number }>();

  if (matchedPhones.length > 0) {
    await Promise.all(
      chunkArray(matchedPhones, 400).map(async (phoneChunk) => {
        const placeholders = phoneChunk.map(() => "?").join(",");
        const [chunkConvRes, chunkMsgRes, chunkOrdersRes] = await Promise.all([
          convDb.execute({
            sql: `SELECT id, customer_phone, status, unread_count, last_message_at, window_expires_at, assigned_staff_name, assigned_team_name
                  FROM conversations
                  WHERE customer_phone IN (${placeholders})`,
            args: phoneChunk,
          }),
          convDb.execute({
            sql: `SELECT c.customer_phone as phone, COUNT(m.id) as cnt
                  FROM conversations c
                  LEFT JOIN messages m ON m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
                  WHERE c.customer_phone IN (${placeholders})
                  GROUP BY c.customer_phone`,
            args: phoneChunk,
          }),
          crmDb.execute({
            sql: `SELECT customer_phone as phone, COUNT(*) as orders_cnt, COALESCE(SUM(total_amount_inr), 0) as total_inr
                  FROM customer_orders
                  WHERE customer_phone IN (${placeholders})
                  GROUP BY customer_phone`,
            args: phoneChunk,
          }),
        ]);

        for (const c of chunkConvRes.rows) {
          const ph = String(c.customer_phone || "");
          const exp = c.window_expires_at
            ? new Date(String(c.window_expires_at)).getTime()
            : 0;
          convByPhone.set(ph, {
            id: String(c.id),
            status: String(c.status),
            unreadCount: Number(c.unread_count ?? 0),
            lastMessageAt: String(c.last_message_at),
            windowOpen: exp > nowMs,
            assignedTo: String(
              c.assigned_staff_name || c.assigned_team_name || "System"
            ),
          });
        }
        for (const m of chunkMsgRes.rows) {
          msgCountByPhone.set(String(m.phone || ""), Number(m.cnt ?? 0));
        }
        for (const o of chunkOrdersRes.rows) {
          const ph = String(o.phone || "");
          if (!ph) continue;
          ordersByPhone.set(ph, {
            count: Number(o.orders_cnt ?? 0),
            ltv: Number(o.total_inr ?? 0),
          });
        }
      })
    );
  }

  const baseKpi = (baseKpiRes.rows[0] || {}) as Record<string, unknown>;
  const totalContacts = Number(baseKpi.total_contacts ?? 0);
  const optedInCount = Number(baseKpi.opted_in_count ?? 0);
  const optedOutCount = Number(baseKpi.opted_out_count ?? 0);
  let customersCount = Number(baseKpi.customers_count ?? 0);
  let repeatAndVipCount = Number(baseKpi.repeat_vip_count ?? 0);
  let totalLifetimeValueInr = Number(baseKpi.total_ltv_inr ?? 0);

  for (const r of filteredContactsRes.rows) {
    const phone = String(r.phone || "");
    const ordAgg = ordersByPhone.get(phone);
    if (!ordAgg) continue;

    const stage = String(r.stage || "NEW_LEAD");
    const baseOrders = Number(r.total_orders_count ?? 0);
    const baseLtv = Number(r.lifetime_value_inr ?? 0);
    const maxOrders = Math.max(baseOrders, ordAgg.count);
    const isBuyerStage = ["CUSTOMER", "REPEAT_BUYER", "VIP"].includes(stage);

    if (!(baseOrders > 0 || isBuyerStage) && (maxOrders > 0 || isBuyerStage)) {
      customersCount++;
    }
    if (
      !(stage === "REPEAT_BUYER" || stage === "VIP" || baseOrders >= 2) &&
      (stage === "REPEAT_BUYER" || stage === "VIP" || maxOrders >= 2)
    ) {
      repeatAndVipCount++;
    }
    if (ordAgg.ltv > baseLtv) {
      totalLifetimeValueInr += ordAgg.ltv - baseLtv;
    }
  }

  const { withActiveChatCount, groups, allTags } = cachedMeta;

  const mappedContacts = filteredContactsRes.rows.map((r) => {
    const phone = String(r.phone);
    const tags = parseJsonArray(r.tags_json);
    const groups = parseJsonArray(r.groups_json);
    const convInfo = convByPhone.get(phone) || null;
    const ordAgg = ordersByPhone.get(phone);

    const totalOrdersCount = Math.max(
      Number(r.total_orders_count ?? 0),
      ordAgg?.count ?? 0
    );
    const lifetimeValueInr = Math.max(
      Number(r.lifetime_value_inr ?? 0),
      ordAgg?.ltv ?? 0
    );
    const totalMessagesCount = Math.max(
      Number(r.total_messages_count ?? 0),
      msgCountByPhone.get(phone) ?? 0
    );
    const optInMarketing = Number(r.opt_in_marketing ?? 1) === 1;
    const stage = String(r.stage || "NEW_LEAD");

    const lastContactedAt =
      convInfo?.lastMessageAt &&
      (!r.last_contacted_at || convInfo.lastMessageAt > String(r.last_contacted_at))
        ? convInfo.lastMessageAt
        : r.last_contacted_at
        ? String(r.last_contacted_at)
        : String(r.updated_at);

    return {
      id: String(r.id),
      phone,
      whatsappName: String(r.whatsapp_name || ""),
      name: String(r.name || phone),
      email: String(r.email || ""),
      companyName: String(r.company_name || ""),
      designation: String(r.designation || ""),
      organizationType: String(r.organization_type || "Business"),
      city: String(r.city || ""),
      state: String(r.state || ""),
      country: String(r.country || "India"),
      gstNumber: String(r.gst_number || ""),
      source: String(r.source || "MANUAL"),
      stage,
      acrioSegment: String(r.acrio_segment || "Active Prospect"),
      tags,
      groups,
      optInMarketing,
      optOutReason: String(r.opt_out_reason || ""),
      assignedOwnerName: String(r.assigned_owner_name || convInfo?.assignedTo || ""),
      preferredStaffId: r.preferred_staff_id
        ? String(r.preferred_staff_id)
        : r.assigned_owner_id
        ? String(r.assigned_owner_id)
        : null,
      preferredStaffName: String(
        r.preferred_staff_name || r.assigned_owner_name || ""
      ),
      lifetimeValueInr,
      totalOrdersCount,
      totalMessagesCount,
      notes: String(r.notes || ""),
      lastContactedAt,
      createdAt: String(r.created_at),
      updatedAt: String(r.updated_at),
      conversationId: convInfo?.id || null,
      chatStatus: convInfo?.status || null,
      unreadCount: convInfo?.unreadCount ?? 0,
      windowOpen: convInfo?.windowOpen ?? false,
    };
  });

  // Final exact JS verification for JSON array filters (groupId/tag) & BUYERS_ALL with ordersAggRes
  let filtered = mappedContacts.filter((c) => {
    if (stageFilter === "BUYERS_ALL") {
      if (
        c.totalOrdersCount === 0 &&
        !["CUSTOMER", "REPEAT_BUYER", "VIP"].includes(c.stage)
      ) {
        return false;
      }
    } else if (stageFilter !== "ALL" && c.stage !== stageFilter) {
      return false;
    }
    if (optInFilter === "OPTED_IN" && !c.optInMarketing) return false;
    if (optInFilter === "OPTED_OUT" && c.optInMarketing) return false;
    if (orgFilter !== "ALL" && c.organizationType !== orgFilter) return false;
    if (sourceFilter !== "ALL" && c.source !== sourceFilter) return false;
    if (groupFilter !== "ALL" && !c.groups.includes(groupFilter)) return false;
    if (tagFilter !== "ALL" && !c.tags.includes(tagFilter)) return false;
    if (q) {
      const hay = [
        c.name,
        c.whatsappName,
        c.phone,
        c.email,
        c.companyName,
        c.designation,
        c.organizationType,
        c.city,
        c.state,
        c.gstNumber,
        c.acrioSegment,
        c.notes,
        ...c.tags,
      ]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "ltv") return b.lifetimeValueInr - a.lifetimeValueInr;
    if (sortBy === "orders") return b.totalOrdersCount - a.totalOrdersCount;
    if (sortBy === "created") return b.createdAt.localeCompare(a.createdAt);
    return (b.lastContactedAt || "").localeCompare(a.lastContactedAt || "");
  });

  const sqlMatchedCount = matchedCountRes
    ? Number(matchedCountRes.rows[0]?.cnt ?? filtered.length)
    : totalContacts;
  const totalCount =
    filteredContactsRes.rows.length < limit ? filtered.length : sqlMatchedCount;

  return {
    ok: true as const,
    permissions: {
      canManage: hasPermission(user.role, "contacts:manage", user.status),
      canDelete: hasPermission(user.role, "contacts:delete", user.status),
      canManageLists: hasPermission(user.role, "marketing:manage_lists", user.status),
    },
    totalCount,
    kpis: {
      totalContacts,
      optedInCount,
      optedOutCount,
      optInRatePct:
        totalContacts > 0 ? Math.round((optedInCount / totalContacts) * 100) : 0,
      customersCount,
      repeatAndVipCount,
      totalLifetimeValueInr,
      withActiveChatCount,
    },
    groups,
    allTags,
    marketingLists: listsRes.rows.map((l) => ({
      id: String(l.id),
      name: String(l.name),
      membersCount: Number(l.members_count ?? 0),
    })),
    importLogs: logsRes.rows.map((l) => ({
      id: String(l.id),
      sourceLabel: String(l.source_label),
      importedCount: Number(l.imported_count ?? 0),
      updatedCount: Number(l.updated_count ?? 0),
      skippedCount: Number(l.skipped_count ?? 0),
      importedByName: String(l.imported_by_name),
      createdAt: String(l.created_at),
    })),
    staffList: allStaff.filter((s) => s.role !== "DEV" || user.role === "DEV"),
    contacts: filtered,
  };
}
