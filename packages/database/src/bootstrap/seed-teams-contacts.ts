import { getRawLibSqlClient } from "@cc/database/clients/handles";

export async function seedTeamsAssignmentsAndBackfillContacts(
  isoNow: string,
  shouldSeedDemoData: boolean
): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  const auth = getRawLibSqlClient("core_auth");
  const crm = getRawLibSqlClient("crm_orders");
  const contacts = getRawLibSqlClient("contacts");

  try {
    await conv.execute(
      `UPDATE conversations
       SET last_message_direction = (
             SELECT m.direction FROM messages m
             WHERE m.conversation_id = conversations.id
               AND m.direction IN ('INBOUND', 'OUTBOUND')
             ORDER BY m.created_at DESC, m.rowid DESC
             LIMIT 1
           ),
           last_message_status = (
             SELECT m.delivery_status FROM messages m
             WHERE m.conversation_id = conversations.id
               AND m.direction IN ('INBOUND', 'OUTBOUND')
             ORDER BY m.created_at DESC, m.rowid DESC
             LIMIT 1
           )
       WHERE last_message_direction IS NULL`
    );
  } catch {
    // Non-blocking backfill
  }

  const existingTeams = await conv.execute(`SELECT COUNT(*) as cnt FROM teams`);
  if (Number(existingTeams.rows[0]?.cnt ?? 0) === 0) {
    await conv.batch(
      [
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_sales",
            "Sales Team",
            "Default handoff team from ACRIO. Handles acrylic podiums, trophies, awards, hotel stands, signage, and quotes.",
            "ALL",
            "podium,lectern,trophy,memento,award,hotel,banquet,stand,holder,box,price,quote,bulk",
            1,
            5,
            12,
            1,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_ce53_machines",
            "Classic Edge 53 Machines Team",
            "Handles CNC, diamond edge polishers, acrylic benders, heaters, and machine consumables.",
            "CLASSIC_EDGE_53",
            "machine, polisher, diamond, laser, router, bender, bending, heater, yn-jw, consumable, blade, classic edge",
            2,
            4,
            10,
            1,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_custom_fab",
            "Custom Fabrication Team",
            "Handles custom sizes, drawings, industrial safety guards, and special acrylic builds.",
            "CLASSIC_CONCEPTS",
            "custom, drawing, mm, inch, thickness, enclosure, guard, cover, fabrication",
            3,
            6,
            15,
            1,
            isoNow,
          ],
        },
        {
          sql: `INSERT INTO teams (
            id, name, description, brand_scope, routing_keywords, priority_rank, p0_wait_minutes, p1_wait_minutes, auto_assign_enabled, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            "team_support",
            "Orders & Dispatch Team",
            "Handles payment confirmation, GST invoices, courier tracking, and dispatch updates.",
            "ALL",
            "order, dispatch, courier, tracking, invoice, gst, payment, delivery",
            4,
            5,
            12,
            1,
            isoNow,
          ],
        },
      ],
      "write"
    );

    if (shouldSeedDemoData) {
      const activeUsersRes = await auth.execute(
        `SELECT id, name, email, role FROM users WHERE status = 'ACTIVE' ORDER BY created_at ASC`
      );
      const ensureDemoStaff = [
        {
          id: "usr_sales_p0",
          name: "Shiva Kumar Chernapally",
          email: "info@classicconcepts.in",
          phone: "+917337222878",
          role: "STAFF",
          dept: "Corporate Sales Manager",
        },
        {
          id: "usr_sales_p1",
          name: "Hussain Earanpurwala",
          email: "hussain@classicconcepts.in",
          phone: "+919849050752",
          role: "ADMIN",
          dept: "Director - Sales",
        },
        {
          id: "usr_ce53_p0",
          name: "Yusuf Zakir",
          email: "sales@classicconcepts.in",
          phone: "+919959362437",
          role: "STAFF",
          dept: "Director - Production & Machines",
        },
      ];
      for (const st of ensureDemoStaff) {
        const check = await auth.execute({
          sql: `SELECT id FROM users WHERE email = ? LIMIT 1`,
          args: [st.email],
        });
        if (check.rows.length === 0) {
          await auth.execute({
            sql: `INSERT INTO users (
              id, name, email, whatsapp_number, password_hash, role, status,
              department, email_verified_at, onboarding_completed_at, approved_by_name, approved_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, 'System', ?, ?)`,
            args: [
              st.id,
              st.name,
              st.email,
              st.phone,
              "$2b$10$CwTycUXWue0Thq9StjUM0uJ8h0R6V5G7y1p2zK6X8n4vZ1Q8m9W2a",
              st.role,
              st.dept,
              isoNow,
              isoNow,
              isoNow,
              isoNow,
            ],
          });
        }
      }

      const refreshedUsers = await auth.execute(
        `SELECT id, name, email, role FROM users WHERE status = 'ACTIVE' ORDER BY created_at ASC`
      );
      const activePool =
        refreshedUsers.rows.length > 0 ? refreshedUsers.rows : activeUsersRes.rows;
      const findByEmail = (em: string) =>
        activePool.find((u) => String(u.email) === em) || activePool[0];
      const leadUser =
        activePool.find(
          (u) => String(u.role) === "DEV" || String(u.role) === "SUPERADMIN"
        ) || activePool[0];

      const p0Sales = findByEmail("info@classicconcepts.in");
      const p1Sales = findByEmail("hussain@classicconcepts.in");
      const p0Machines = findByEmail("sales@classicconcepts.in");

      const memberSeeds: {
        id: string;
        teamId: string;
        user: Record<string, unknown> | undefined;
        tier: "P0" | "P1" | "P2";
      }[] = [
        { id: "tm_sales_p0", teamId: "team_sales", user: p0Sales, tier: "P0" },
        { id: "tm_sales_p1", teamId: "team_sales", user: p1Sales, tier: "P1" },
        { id: "tm_sales_p2", teamId: "team_sales", user: leadUser, tier: "P2" },
        { id: "tm_ce53_p0", teamId: "team_ce53_machines", user: p0Machines, tier: "P0" },
        { id: "tm_ce53_p1", teamId: "team_ce53_machines", user: p1Sales, tier: "P1" },
        { id: "tm_ce53_p2", teamId: "team_ce53_machines", user: leadUser, tier: "P2" },
        { id: "tm_fab_p0", teamId: "team_custom_fab", user: p1Sales, tier: "P0" },
        { id: "tm_fab_p1", teamId: "team_custom_fab", user: p0Sales, tier: "P1" },
        { id: "tm_fab_p2", teamId: "team_custom_fab", user: leadUser, tier: "P2" },
        { id: "tm_sup_p0", teamId: "team_support", user: p0Sales, tier: "P0" },
        { id: "tm_sup_p1", teamId: "team_support", user: p1Sales, tier: "P1" },
      ];

      for (const ms of memberSeeds) {
        if (!ms.user) continue;
        await conv.execute({
          sql: `INSERT INTO team_members (
            id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 15, 1, ?)`,
          args: [
            ms.id,
            ms.teamId,
            String(ms.user.id),
            String(ms.user.name),
            String(ms.user.email || ""),
            ms.tier,
            isoNow,
          ],
        });
      }
    }
  }

  await conv.execute(
    `UPDATE conversations
     SET assigned_staff_id = 'ACRIO',
         assigned_staff_name = 'ACRIO',
         assigned_team_name = 'System (ACRIO)'
     WHERE status = 'OPEN'
       AND (assigned_team_id IS NULL OR TRIM(assigned_team_id) = '')
       AND (assigned_staff_id IS NULL OR assigned_staff_id = 'ACRIO')`
  );
  await conv.execute(
    `UPDATE teams SET priority_rank = 1 WHERE id = 'team_sales' AND priority_rank > 1`
  );

  const activeNonDevUsers = await auth.execute(
    `SELECT id, name, email, department, role FROM users
     WHERE status = 'ACTIVE' AND role NOT IN ('DEV', 'CLIENT')`
  );
  for (const u of activeNonDevUsers.rows) {
    const uid = String(u.id);
    const existingMembership = await conv.execute({
      sql: `SELECT id FROM team_members WHERE staff_id = ? LIMIT 1`,
      args: [uid],
    });
    if (existingMembership.rows.length === 0) {
      const deptLower = String(u.department || "").toLowerCase();
      const targetTeamId =
        deptLower.includes("machine") || deptLower.includes("edge")
          ? "team_ce53_machines"
          : deptLower.includes("custom") || deptLower.includes("fab")
          ? "team_custom_fab"
          : deptLower.includes("dispatch") || deptLower.includes("order")
          ? "team_support"
          : "team_sales";
      const tier = String(u.role) === "SUPERADMIN" ? "P2" : String(u.role) === "MANAGER" || String(u.role) === "ADMIN" ? "P1" : "P0";
      await conv.execute({
        sql: `INSERT OR IGNORE INTO team_members (
          id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, email_alerts_enabled, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 15, 1, 1, ?)`,
        args: [
          `tm_auto_${uid}`,
          targetTeamId,
          uid,
          String(u.name || ""),
          String(u.email || ""),
          tier,
          isoNow,
        ],
      });
    }
  }

  await conv.execute(`
    UPDATE messages
    SET delivery_status = 'READ'
    WHERE direction = 'OUTBOUND'
      AND delivery_status IN ('SENDING', 'SENT', 'DELIVERED')
      AND EXISTS (
        SELECT 1
        FROM messages m2
        WHERE m2.conversation_id = messages.conversation_id
          AND m2.direction = 'INBOUND'
          AND m2.created_at > messages.created_at
      )
  `);

  const missingAssignConvs = await conv.execute(`
    SELECT *
    FROM conversations c
    WHERE NOT EXISTS (
      SELECT 1 FROM conversation_assignments ca WHERE ca.conversation_id = c.id
    )
  `);

  for (const c of missingAssignConvs.rows) {
    const cid = String(c.id);
    const custPhone = String(c.customer_phone || "");
    const custName = String(c.customer_name || "");
    const convStatus = String(c.status || "OPEN");
    const createdAt = String(c.created_at || new Date().toISOString());
    const toStaffId = c.assigned_staff_id ? String(c.assigned_staff_id) : "ACRIO";
    const toStaffName = c.assigned_staff_name
      ? String(c.assigned_staff_name)
      : toStaffId === "ACRIO"
      ? "ACRIO"
      : "Sales Desk";
    const toTeamId = c.assigned_team_id
      ? String(c.assigned_team_id)
      : toStaffId === "ACRIO"
      ? null
      : "team_sales";
    const toTeamName = c.assigned_team_name
      ? String(c.assigned_team_name)
      : toStaffId === "ACRIO"
      ? "System (ACRIO)"
      : "Sales Team";
    const tier = String(c.escalation_level || "P0");

    const firstOutRes = await conv.execute({
      sql: `SELECT id, sender_name, created_at
            FROM messages
            WHERE conversation_id = ? AND direction = 'OUTBOUND'
            ORDER BY created_at ASC
            LIMIT 1`,
      args: [cid],
    });
    const firstOut = firstOutRes.rows[0];
    const firstRespAt = firstOut ? String(firstOut.created_at) : null;
    const firstRespMsgId = firstOut ? String(firstOut.id) : null;

    let firstRespSec: number | null =
      c.last_response_seconds !== null && c.last_response_seconds !== undefined
        ? Number(c.last_response_seconds)
        : null;
    if (firstRespSec === null && firstRespAt) {
      const diff = Math.round(
        (new Date(firstRespAt).getTime() - new Date(createdAt).getTime()) / 1000
      );
      firstRespSec = Number.isNaN(diff) ? 45 : Math.max(8, diff);
    }

    const assignId = `asg_init_${cid}`;
    const outcome = firstRespAt
      ? "RESPONDED"
      : convStatus === "RESOLVED"
      ? "RESOLVED"
      : "ACTIVE";
    const endedAt =
      convStatus === "RESOLVED"
        ? String(c.resolved_at || c.last_message_at || createdAt)
        : null;
    const source =
      toStaffId === "ACRIO" ? "INITIAL_SYSTEM" : "SMART_ASSIGN";

    await conv.execute({
      sql: `INSERT OR IGNORE INTO conversation_assignments (
        id, conversation_id, customer_phone, customer_name,
        from_staff_id, from_staff_name, from_team_name,
        to_staff_id, to_staff_name, to_team_id, to_team_name,
        escalation_level, assignment_source, assigned_by_name, reason,
        assigned_at, first_response_at, first_response_seconds, first_response_message_id,
        ended_at, outcome
      ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, 'System', 'Initial chat assignment', ?, ?, ?, ?, ?, ?)`,
      args: [
        assignId,
        cid,
        custPhone,
        custName,
        toStaffId,
        toStaffName,
        toTeamId,
        toTeamName,
        tier,
        source,
        createdAt,
        firstRespAt,
        firstRespSec,
        firstRespMsgId,
        endedAt,
        outcome,
      ],
    });

    const existingEventMsg = await conv.execute({
      sql: `SELECT id FROM messages WHERE conversation_id = ? AND message_type = 'ASSIGNMENT_EVENT' LIMIT 1`,
      args: [cid],
    });
    if (existingEventMsg.rows.length === 0) {
      const summaryText =
        toStaffId === "ACRIO"
          ? "Chat assigned to System (ACRIO) for automatic backend handling."
          : `Chat assigned to ${toTeamName} (${tier}: ${toStaffName}).`;
      const meta = {
        assignmentId: assignId,
        toStaffId,
        toStaffName,
        toTeamId,
        toTeamName,
        escalationLevel: tier,
        assignmentSource: source,
        assignedByName: "System",
        assignedAt: createdAt,
        firstResponseAt: firstRespAt,
        firstResponseSeconds: firstRespSec,
        firstResponderName: firstOut ? String(firstOut.sender_name) : null,
        outcome,
      };
      await conv.execute({
        sql: `INSERT OR IGNORE INTO messages (
          id, conversation_id, direction, sender_type, sender_name, message_type,
          billing_category, body, metadata_json, delivery_status, created_at
        ) VALUES (?, ?, 'INTERNAL', 'SYSTEM_EVENT', 'Assignment Tracker', 'ASSIGNMENT_EVENT', 'INTERNAL', ?, ?, 'SAVED', ?)`,
        args: [
          `msg_asg_${cid}`,
          cid,
          summaryText,
          JSON.stringify(meta),
          createdAt,
        ],
      });
    }
  }

  const bootNowIso = new Date().toISOString();
  const starterGroups = [
    {
      id: "grp_vip",
      name: "VIP & Repeat Buyers",
      description: "High-value repeat corporate, hotel, and institutional buyers",
      color: "amber",
    },
    {
      id: "grp_edu",
      name: "Schools & Universities",
      description: "Colleges, universities, and auditorium podium buyers",
      color: "blue",
    },
    {
      id: "grp_corp",
      name: "Corporate & Hospitality",
      description: "Hotels, event halls, offices, and retail signage buyers",
      color: "emerald",
    },
    {
      id: "grp_machines",
      name: "Classic Edge 53 Machine Leads",
      description: "Fabricators & signage shops interested in diamond polishers & benders",
      color: "purple",
    },
  ];
  for (const g of starterGroups) {
    await contacts.execute({
      sql: `INSERT OR IGNORE INTO contact_groups (id, name, description, color, created_by_name, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'System', ?, ?)`,
      args: [g.id, g.name, g.description, g.color, bootNowIso, bootNowIso],
    });
  }

  const [allCrmCusts, allConvRows, msgCountRows] = await Promise.all([
    crm.execute(`SELECT * FROM customers`),
    conv.execute(`SELECT * FROM conversations`),
    conv.execute(
      `SELECT c.customer_phone as phone, COUNT(m.id) as cnt
       FROM conversations c
       LEFT JOIN messages m ON m.conversation_id = c.id AND m.direction IN ('INBOUND', 'OUTBOUND')
       GROUP BY c.customer_phone`
    ),
  ]);

  const msgCountByPhone = new Map<string, number>();
  for (const r of msgCountRows.rows) {
    msgCountByPhone.set(String(r.phone || ""), Number(r.cnt ?? 0));
  }

  const convByPhone = new Map<string, Record<string, unknown>>();
  for (const r of allConvRows.rows) {
    convByPhone.set(String(r.customer_phone || ""), r as Record<string, unknown>);
  }

  for (const c of allCrmCusts.rows) {
    const phone = String(c.phone || "").trim();
    if (!phone) continue;
    const convRow = convByPhone.get(phone);
    const ltv = Number(c.lifetime_value_inr ?? 0);
    const orders = Number(c.total_orders_count ?? 0);
    const orgType = String(c.organization_type || "Business");
    const inferredStage =
      ltv >= 50000 || orders >= 3
        ? "VIP"
        : orders >= 2
        ? "REPEAT_BUYER"
        : orders >= 1
        ? "CUSTOMER"
        : convRow
        ? "QUALIFIED"
        : "NEW_LEAD";

    const autoGroups: string[] = [];
    if (inferredStage === "VIP" || inferredStage === "REPEAT_BUYER") {
      autoGroups.push("grp_vip");
    }
    if (/school|college|univ|educat|instit/i.test(orgType + " " + String(c.company_name || ""))) {
      autoGroups.push("grp_edu");
    } else if (/hotel|corp|hospitality|business|event/i.test(orgType)) {
      autoGroups.push("grp_corp");
    }
    if (/machine|polisher|bender|edge/i.test(String(c.tags_json || "") + " " + String(c.notes || ""))) {
      autoGroups.push("grp_machines");
    }

    await contacts.execute({
      sql: `INSERT OR IGNORE INTO contacts (
        id, phone, whatsapp_name, name, email, company_name, designation,
        organization_type, city, state, country, gst_number, source, stage,
        acrio_segment, tags_json, groups_json, opt_in_marketing, opt_out_reason,
        assigned_owner_id, assigned_owner_name, lifetime_value_inr, total_orders_count,
        total_messages_count, notes, last_contacted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, '', 'India', ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `cnt_${String(c.id).replace(/^cust_/, "")}`,
        phone,
        convRow ? String(convRow.customer_name || "") : "",
        String(c.name || phone),
        String(c.email || ""),
        String(c.company_name || ""),
        orgType,
        String(c.city || ""),
        String(c.gst_number || ""),
        orders > 0 ? "ORDER" : convRow ? "WHATSAPP_INBOUND" : "MANUAL",
        inferredStage,
        String(c.acrio_segment || "Active Prospect"),
        String(c.tags_json || "[]"),
        JSON.stringify(autoGroups),
        Number(c.opt_in_marketing ?? 1),
        convRow?.assigned_staff_id && String(convRow.assigned_staff_id) !== "ACRIO"
          ? String(convRow.assigned_staff_id)
          : null,
        convRow?.assigned_staff_name && String(convRow.assigned_staff_name) !== "ACRIO"
          ? String(convRow.assigned_staff_name)
          : "",
        ltv,
        orders,
        msgCountByPhone.get(phone) ?? 0,
        String(c.notes || ""),
        String(c.last_interaction_at || bootNowIso),
        String(c.created_at || bootNowIso),
        String(c.last_interaction_at || bootNowIso),
      ],
    });
  }

  for (const r of allConvRows.rows) {
    const phone = String(r.customer_phone || "").trim();
    if (!phone) continue;
    await contacts.execute({
      sql: `INSERT OR IGNORE INTO contacts (
        id, phone, whatsapp_name, name, organization_type, source, stage,
        acrio_segment, tags_json, opt_in_marketing, total_messages_count,
        last_contacted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Business', 'WHATSAPP_INBOUND', 'NEW_LEAD', ?, ?, 1, ?, ?, ?, ?)`,
      args: [
        `cnt_${String(r.id).replace(/^conv_/, "")}`,
        phone,
        String(r.customer_name || phone),
        String(r.customer_name || phone),
        String(r.smart_category || "Active Prospect"),
        String(r.tags_json || "[]"),
        msgCountByPhone.get(phone) ?? 0,
        String(r.last_message_at || bootNowIso),
        String(r.created_at || bootNowIso),
        String(r.last_message_at || bootNowIso),
      ],
    });
  }

  await auth
    .execute(
      `DELETE FROM users WHERE email IN ('priya.menon@classiconcepts.in', 'rohan.kulkarni@classiconcepts.in', 'ananya.deshmukh@classiconcepts.in', 'karthik.nair@classiconcepts.in')`
    )
    .catch(() => {});
  await conv
    .execute(
      `DELETE FROM team_members WHERE staff_email IN ('priya.menon@classiconcepts.in', 'rohan.kulkarni@classiconcepts.in', 'ananya.deshmukh@classiconcepts.in', 'karthik.nair@classiconcepts.in')`
    )
    .catch(() => {});
}
