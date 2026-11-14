import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  fetchAllEcosystemWebsiteEnquiries,
  fetchWebsiteEnquiriesForCustomer,
  getRawLibSqlClient,
  normalizeWhatsAppPhone,
  upsertSyncedContact,
} from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { logConversationAssignment } from "@cc/workers";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

function parseJsonArray(raw: unknown): string[] {
  try {
    const parsed = JSON.parse(String(raw || "[]"));
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "contacts:view", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Active staff access required to view Contacts Database." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();

  const url = new URL(req.url);
  const contactId = (url.searchParams.get("contactId") || "").trim();

  const contactsDb = getRawLibSqlClient("contacts");
  const convDb = getRawLibSqlClient("conversations");
  const crmDb = getRawLibSqlClient("crm_orders");
  const mktDb = getRawLibSqlClient("marketing");

  // Single Contact 360 Drawer Fetch
  if (contactId) {
    const cRes = await contactsDb.execute({
      sql: `SELECT * FROM contacts WHERE id = ? LIMIT 1`,
      args: [contactId],
    });
    const row = cRes.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return NextResponse.json(
        { ok: false, error: "Contact not found." },
        { status: 404 }
      );
    }
    const phone = String(row.phone);
    const [ordersRes, relationsRes, convRes, webEnquiries] = await Promise.all([
      crmDb.execute({
        sql: `SELECT * FROM customer_orders WHERE customer_phone = ? ORDER BY ordered_at DESC LIMIT 20`,
        args: [phone],
      }),
      crmDb.execute({
        sql: `SELECT * FROM customer_relations WHERE customer_phone = ? ORDER BY occurred_at DESC LIMIT 20`,
        args: [phone],
      }),
      convDb.execute({
        sql: `SELECT id, status, assigned_staff_name, assigned_team_name, unread_count, last_message_preview, last_message_at, window_expires_at
              FROM conversations WHERE customer_phone = ? LIMIT 1`,
        args: [phone],
      }),
      fetchWebsiteEnquiriesForCustomer(phone),
    ]);

    const convRow = convRes.rows[0] as Record<string, unknown> | undefined;

    return NextResponse.json({
      ok: true,
      detail: {
        id: String(row.id),
        phone,
        whatsappName: String(row.whatsapp_name || ""),
        name: String(row.name || phone),
        email: String(row.email || ""),
        companyName: String(row.company_name || ""),
        designation: String(row.designation || ""),
        organizationType: String(row.organization_type || "Business"),
        city: String(row.city || ""),
        state: String(row.state || ""),
        country: String(row.country || "India"),
        gstNumber: String(row.gst_number || ""),
        source: String(row.source || "MANUAL"),
        stage: String(row.stage || "NEW_LEAD"),
        acrioSegment: String(row.acrio_segment || "Active Prospect"),
        tags: parseJsonArray(row.tags_json),
        groups: parseJsonArray(row.groups_json),
        optInMarketing: Number(row.opt_in_marketing ?? 1) === 1,
        optOutReason: String(row.opt_out_reason || ""),
        assignedOwnerId: row.assigned_owner_id ? String(row.assigned_owner_id) : null,
        assignedOwnerName: String(row.assigned_owner_name || ""),
        lifetimeValueInr: Number(row.lifetime_value_inr ?? 0),
        totalOrdersCount: Number(row.total_orders_count ?? 0),
        notes: String(row.notes || ""),
        lastContactedAt: row.last_contacted_at ? String(row.last_contacted_at) : null,
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        conversation: convRow
          ? {
              id: String(convRow.id),
              status: String(convRow.status),
              assignedTo: String(convRow.assigned_staff_name || convRow.assigned_team_name || "System"),
              unreadCount: Number(convRow.unread_count ?? 0),
              lastMessagePreview: String(convRow.last_message_preview || ""),
              lastMessageAt: String(convRow.last_message_at),
              windowExpiresAt: convRow.window_expires_at ? String(convRow.window_expires_at) : null,
            }
          : null,
        orders: ordersRes.rows.map((o) => ({
          id: String(o.id),
          orderNumber: String(o.order_number),
          itemsSummary: String(o.items_summary),
          quantity: Number(o.quantity ?? 1),
          totalAmountInr: Number(o.total_amount_inr ?? 0),
          paymentStatus: String(o.payment_status),
          fulfillmentStatus: String(o.fulfillment_status),
          orderedAt: String(o.ordered_at),
        })),
        relations: relationsRes.rows.map((rel) => ({
          id: String(rel.id),
          relationType: String(rel.relation_type),
          summary: String(rel.summary),
          handledBy: String(rel.handled_by),
          occurredAt: String(rel.occurred_at),
        })),
        websiteEnquiries: webEnquiries,
      },
    });
  }

  // Full Directory Listing + Filters + Live Chat Enrichment
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const stageFilter = (url.searchParams.get("stage") || "ALL").trim();
  const optInFilter = (url.searchParams.get("optIn") || "ALL").trim();
  const orgFilter = (url.searchParams.get("orgType") || "ALL").trim();
  const sourceFilter = (url.searchParams.get("source") || "ALL").trim();
  const groupFilter = (url.searchParams.get("groupId") || "ALL").trim();
  const tagFilter = (url.searchParams.get("tag") || "ALL").trim();
  const sortBy = (url.searchParams.get("sort") || "recent").trim();

  const [contactsRes, groupsRes, logsRes, convRes, msgCntRes, listsRes, ordersAggRes] =
    await Promise.all([
      contactsDb.execute(`SELECT * FROM contacts ORDER BY updated_at DESC`),
      contactsDb.execute(`SELECT * FROM contact_groups ORDER BY name ASC`),
      contactsDb.execute(`SELECT * FROM contact_import_logs ORDER BY created_at DESC LIMIT 10`),
      convDb.execute(
        `SELECT id, customer_phone, status, unread_count, last_message_at, window_expires_at, assigned_staff_name, assigned_team_name
         FROM conversations`
      ),
      convDb.execute(
        `SELECT c.customer_phone as phone, COUNT(m.id) as cnt
         FROM conversations c
         LEFT JOIN messages m ON m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
         GROUP BY c.customer_phone`
      ),
      mktDb.execute(`SELECT id, name, members_count FROM marketing_lists ORDER BY updated_at DESC`),
      crmDb.execute(
        `SELECT customer_phone as phone, COUNT(*) as orders_cnt, COALESCE(SUM(total_amount_inr), 0) as total_inr
         FROM customer_orders
         GROUP BY customer_phone`
      ),
    ]);

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
  for (const c of convRes.rows) {
    const ph = String(c.customer_phone || "");
    const exp = c.window_expires_at ? new Date(String(c.window_expires_at)).getTime() : 0;
    convByPhone.set(ph, {
      id: String(c.id),
      status: String(c.status),
      unreadCount: Number(c.unread_count ?? 0),
      lastMessageAt: String(c.last_message_at),
      windowOpen: exp > nowMs,
      assignedTo: String(c.assigned_staff_name || c.assigned_team_name || "System"),
    });
  }

  const msgCountByPhone = new Map<string, number>();
  for (const m of msgCntRes.rows) {
    msgCountByPhone.set(String(m.phone || ""), Number(m.cnt ?? 0));
  }

  const ordersByPhone = new Map<string, { count: number; ltv: number }>();
  for (const o of ordersAggRes.rows) {
    ordersByPhone.set(String(o.phone || ""), {
      count: Number(o.orders_cnt ?? 0),
      ltv: Number(o.total_inr ?? 0),
    });
  }

  const groupMemberCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();

  let optedInCount = 0;
  let optedOutCount = 0;
  let customersCount = 0;
  let repeatAndVipCount = 0;
  let totalLifetimeValueInr = 0;
  let withActiveChatCount = 0;

  const allContacts = contactsRes.rows.map((r) => {
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

    if (optInMarketing) optedInCount++;
    else optedOutCount++;

    if (totalOrdersCount > 0 || ["CUSTOMER", "REPEAT_BUYER", "VIP"].includes(stage)) {
      customersCount++;
    }
    if (stage === "REPEAT_BUYER" || stage === "VIP" || totalOrdersCount >= 2) {
      repeatAndVipCount++;
    }
    if (convInfo) withActiveChatCount++;
    totalLifetimeValueInr += lifetimeValueInr;

    for (const gid of groups) {
      groupMemberCounts.set(gid, (groupMemberCounts.get(gid) || 0) + 1);
    }
    for (const t of tags) {
      tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
    }

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

  // Apply filters
  let filtered = allContacts.filter((c) => {
    if (stageFilter !== "ALL") {
      if (stageFilter === "BUYERS_ALL") {
        if (
          c.totalOrdersCount === 0 &&
          !["CUSTOMER", "REPEAT_BUYER", "VIP"].includes(c.stage)
        ) {
          return false;
        }
      } else if (c.stage !== stageFilter) {
        return false;
      }
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

  // Apply sorting
  filtered = [...filtered].sort((a, b) => {
    if (sortBy === "name") return a.name.localeCompare(b.name);
    if (sortBy === "ltv") return b.lifetimeValueInr - a.lifetimeValueInr;
    if (sortBy === "orders") return b.totalOrdersCount - a.totalOrdersCount;
    if (sortBy === "created") return b.createdAt.localeCompare(a.createdAt);
    return (b.lastContactedAt || "").localeCompare(a.lastContactedAt || "");
  });

  return NextResponse.json({
    ok: true,
    permissions: {
      canManage: hasPermission(user.role, "contacts:manage", user.status),
      canDelete: hasPermission(user.role, "contacts:delete", user.status),
      canManageLists: hasPermission(user.role, "marketing:manage_lists", user.status),
    },
    kpis: {
      totalContacts: allContacts.length,
      optedInCount,
      optedOutCount,
      optInRatePct:
        allContacts.length > 0
          ? Math.round((optedInCount / allContacts.length) * 100)
          : 0,
      customersCount,
      repeatAndVipCount,
      totalLifetimeValueInr,
      withActiveChatCount,
    },
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
    contacts: filtered,
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "contacts:manage", user.status)) {
    return NextResponse.json(
      { ok: false, error: "Staff permission required to manage contacts." },
      { status: 403 }
    );
  }

  await ensureDatabasesBootstrapped();

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const contactsDb = getRawLibSqlClient("contacts");
  const crmDb = getRawLibSqlClient("crm_orders");
  const convDb = getRawLibSqlClient("conversations");
  const mktDb = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  // 1. Create or Update a Single Contact
  if (action === "upsert_contact") {
    const tags = Array.isArray(body.tags)
      ? body.tags.map(String)
      : typeof body.tags === "string"
      ? body.tags
          .split(",")
          .map((t: string) => t.trim())
          .filter(Boolean)
      : undefined;

    const groups = Array.isArray(body.groups)
      ? body.groups.map(String)
      : undefined;

    const res = await upsertSyncedContact({
      phone: String(body.phone || ""),
      name: body.name !== undefined ? String(body.name) : undefined,
      whatsappName: body.whatsappName !== undefined ? String(body.whatsappName) : undefined,
      email: body.email !== undefined ? String(body.email) : undefined,
      companyName: body.companyName !== undefined ? String(body.companyName) : undefined,
      designation: body.designation !== undefined ? String(body.designation) : undefined,
      organizationType:
        body.organizationType !== undefined ? String(body.organizationType) : undefined,
      city: body.city !== undefined ? String(body.city) : undefined,
      state: body.state !== undefined ? String(body.state) : undefined,
      country: body.country !== undefined ? String(body.country) : undefined,
      gstNumber: body.gstNumber !== undefined ? String(body.gstNumber) : undefined,
      source: body.source !== undefined ? String(body.source) : undefined,
      stage: body.stage !== undefined ? String(body.stage) : undefined,
      acrioSegment: body.acrioSegment !== undefined ? String(body.acrioSegment) : undefined,
      tags,
      groups,
      optInMarketing:
        body.optInMarketing !== undefined ? Boolean(body.optInMarketing) : undefined,
      optOutReason: body.optOutReason !== undefined ? String(body.optOutReason) : undefined,
      notes: body.notes !== undefined ? String(body.notes) : undefined,
    });

    if (!res.ok) {
      return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: res.id, phone: res.phone, isNew: res.isNew });
  }

  // 2. Bulk CSV / Excel Paste Import
  if (action === "bulk_import") {
    const rawText = String(body.csvText || "").trim();
    const defaultGroupId = String(body.groupId || "").trim();
    const defaultTag = String(body.defaultTag || "").trim();
    const sourceLabel = String(body.sourceLabel || "CSV / Bulk Paste Import").trim();

    if (!rawText) {
      return NextResponse.json(
        { ok: false, error: "Please paste or upload at least one contact row." },
        { status: 400 }
      );
    }

    const lines = rawText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No non-empty rows found in import input." },
        { status: 400 }
      );
    }

    const delimiter = lines[0].includes("\t")
      ? "\t"
      : lines[0].includes(";") && !lines[0].includes(",")
      ? ";"
      : ",";

    const firstRowCols = parseCsvLine(lines[0], delimiter).map((h) =>
      h.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    const hasHeader = firstRowCols.some((h) =>
      [
        "phone",
        "mobile",
        "whatsapp",
        "whatsappnumber",
        "phonenumber",
        "number",
        "name",
        "fullname",
        "customername",
      ].includes(h)
    );

    const findIdx = (candidates: string[]) =>
      firstRowCols.findIndex((c) => candidates.includes(c));

    const idxPhone = hasHeader
      ? findIdx([
          "phone",
          "mobile",
          "whatsapp",
          "whatsappnumber",
          "phonenumber",
          "contactnumber",
          "number",
        ])
      : -1;
    const idxName = hasHeader
      ? findIdx(["name", "fullname", "customername", "contactname", "person"])
      : -1;
    const idxCompany = hasHeader
      ? findIdx(["company", "companyname", "organization", "firm", "business"])
      : -1;
    const idxEmail = hasHeader ? findIdx(["email", "emailaddress", "mail"]) : -1;
    const idxCity = hasHeader ? findIdx(["city", "location", "town"]) : -1;
    const idxState = hasHeader ? findIdx(["state", "province", "region"]) : -1;
    const idxGst = hasHeader ? findIdx(["gst", "gstin", "gstnumber"]) : -1;
    const idxOrgType = hasHeader
      ? findIdx(["organizationtype", "orgtype", "type", "industry"])
      : -1;
    const idxStage = hasHeader ? findIdx(["stage", "status", "leadstage"]) : -1;
    const idxTags = hasHeader ? findIdx(["tags", "tag", "labels"]) : -1;
    const idxNotes = hasHeader ? findIdx(["notes", "note", "remarks", "comment"]) : -1;
    const idxOptIn = hasHeader ? findIdx(["optin", "optinmarketing", "marketing"]) : -1;

    const dataLines = hasHeader ? lines.slice(1) : lines;
    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const line of dataLines) {
      const cols = parseCsvLine(line, delimiter);
      let rawPhone = "";
      let rawName = "";

      if (hasHeader && idxPhone >= 0) {
        rawPhone = cols[idxPhone] || "";
        rawName = idxName >= 0 ? cols[idxName] || "" : "";
      } else if (cols.length === 1) {
        rawPhone = cols[0];
      } else {
        // Auto-detect whether column 0 or column 1 holds the phone number
        const c0Digits = (cols[0] || "").replace(/\D/g, "");
        const c1Digits = (cols[1] || "").replace(/\D/g, "");
        if (c0Digits.length >= 10 && c1Digits.length < 10) {
          rawPhone = cols[0];
          rawName = cols[1] || "";
        } else {
          rawName = cols[0] || "";
          rawPhone = cols[1] || "";
        }
      }

      const normPhone = normalizeWhatsAppPhone(rawPhone);
      if (!normPhone) {
        skippedCount++;
        continue;
      }

      // Merge tags & groups if existing
      const exRow = await contactsDb.execute({
        sql: `SELECT tags_json, groups_json FROM contacts WHERE phone = ? LIMIT 1`,
        args: [normPhone],
      });
      const prevTags = exRow.rows[0] ? parseJsonArray(exRow.rows[0].tags_json) : [];
      const prevGroups = exRow.rows[0] ? parseJsonArray(exRow.rows[0].groups_json) : [];

      const rowTags =
        hasHeader && idxTags >= 0 && cols[idxTags]
          ? cols[idxTags]
              .split(/[|;,]/)
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      if (defaultTag) rowTags.push(defaultTag);
      const mergedTags = Array.from(new Set([...prevTags, ...rowTags]));

      const mergedGroups = defaultGroupId
        ? Array.from(new Set([...prevGroups, defaultGroupId]))
        : prevGroups;

      const optInRaw =
        hasHeader && idxOptIn >= 0 ? (cols[idxOptIn] || "").toLowerCase() : "";
      const optInVal =
        optInRaw === "0" || optInRaw === "false" || optInRaw === "no" || optInRaw === "optout"
          ? false
          : undefined;

      const upRes = await upsertSyncedContact({
        phone: normPhone,
        name: rawName || undefined,
        companyName:
          hasHeader && idxCompany >= 0 && cols[idxCompany]
            ? cols[idxCompany]
            : !hasHeader && cols[2]
            ? cols[2]
            : undefined,
        email:
          hasHeader && idxEmail >= 0 && cols[idxEmail]
            ? cols[idxEmail]
            : !hasHeader && cols[3] && cols[3].includes("@")
            ? cols[3]
            : undefined,
        city:
          hasHeader && idxCity >= 0 && cols[idxCity]
            ? cols[idxCity]
            : !hasHeader && cols[4]
            ? cols[4]
            : undefined,
        state: hasHeader && idxState >= 0 && cols[idxState] ? cols[idxState] : undefined,
        gstNumber: hasHeader && idxGst >= 0 && cols[idxGst] ? cols[idxGst] : undefined,
        organizationType:
          hasHeader && idxOrgType >= 0 && cols[idxOrgType] ? cols[idxOrgType] : undefined,
        stage:
          hasHeader && idxStage >= 0 && cols[idxStage]
            ? cols[idxStage].toUpperCase().replace(/\s+/g, "_")
            : undefined,
        notes: hasHeader && idxNotes >= 0 && cols[idxNotes] ? cols[idxNotes] : undefined,
        optInMarketing: optInVal,
        tags: mergedTags,
        groups: mergedGroups,
        source: "CSV_IMPORT",
      });

      if (upRes.ok) {
        if (upRes.isNew) importedCount++;
        else updatedCount++;
      } else {
        skippedCount++;
      }
    }

    await contactsDb.execute({
      sql: `INSERT INTO contact_import_logs (
        id, source_label, imported_count, updated_count, skipped_count, imported_by_name, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `imp_${crypto.randomUUID().slice(0, 8)}`,
        sourceLabel,
        importedCount,
        updatedCount,
        skippedCount,
        user.name,
        nowIso,
      ],
    });

    return NextResponse.json({
      ok: true,
      importedCount,
      updatedCount,
      skippedCount,
    });
  }

  // 3. Sync Contacts from Chats, CRM Orders & Website Enquiries
  if (action === "sync_sources") {
    const [convRows, crmRows, webEnquiries] = await Promise.all([
      convDb.execute(`SELECT * FROM conversations`),
      crmDb.execute(`SELECT * FROM customers`),
      fetchAllEcosystemWebsiteEnquiries(500),
    ]);

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const c of crmRows.rows) {
      const r = await upsertSyncedContact({
        phone: String(c.phone || ""),
        name: String(c.name || ""),
        email: c.email ? String(c.email) : undefined,
        companyName: c.company_name ? String(c.company_name) : undefined,
        organizationType: c.organization_type ? String(c.organization_type) : undefined,
        city: c.city ? String(c.city) : undefined,
        gstNumber: c.gst_number ? String(c.gst_number) : undefined,
        acrioSegment: c.acrio_segment ? String(c.acrio_segment) : undefined,
        optInMarketing: Number(c.opt_in_marketing ?? 1) === 1,
        lifetimeValueInr: Number(c.lifetime_value_inr ?? 0),
        totalOrdersCount: Number(c.total_orders_count ?? 0),
        notes: c.notes ? String(c.notes) : undefined,
      });
      if (r.ok) {
        if (r.isNew) importedCount++;
        else updatedCount++;
      } else skippedCount++;
    }

    for (const cv of convRows.rows) {
      const r = await upsertSyncedContact({
        phone: String(cv.customer_phone || ""),
        name: String(cv.customer_name || ""),
        whatsappName: String(cv.customer_name || ""),
        source: "WHATSAPP_INBOUND",
        lastContactedAt: String(cv.last_message_at || nowIso),
      });
      if (r.ok) {
        if (r.isNew) importedCount++;
        else updatedCount++;
      } else skippedCount++;
    }

    for (const eq of webEnquiries) {
      const isEdge = eq.source.includes("classicedge53");
      const r = await upsertSyncedContact({
        phone: eq.phone,
        name: eq.name || undefined,
        email: eq.email || undefined,
        source: "WEBSITE_ENQUIRY",
        acrioSegment: isEdge ? "Classic Edge 53 Machine Lead" : "Website Product Lead",
        groups: isEdge ? ["grp_machines"] : undefined,
        notes: eq.message ? `Website enquiry (${eq.source}): ${eq.message.slice(0, 220)}` : undefined,
        lastContactedAt: eq.createdAt || nowIso,
      });
      if (r.ok) {
        if (r.isNew) importedCount++;
        else updatedCount++;
      } else skippedCount++;
    }

    await contactsDb.execute({
      sql: `INSERT INTO contact_import_logs (
        id, source_label, imported_count, updated_count, skipped_count, imported_by_name, created_at
      ) VALUES (?, 'Chats + CRM + Website Enquiries Sync', ?, ?, ?, ?, ?)`,
      args: [
        `imp_${crypto.randomUUID().slice(0, 8)}`,
        importedCount,
        updatedCount,
        skippedCount,
        user.name,
        nowIso,
      ],
    });

    return NextResponse.json({
      ok: true,
      importedCount,
      updatedCount,
      skippedCount,
      websiteEnquiriesScanned: webEnquiries.length,
    });
  }

  // 4. Create or Delete a Contact Group
  if (action === "create_group") {
    const name = String(body.name || "").trim();
    if (!name) {
      return NextResponse.json(
        { ok: false, error: "Group name is required." },
        { status: 400 }
      );
    }
    const id = `grp_${crypto.randomUUID().slice(0, 8)}`;
    await contactsDb.execute({
      sql: `INSERT INTO contact_groups (id, name, description, color, created_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET description = excluded.description, color = excluded.color, updated_at = excluded.updated_at`,
      args: [
        id,
        name,
        String(body.description || "").trim(),
        String(body.color || "emerald"),
        user.name,
        nowIso,
        nowIso,
      ],
    });
    return NextResponse.json({ ok: true, id });
  }

  if (action === "delete_group") {
    const groupId = String(body.groupId || "").trim();
    await contactsDb.execute({
      sql: `DELETE FROM contact_groups WHERE id = ?`,
      args: [groupId],
    });
    return NextResponse.json({ ok: true });
  }

  // 5. Multi-Select Bulk Actions (Tag, Stage, Opt-In/Out, Group, Broadcast List, Delete)
  if (action === "bulk_action") {
    const ids: string[] = Array.isArray(body.contactIds)
      ? body.contactIds.map(String).filter(Boolean)
      : [];
    const subAction = String(body.subAction || "");
    if (ids.length === 0) {
      return NextResponse.json(
        { ok: false, error: "Select at least one contact first." },
        { status: 400 }
      );
    }

    const placeholders = ids.map(() => "?").join(",");
    const selectedRes = await contactsDb.execute({
      sql: `SELECT * FROM contacts WHERE id IN (${placeholders})`,
      args: ids,
    });

    if (subAction === "delete") {
      if (!hasPermission(user.role, "contacts:delete", user.status)) {
        return NextResponse.json(
          { ok: false, error: "Admin or Manager permission required to delete contacts." },
          { status: 403 }
        );
      }
      const phones = selectedRes.rows.map((r) => String(r.phone));
      await contactsDb.execute({
        sql: `DELETE FROM contacts WHERE id IN (${placeholders})`,
        args: ids,
      });
      if (phones.length > 0) {
        const phMarks = phones.map(() => "?").join(",");
        await crmDb.execute({
          sql: `DELETE FROM customers WHERE phone IN (${phMarks})`,
          args: phones,
        });
      }
      return NextResponse.json({ ok: true, affected: selectedRes.rows.length });
    }

    if (subAction === "push_to_marketing_list") {
      if (!hasPermission(user.role, "marketing:manage_lists", user.status)) {
        return NextResponse.json(
          { ok: false, error: "Admin or Manager permission required to manage broadcast lists." },
          { status: 403 }
        );
      }
      const optedInPhones = selectedRes.rows
        .filter((r) => Number(r.opt_in_marketing ?? 1) === 1)
        .map((r) => String(r.phone));

      if (optedInPhones.length === 0) {
        return NextResponse.json(
          { ok: false, error: "None of the selected contacts are opted in for broadcasts." },
          { status: 400 }
        );
      }

      const targetListId = String(body.listId || "").trim();
      if (targetListId && targetListId !== "NEW") {
        const lRes = await mktDb.execute({
          sql: `SELECT member_phones_json FROM marketing_lists WHERE id = ? LIMIT 1`,
          args: [targetListId],
        });
        const existingPhones = lRes.rows[0]
          ? parseJsonArray(lRes.rows[0].member_phones_json)
          : [];
        const merged = Array.from(new Set([...existingPhones, ...optedInPhones]));
        await mktDb.execute({
          sql: `UPDATE marketing_lists SET member_phones_json = ?, members_count = ?, updated_at = ? WHERE id = ?`,
          args: [JSON.stringify(merged), merged.length, nowIso, targetListId],
        });
        return NextResponse.json({ ok: true, listId: targetListId, membersCount: merged.length });
      } else {
        const newListName =
          String(body.newListName || "").trim() ||
          `Contacts Selection (${new Date().toLocaleDateString("en-IN")})`;
        const newId = `lst_${crypto.randomUUID().slice(0, 8)}`;
        await mktDb.execute({
          sql: `INSERT INTO marketing_lists (
            id, name, description, source_type, member_phones_json, members_count, created_by_name, updated_at, created_at
          ) VALUES (?, ?, 'Created from Contacts Database selection', 'MANUAL', ?, ?, ?, ?, ?)`,
          args: [
            newId,
            newListName,
            JSON.stringify(optedInPhones),
            optedInPhones.length,
            user.name,
            nowIso,
            nowIso,
          ],
        });
        return NextResponse.json({
          ok: true,
          listId: newId,
          membersCount: optedInPhones.length,
        });
      }
    }

    // Per-contact bulk updates (tag, stage, opt-in, group)
    for (const row of selectedRes.rows) {
      const phone = String(row.phone);
      const curTags = parseJsonArray(row.tags_json);
      const curGroups = parseJsonArray(row.groups_json);

      if (subAction === "add_tag") {
        const tag = String(body.tag || "").trim();
        if (tag) {
          await upsertSyncedContact({
            phone,
            tags: Array.from(new Set([...curTags, tag])),
          });
        }
      } else if (subAction === "set_stage") {
        const stage = String(body.stage || "QUALIFIED").trim();
        await upsertSyncedContact({ phone, stage });
      } else if (subAction === "set_opt_in") {
        const optIn = Boolean(body.optIn);
        await upsertSyncedContact({
          phone,
          optInMarketing: optIn,
          optOutReason: optIn ? "" : String(body.reason || "Marked opted-out by staff"),
        });
      } else if (subAction === "add_to_group") {
        const gid = String(body.groupId || "").trim();
        if (gid) {
          await upsertSyncedContact({
            phone,
            groups: Array.from(new Set([...curGroups, gid])),
          });
        }
      } else if (subAction === "remove_from_group") {
        const gid = String(body.groupId || "").trim();
        if (gid) {
          await upsertSyncedContact({
            phone,
            groups: curGroups.filter((g) => g !== gid),
          });
        }
      }
    }

    return NextResponse.json({ ok: true, affected: selectedRes.rows.length });
  }

  // 6. Open or Initialize WhatsApp Chat Thread for a Contact
  if (action === "open_or_create_chat") {
    const phone = normalizeWhatsAppPhone(String(body.phone || ""));
    const contactName = String(body.name || phone).trim() || phone;
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "Invalid WhatsApp phone number." },
        { status: 400 }
      );
    }

    const existingConv = await convDb.execute({
      sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`,
      args: [phone],
    });
    if (existingConv.rows[0]) {
      return NextResponse.json({
        ok: true,
        conversationId: String(existingConv.rows[0].id),
      });
    }

    const custRes = await crmDb.execute({
      sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
      args: [phone],
    });
    const custId = custRes.rows[0]
      ? String(custRes.rows[0].id)
      : `cust_${crypto.randomUUID().slice(0, 8)}`;

    const convId = `conv_${crypto.randomUUID().slice(0, 8)}`;
    await convDb.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, customer_id, status, priority, smart_category,
        assigned_staff_id, assigned_staff_name, assigned_team_id, assigned_team_name,
        escalation_level, waiting_since, unread_count, last_message_preview, last_message_at, created_at
      ) VALUES (?, ?, ?, ?, 'ASSIGNED', 'NORMAL', 'General Enquiry', ?, ?, 'team_sales', 'Sales Team', 'P0', NULL, 0, 'Opened from Contacts Database', ?, ?)`,
      args: [convId, phone, contactName, custId, user.id, user.name, nowIso, nowIso],
    });

    await logConversationAssignment({
      conversationId: convId,
      customerPhone: phone,
      customerName: contactName,
      toStaffId: user.id,
      toStaffName: user.name,
      toTeamId: "team_sales",
      toTeamName: "Sales Team",
      escalationLevel: "P0",
      assignmentSource: "OUTBOUND_START",
      assignedByName: user.name,
      reason: `Chat opened from Contacts Database by ${user.name}`,
      assignedAt: nowIso,
    });

    return NextResponse.json({ ok: true, conversationId: convId });
  }

  return NextResponse.json(
    { ok: false, error: "Unsupported contacts action." },
    { status: 400 }
  );
}
