import { formatInTimeZone } from "date-fns-tz";
import {
  computePerformanceRankedStaff,
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveStaffMemberByQuery,
} from "@cc/database";
import {
  ensureLeadForwardsTable,
  loadDeskStaff,
  loadWindowStates,
  windowFor,
} from "./desk-data";
import { fmtTime, suffix10, todayStartIso, TZ } from "./types";

function normalizeOwnerText(raw: string): string {
  let t = String(raw || "").trim().toLowerCase();
  t = t.replace(/^@?acrio[\s,:-]+/, "");
  t = t.replace(/^(?:please|pls|plz|kindly|sir|hey|hi)[\s,]+/, "");
  t = t.replace(/^(?:show|give|send|tell|get|check|list|display|what(?:'s| is)|whats|how many|how(?:'s| is))\s+(?:me\s+)?(?:the\s+|all\s+|today'?s?\s+)?/, "");
  t = t.replace(/[?.!]+$/g, "").trim();
  return t;
}

const OWNER_HELP = [
  "*Owner commands, sir*",
  "",
  "*Leads*",
  "• Paste an enquiry, then say *please assign to <name>* or *please assign*",
  "• *leads* : leads forwarded today",
  "",
  "*Desk*",
  "• *summary* : open chats, waiting, callbacks, orders",
  "• *waiting* : customers waiting longest",
  "• *unassigned* : chats still with ACRIO",
  "• *team* : who has said hi today and who is locked",
  "• *workload* : open chats per staff",
  "• *chats of <name>* : one person's open chats",
  "• *performance* : top staff by resolved chats and speed",
  "",
  "*Business*",
  "• *callbacks* : pending callbacks and call queue",
  "• *enquiries* : website enquiries",
  "• *orders* : orders and revenue",
  "• *billing* : WhatsApp message charges",
  "• *approvals* : staff waiting for approval",
  "• *templates* : template approval status",
  "• *broadcasts* : latest campaigns",
  "• *chat <phone>* : customer details and last messages",
].join("\n");

function clip(text: string, max = 3600): string {
  return text.length > max ? `${text.slice(0, max - 20)}\n...(trimmed)` : text;
}

function inr(n: number): string {
  return `Rs ${Math.round(n).toLocaleString("en-IN")}`;
}

export async function handleOwnerReadCommand(p: {
  text: string;
  hubBase: string;
  reply: (text: string) => Promise<void>;
}): Promise<boolean> {
  const raw = p.text.trim();
  if (!raw || raw.length > 90) return false;
  const core = normalizeOwnerText(raw);
  if (!core) return false;

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const crm = getRawLibSqlClient("crm_orders");
  const mkt = getRawLibSqlClient("marketing");
  const bill = getRawLibSqlClient("billing_ops");
  const auth = getRawLibSqlClient("core_auth");
  const startIso = todayStartIso();
  const empty = { rows: [] as Record<string, unknown>[] };

  if (/^(?:help|commands?|menu|owner (?:help|menu)|what can you do)$/.test(core)) {
    await p.reply(OWNER_HELP);
    return true;
  }

  if (/^(?:summary|overview|status|dashboard|stats?|snapshot|today|report|(?:business|desk|today)(?: summary| stats| report)?|how(?:'s| is) (?:the )?(?:business|desk|today))$/.test(core)) {
    await ensureLeadForwardsTable();
    const [open, waiting, acrio, newToday, resolvedToday, cb, queue, leads, enq, orders, staff] = await Promise.all([
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND COALESCE(smart_category,'') != 'Internal Team'`),
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL`),
      conv.execute(`SELECT COUNT(*) AS c FROM conversations WHERE status != 'RESOLVED' AND assigned_staff_id = 'ACRIO' AND COALESCE(smart_category,'') != 'Internal Team'`),
      conv.execute({ sql: `SELECT COUNT(*) AS c FROM conversations WHERE created_at >= ?`, args: [startIso] }),
      conv.execute({ sql: `SELECT COUNT(*) AS c FROM conversations WHERE status = 'RESOLVED' AND resolved_at >= ?`, args: [startIso] }),
      conv.execute(`SELECT COUNT(*) AS c FROM callback_requests WHERE status = 'PENDING'`).catch(() => empty),
      conv.execute(`SELECT COUNT(*) AS c FROM call_dispatch_queue WHERE status != 'RESOLVED'`).catch(() => empty),
      conv.execute({ sql: `SELECT COUNT(*) AS c FROM lead_forwards WHERE created_at >= ?`, args: [startIso] }),
      crm.execute(`SELECT COUNT(*) AS c FROM ecosystem_enquiries WHERE status = 'New'`).catch(() => empty),
      crm
        .execute({
          sql: `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount_inr),0) AS t FROM customer_orders WHERE ordered_at >= ?`,
          args: [startIso],
        })
        .catch(() => empty),
      loadDeskStaff(),
    ]);
    const windows = await loadWindowStates(staff);
    const unlocked = staff.filter((s) => windowFor(windows, s).open).length;
    const n = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.c ?? 0);
    const orderRow = orders.rows[0] || {};
    await p.reply(
      [
        `*Desk summary, ${formatInTimeZone(new Date(), TZ, "d MMM, h:mm a")}*`,
        "",
        `• Open customer chats: ${n(open)}`,
        `• Waiting for a staff reply: ${n(waiting)}`,
        `• Still with ACRIO: ${n(acrio)}`,
        `• New chats today: ${n(newToday)}`,
        `• Resolved today: ${n(resolvedToday)}`,
        `• Pending callbacks: ${n(cb)}`,
        `• Open call queue items: ${n(queue)}`,
        `• Leads you forwarded today: ${n(leads)}`,
        `• New website enquiries: ${n(enq)}`,
        `• Orders today: ${Number(orderRow.c ?? 0)} (${inr(Number(orderRow.t ?? 0))})`,
        `• Staff with chat unlocked: ${unlocked} of ${staff.length}`,
        "",
        `Dashboard: ${p.hubBase}/dashboard`,
      ].join("\n")
    );
    return true;
  }

  if (/^(?:waiting(?: chats?| customers?| list)?|who is waiting|pending (?:replies|chats|customers)|unanswered(?: chats)?)$/.test(core)) {
    const res = await conv.execute(
      `SELECT id, customer_name, customer_phone, assigned_staff_name, waiting_since, last_message_preview
       FROM conversations
       WHERE status != 'RESOLVED' AND waiting_since IS NOT NULL AND COALESCE(smart_category,'') != 'Internal Team'
       ORDER BY waiting_since ASC LIMIT 8`
    );
    if (res.rows.length === 0) {
      await p.reply("Good news, sir. No customer is waiting for a reply right now.");
      return true;
    }
    const now = Date.now();
    const items = res.rows
      .map((r, i) => {
        const mins = Math.max(0, Math.round((now - new Date(String(r.waiting_since)).getTime()) / 60000));
        const waited = mins >= 90 ? `${Math.round(mins / 60)}h` : `${mins}m`;
        return `${i + 1}. *${String(r.customer_name || r.customer_phone)}* waiting ${waited}\n   With: ${String(r.assigned_staff_name || "ACRIO")}\n   "${String(r.last_message_preview || "").slice(0, 80)}"`;
      })
      .join("\n\n");
    await p.reply(clip(`*Customers waiting longest*\n\n${items}\n\nInbox: ${p.hubBase}/dashboard/inbox`));
    return true;
  }

  if (/^(?:unassigned(?: chats?| leads?)?|acrio chats?|chats? with acrio|open pool)$/.test(core)) {
    const res = await conv.execute(
      `SELECT customer_name, customer_phone, smart_category, last_message_at, last_message_preview
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id = 'ACRIO' AND COALESCE(smart_category,'') != 'Internal Team'
       ORDER BY last_message_at DESC LIMIT 8`
    );
    if (res.rows.length === 0) {
      await p.reply("No open chat is sitting with ACRIO right now, sir.");
      return true;
    }
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})\n   ${String(r.smart_category || "Enquiry")} | ${fmtTime(String(r.last_message_at))}`
      )
      .join("\n\n");
    await p.reply(clip(`*Chats handled by ACRIO*\n\n${items}`));
    return true;
  }

  if (/^(?:team|staff|team status|staff status|who(?:'s| is) online|online(?: staff)?|who said hi|attendance|present|available staff|who(?:'s| is) available|unlocked)$/.test(core)) {
    const staff = await loadDeskStaff();
    const windows = await loadWindowStates(staff);
    const loadRes = await conv.execute(
      `SELECT assigned_staff_id AS sid, COUNT(*) AS c FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO' GROUP BY assigned_staff_id`
    );
    const load = new Map(loadRes.rows.map((r) => [String(r.sid), Number(r.c ?? 0)]));
    const rows = staff
      .filter((s) => s.role !== "DEV")
      .map((s) => ({ s, w: windowFor(windows, s), open: load.get(s.id) ?? 0 }));
    const on = rows.filter((r) => r.w.open);
    const off = rows.filter((r) => !r.w.open);
    const lineOn = on.map((r) => `• ${r.s.name} | ${r.open} open | unlocked until ${fmtTime(r.w.until)}`);
    const lineOff = off.map((r) => `• ${r.s.name}${r.s.phone ? "" : " (no number saved)"} | ${r.open} open`);
    await p.reply(
      clip(
        [
          `*Team status*`,
          `Unlocked (said hi in last 24h): ${on.length}   Locked: ${off.length}`,
          "",
          ...(lineOn.length ? ["*Unlocked*", ...lineOn, ""] : []),
          ...(lineOff.length ? ["*Locked (not said hi)*", ...lineOff] : []),
        ].join("\n")
      )
    );
    return true;
  }

  if (/^(?:workload|load|staff load|chats per staff|distribution)$/.test(core)) {
    const res = await conv.execute(
      `SELECT assigned_staff_name AS n, COUNT(*) AS c,
              SUM(CASE WHEN waiting_since IS NOT NULL THEN 1 ELSE 0 END) AS w
       FROM conversations
       WHERE status != 'RESOLVED' AND assigned_staff_id IS NOT NULL AND assigned_staff_id != 'ACRIO'
         AND COALESCE(smart_category,'') != 'Internal Team'
       GROUP BY assigned_staff_id ORDER BY c DESC LIMIT 15`
    );
    if (res.rows.length === 0) {
      await p.reply("No staff member has an open chat right now, sir.");
      return true;
    }
    await p.reply(
      clip(
        `*Open chats per staff*\n\n${res.rows
          .map((r) => `• ${String(r.n)}: ${Number(r.c)} open, ${Number(r.w ?? 0)} waiting`)
          .join("\n")}`
      )
    );
    return true;
  }

  const staffChatsMatch =
    core.match(/^(?:chats?|leads?|queue|load|workload)\s+(?:of|for|with)\s+@?([a-z][a-z .'-]{1,30})$/) ||
    core.match(/^@?([a-z][a-z .'-]{1,30}?)(?:'s)?\s+(?:chats?|leads?|queue|load|workload)$/);
  if (staffChatsMatch && !/^(?:my|the|all|open|new|pending)$/.test(staffChatsMatch[1].trim())) {
    const staff = await loadDeskStaff();
    const hit = resolveStaffMemberByQuery(staffChatsMatch[1].trim(), staff);
    if (!hit) {
      await p.reply(`Sir, I could not find a staff member called *${staffChatsMatch[1].trim()}*.`);
      return true;
    }
    const res = await conv.execute({
      sql: `SELECT id, customer_name, customer_phone, smart_category, last_message_preview, waiting_since
            FROM conversations WHERE assigned_staff_id = ? AND status != 'RESOLVED'
            ORDER BY last_message_at DESC LIMIT 8`,
      args: [hit.id],
    });
    if (res.rows.length === 0) {
      await p.reply(`${hit.name} has no open chats right now.`);
      return true;
    }
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. *${String(r.customer_name || r.customer_phone)}* (${String(r.customer_phone)})${r.waiting_since ? " [waiting]" : ""}\n   ${String(r.smart_category || "Enquiry")} | "${String(r.last_message_preview || "").slice(0, 70)}"`
      )
      .join("\n\n");
    await p.reply(clip(`*${hit.name}: ${res.rows.length} open chat${res.rows.length === 1 ? "" : "s"}*\n\n${items}`));
    return true;
  }

  if (/^(?:leads?(?: today| log| forwarded| history)?|forwarded leads?|lead log|assigned leads?|today'?s? leads?)$/.test(core)) {
    await ensureLeadForwardsTable();
    const res = await conv.execute({
      sql: `SELECT staff_name, lead_text, customer_name, customer_phone, delivery_status, created_at
            FROM lead_forwards WHERE created_at >= ? ORDER BY created_at DESC LIMIT 10`,
      args: [startIso],
    });
    if (res.rows.length === 0) {
      await p.reply("You have not forwarded any lead today, sir.");
      return true;
    }
    const statusWord = (s: string) =>
      s === "DELIVERED" ? "delivered" : s === "PENDING_WINDOW" ? "waiting for staff to say hi" : s === "NO_WHATSAPP" ? "no number" : "failed";
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. ${fmtTime(String(r.created_at))} to *${String(r.staff_name)}* (${statusWord(String(r.delivery_status))})\n   ${String(r.lead_text || "").replace(/\s+/g, " ").slice(0, 100)}`
      )
      .join("\n\n");
    await p.reply(clip(`*Leads forwarded today (${res.rows.length})*\n\n${items}`));
    return true;
  }

  if (/^(?:callbacks?|pending callbacks?|call ?backs?|call queue|calls)$/.test(core)) {
    const [cb, q] = await Promise.all([
      conv
        .execute(
          `SELECT customer_name, customer_phone, preferred_slot, topic FROM callback_requests
           WHERE status = 'PENDING' ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => empty),
      conv
        .execute(
          `SELECT customer_name, customer_phone, assigned_staff_name, status, product_topic FROM call_dispatch_queue
           WHERE status != 'RESOLVED' ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => empty),
    ]);
    const a = cb.rows.map(
      (r, i) => `${i + 1}. *${String(r.customer_name || r.customer_phone)}* | ${String(r.preferred_slot || "ASAP")} | ${String(r.topic || "General")}`
    );
    const b = q.rows.map(
      (r, i) => `${i + 1}. *${String(r.customer_name || r.customer_phone)}* | ${String(r.assigned_staff_name || "Open pool")} | ${String(r.status)}`
    );
    await p.reply(
      clip(
        [
          `*Pending callbacks (${a.length})*`,
          ...(a.length ? a : ["None"]),
          "",
          `*Open call queue (${b.length})*`,
          ...(b.length ? b : ["None"]),
          "",
          `${p.hubBase}/dashboard/call-queue`,
        ].join("\n")
      )
    );
    return true;
  }

  if (/^(?:enquiries|inquiries|website enquiries|website leads|new enquiries)$/.test(core)) {
    const [cnt, rows] = await Promise.all([
      crm
        .execute(`SELECT SUM(CASE WHEN status='New' THEN 1 ELSE 0 END) AS n, COUNT(*) AS t FROM ecosystem_enquiries`)
        .catch(() => empty),
      crm
        .execute(
          `SELECT brand_label, customer_name, customer_phone, product_name, status, created_at FROM ecosystem_enquiries
           ORDER BY created_at DESC LIMIT 6`
        )
        .catch(() => empty),
    ]);
    const items = rows.rows
      .map(
        (r, i) =>
          `${i + 1}. [${String(r.status)}] *${String(r.customer_name)}* | ${String(r.brand_label)}\n   ${String(r.product_name || "General")} | ${fmtTime(String(r.created_at))}`
      )
      .join("\n\n");
    await p.reply(
      clip(
        `*Website enquiries*\nNew: ${Number(cnt.rows[0]?.n ?? 0)} of ${Number(cnt.rows[0]?.t ?? 0)} total\n\n${items || "None yet."}\n\n${p.hubBase}/dashboard/enquiries`
      )
    );
    return true;
  }

  if (/^(?:orders?|sales|revenue|orders today|order summary)$/.test(core)) {
    const since30 = new Date(Date.now() - 30 * 86400000).toISOString();
    const [t, m, recent] = await Promise.all([
      crm
        .execute({ sql: `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount_inr),0) AS t FROM customer_orders WHERE ordered_at >= ?`, args: [startIso] })
        .catch(() => empty),
      crm
        .execute({ sql: `SELECT COUNT(*) AS c, COALESCE(SUM(total_amount_inr),0) AS t FROM customer_orders WHERE ordered_at >= ?`, args: [since30] })
        .catch(() => empty),
      crm
        .execute(`SELECT order_number, items_summary, total_amount_inr, fulfillment_status FROM customer_orders ORDER BY ordered_at DESC LIMIT 5`)
        .catch(() => empty),
    ]);
    const items = recent.rows
      .map((r, i) => `${i + 1}. ${String(r.order_number)} | ${inr(Number(r.total_amount_inr ?? 0))} | ${String(r.fulfillment_status)}\n   ${String(r.items_summary || "").slice(0, 70)}`)
      .join("\n");
    await p.reply(
      clip(
        `*Orders*\nToday: ${Number(t.rows[0]?.c ?? 0)} orders, ${inr(Number(t.rows[0]?.t ?? 0))}\nLast 30 days: ${Number(m.rows[0]?.c ?? 0)} orders, ${inr(Number(m.rows[0]?.t ?? 0))}\n\n*Latest*\n${items || "No orders yet."}`
      )
    );
    return true;
  }

  if (/^(?:billing|cost|costs|spend|message cost|message charges|whatsapp (?:cost|spend|bill)|cost breakdown)$/.test(core)) {
    const [byCat, today] = await Promise.all([
      bill
        .execute(`SELECT category, COUNT(*) AS c, COALESCE(SUM(client_unit_rate_inr),0) AS t FROM message_billing_ledger GROUP BY category`)
        .catch(() => empty),
      bill
        .execute({ sql: `SELECT COUNT(*) AS c, COALESCE(SUM(client_unit_rate_inr),0) AS t FROM message_billing_ledger WHERE billed_at >= ?`, args: [startIso] })
        .catch(() => empty),
    ]);
    const total = byCat.rows.reduce((a, r) => a + Number(r.t ?? 0), 0);
    const count = byCat.rows.reduce((a, r) => a + Number(r.c ?? 0), 0);
    await p.reply(
      clip(
        [
          "*WhatsApp message charges*",
          `Today: ${Number(today.rows[0]?.c ?? 0)} billed messages, Rs ${Number(today.rows[0]?.t ?? 0).toFixed(2)}`,
          `All time: ${count} billed messages, Rs ${total.toFixed(2)}`,
          "",
          ...byCat.rows.map((r) => `• ${String(r.category)}: ${Number(r.c)} messages, Rs ${Number(r.t ?? 0).toFixed(2)}`),
          "",
          "Normal staff replies inside 24 hours and internal notes cost nothing.",
          `${p.hubBase}/dashboard/pricing`,
        ].join("\n")
      )
    );
    return true;
  }

  if (/^(?:approvals?|pending approvals?|pending staff|staff requests?|new staff)$/.test(core)) {
    const res = await auth
      .execute(
        `SELECT name, department, created_at FROM users WHERE status = 'PENDING_APPROVAL' ORDER BY created_at DESC LIMIT 8`
      )
      .catch(() => empty);
    if (res.rows.length === 0) {
      await p.reply("No staff account is waiting for approval, sir.");
      return true;
    }
    const items = res.rows
      .map((r, i) => `${i + 1}. *${String(r.name)}* | ${String(r.department || "Sales & Support")} | ${fmtTime(String(r.created_at))}`)
      .join("\n");
    await p.reply(clip(`*Waiting for your approval (${res.rows.length})*\n\n${items}\n\nApprove here: ${p.hubBase}/dashboard/approvals`));
    return true;
  }

  if (/^(?:templates?|template status)$/.test(core)) {
    const res = await mkt
      .execute(`SELECT approval_status AS s, COUNT(*) AS c FROM templates GROUP BY approval_status`)
      .catch(() => empty);
    await p.reply(
      clip(
        `*Template status*\n${res.rows.map((r) => `• ${String(r.s)}: ${Number(r.c)}`).join("\n") || "No templates yet."}\n\n${p.hubBase}/dashboard/templates`
      )
    );
    return true;
  }

  if (/^(?:broadcasts?|campaigns?)$/.test(core)) {
    const res = await mkt
      .execute(
        `SELECT name, status, total_recipients, sent_count, delivered_count, read_count, created_at FROM broadcasts ORDER BY created_at DESC LIMIT 5`
      )
      .catch(() => empty);
    if (res.rows.length === 0) {
      await p.reply("No broadcast has been sent yet, sir.");
      return true;
    }
    const items = res.rows
      .map(
        (r, i) =>
          `${i + 1}. *${String(r.name)}* [${String(r.status)}]\n   Sent ${Number(r.sent_count)}/${Number(r.total_recipients)} | Delivered ${Number(r.delivered_count)} | Read ${Number(r.read_count)}`
      )
      .join("\n\n");
    await p.reply(clip(`*Latest broadcasts*\n\n${items}\n\n${p.hubBase}/dashboard/marketing`));
    return true;
  }

  if (/^(?:performance|leaderboard|top staff|best staff|sla|response times?|staff performance)$/.test(core)) {
    const ranked = await computePerformanceRankedStaff().catch(() => []);
    if (ranked.length === 0) {
      await p.reply("There is no staff performance data yet, sir.");
      return true;
    }
    const fmtSec = (s: number | null) => (s === null ? "no data" : s < 60 ? `${s}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`);
    const items = ranked
      .slice(0, 8)
      .map((r, i) => `${i + 1}. *${r.staffName}* | ${r.resolved30d} resolved (30d) | first reply ${fmtSec(r.avgFirstResponseSec)} | ${r.openLoad} open`)
      .join("\n");
    await p.reply(clip(`*Staff performance (last 30 days)*\n\n${items}\n\n${p.hubBase}/dashboard/analytics`));
    return true;
  }

  const chatLookup = raw.match(/^(?:chat|history|messages|conversation)\s+(?:with\s+|of\s+)?(\+?\d[\d\s-]{8,14}\d)\W*$/i);
  if (chatLookup) {
    const digits = suffix10(chatLookup[1]);
    const c = await conv.execute({
      sql: `SELECT id, customer_name, customer_phone, status, assigned_staff_name, smart_category
            FROM conversations WHERE customer_phone LIKE ? ORDER BY last_message_at DESC LIMIT 1`,
      args: [`%${digits}`],
    });
    const row = c.rows[0];
    if (!row) {
      await p.reply(`Sir, there is no chat for *${chatLookup[1].trim()}*.`);
      return true;
    }
    const msgs = await conv.execute({
      sql: `SELECT direction, sender_name, body, created_at FROM messages
            WHERE conversation_id = ? AND direction IN ('INBOUND','OUTBOUND') ORDER BY created_at DESC LIMIT 6`,
      args: [String(row.id)],
    });
    const lines = [...msgs.rows]
      .reverse()
      .map((m) => `${String(m.direction) === "INBOUND" ? "Customer" : String(m.sender_name || "Team")}: ${String(m.body || "").replace(/\s+/g, " ").slice(0, 120)}`);
    await p.reply(
      clip(
        `*${String(row.customer_name || row.customer_phone)}* (${String(row.customer_phone)})\nWith: ${String(row.assigned_staff_name || "ACRIO")} | ${String(row.status)} | ${String(row.smart_category || "Enquiry")}\n\n*Last messages*\n${lines.join("\n")}\n\nOpen chat: ${p.hubBase}/dashboard/inbox?chat=${encodeURIComponent(String(row.id))}`
      )
    );
    return true;
  }

  return false;
}
