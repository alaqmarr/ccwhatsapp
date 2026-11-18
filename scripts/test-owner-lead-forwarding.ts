import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "../packages/database/src/index";
import {
  parseAssignCommand,
  processInboundAutomations,
} from "../packages/workers/src/index";

/**
 * Owner lead forwarding + owner desk regression test.
 * Runs entirely in sandbox mode (no real WhatsApp sends) with a TEST owner number, test staff and a unique marker
 * in every lead so the cleanup can remove only what this script created.
 */

const MARKER = "QZ-TEST-LEAD";
const OWNER = "+919000010001";
const STAFF_A = "+919000010002"; // unlocked (said hi)
const STAFF_B = "+919000010003"; // locked
const CUSTOMER_1 = "+919000011111";
const CUSTOMER_2 = "+919000022222";
void CUSTOMER_2;

const failures: string[] = [];
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`   PASS: ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`   FAIL: ${name}\n         ${(err as Error).message.split("\n")[0]}`);
  }
}

function testParser() {
  console.log("1) Parsing the 'please assign' command...");
  const named = [
    ["please assign to @Rahul", "Rahul", ""],
    ["Please assign to Rahul Sharma", "Rahul Sharma", ""],
    ["assign to @rahul", "rahul", ""],
    ["Rahul ko assign kar do", "Rahul", ""],
    ["please assign this to @Priya", "Priya", ""],
    ["forward to @Priya", "Priya", ""],
    ["Need 10 podiums for a hotel in Pune.\nPlease assign to @Priya", "Priya", "Need 10 podiums for a hotel in Pune."],
    ["Need 10 podiums. Please assign to @Priya", "Priya", "Need 10 podiums."],
    ["Please assign to @Priya\nNeed 10 podiums", "Priya", "Need 10 podiums"],
  ] as const;
  for (const [text, target, lead] of named) {
    check(`named: ${JSON.stringify(text)}`, () => {
      const p = parseAssignCommand(text);
      assert.equal(p.found, true);
      assert.equal(p.generic, false);
      assert.equal(p.targetQuery, target);
      assert.equal(p.leadText.trim(), lead);
    });
  }
  const generic = [
    "please assign",
    "Please assign to staff",
    "please assign to @staff",
    "assign to anyone",
    "assign to someone from sales",
    "please assign to sales team",
    "assign this lead",
    "Assign kar do",
  ];
  for (const text of generic) {
    check(`generic: ${JSON.stringify(text)}`, () => {
      const p = parseAssignCommand(text);
      assert.equal(p.found, true, "should be a command");
      assert.equal(p.generic, true, "should be generic");
    });
  }
  const notCommands = [
    "Please send me the price of 10 podiums",
    "Can you give me a quote for trophies",
    "I need to assign a budget of 50000 for podiums and chairs",
    "send it",
    "give me details",
    "Hello",
    "What is the status",
  ];
  for (const text of notCommands) {
    check(`not a command: ${JSON.stringify(text)}`, () => {
      assert.equal(parseAssignCommand(text).found, false);
    });
  }
}

async function main() {
  testParser();

  process.env.WHATSAPP_FORCE_SANDBOX_FOR_TESTS = "1";
  process.env.OWNER_WHATSAPP_NUMBERS = OWNER;
  process.env.ACRIO_DISABLE_DEBOUNCE = "1";
  const savedClientKey = process.env.ANTHROPIC_CLIENT_API_KEY;
  const savedApiKey = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_CLIENT_API_KEY = "";
  process.env.ANTHROPIC_API_KEY = "";

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const core = getRawLibSqlClient("core_auth");
  const contacts = getRawLibSqlClient("contacts");
  const crm = getRawLibSqlClient("crm_orders");

  const uid = crypto.randomUUID().slice(0, 6);
  const staffA = { id: `test_ld_a_${uid}`, name: "Qzalpha Tester", email: `qzalpha_${uid}@example.test` };
  const staffB = { id: `test_ld_b_${uid}`, name: "Qzbeta Tester", email: `qzbeta_${uid}@example.test` };
  const convIds: Record<string, string> = {};

  async function cleanup() {
    const customerPhones = ["+919000011111", "+919000022222", "+919000033333", "+919000044444", "+919000055555", "+919000066666"];
    const phones = [OWNER, STAFF_A, STAFF_B, ...customerPhones];
    const ph = phones.map(() => "?").join(",");
    await conv.execute({ sql: `DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE customer_phone IN (${ph}))`, args: phones }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM messages WHERE body LIKE ?`, args: [`%${MARKER}%`] }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM conversation_assignments WHERE customer_phone IN (${ph})`, args: phones }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM conversations WHERE customer_phone IN (${ph})`, args: phones }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM lead_forwards WHERE lead_text LIKE ?`, args: [`%${MARKER}%`] }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM call_dispatch_queue WHERE notes LIKE ?`, args: [`%${MARKER}%`] }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM staff_notifications WHERE staff_id IN (?, ?) OR text LIKE ?`, args: [staffA.id, staffB.id, `%${MARKER}%`] }).catch(() => {});
    await conv.execute({ sql: `DELETE FROM team_members WHERE staff_id IN (?, ?)`, args: [staffA.id, staffB.id] }).catch(() => {});
    await core.execute({ sql: `DELETE FROM users WHERE id IN (?, ?)`, args: [staffA.id, staffB.id] }).catch(() => {});
    await contacts.execute({ sql: `DELETE FROM contacts WHERE phone IN (${ph})`, args: phones }).catch(() => {});
    await crm.execute({ sql: `DELETE FROM customers WHERE phone IN (${ph})`, args: phones }).catch(() => {});
  }

  async function makeConversation(phone: string, name: string, windowOpen: boolean): Promise<string> {
    const id = `conv_test_ld_${crypto.randomUUID().slice(0, 6)}`;
    const nowIso = new Date().toISOString();
    const exp = new Date(Date.now() + (windowOpen ? 12 : -2) * 3600 * 1000).toISOString();
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority, smart_category, assigned_staff_id, assigned_staff_name,
        assigned_team_id, assigned_team_name, escalation_level, unread_count, last_message_preview, last_message_at,
        last_message_direction, last_message_status, window_expires_at, created_at
      ) VALUES (?, ?, ?, 'OPEN', 'NORMAL', 'Internal Team', 'ACRIO', 'ACRIO', NULL, 'Internal Team Desk', 'P0', 0, 'test', ?, 'INBOUND', 'DELIVERED', ?, ?)`,
      args: [id, phone, name, nowIso, exp, nowIso],
    });
    return id;
  }

  async function say(phone: string, convId: string, text: string, opts?: { replyTo?: string; waId?: string }) {
    const waId = opts?.waId || `wamid.test_ld_${crypto.randomUUID().slice(0, 10)}`;
    const nowIso = new Date().toISOString();
    await conv.execute({
      sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, metadata_json, wa_message_id, delivery_status, created_at)
            VALUES (?, ?, 'INBOUND', 'CUSTOMER', 'Test', 'TEXT', 'FREE_CHAT', ?, '{}', ?, 'DELIVERED', ?)`,
      args: [`msg_test_${crypto.randomUUID().slice(0, 8)}`, convId, text, waId, nowIso],
    });
    await conv.execute({
      sql: `UPDATE conversations SET window_expires_at = ?, last_message_at = ? WHERE id = ?`,
      args: [new Date(Date.now() + 24 * 3600 * 1000).toISOString(), nowIso, convId],
    });
    await processInboundAutomations({
      conversationId: convId,
      customerPhone: phone,
      inboundText: text,
      isNewConversation: false,
      waMessageId: waId,
      replyToWaMessageId: opts?.replyTo,
    });
    await new Promise((r) => setTimeout(r, 60));
    return waId;
  }

  async function lastOutbound(convId: string): Promise<string> {
    const r = await conv.execute({
      sql: `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' ORDER BY created_at DESC LIMIT 1`,
      args: [convId],
    });
    return String(r.rows[0]?.body || "");
  }
  async function outboundBodies(convId: string): Promise<string[]> {
    const r = await conv.execute({
      sql: `SELECT body FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' ORDER BY created_at ASC`,
      args: [convId],
    });
    return r.rows.map((x) => String(x.body || ""));
  }
  async function leadRows() {
    const r = await conv.execute({
      sql: `SELECT * FROM lead_forwards WHERE lead_text LIKE ? ORDER BY created_at ASC`,
      args: [`%${MARKER}%`],
    });
    return r.rows as Record<string, unknown>[];
  }

  try {
    await cleanup();
    const nowIso = new Date().toISOString();
    for (const [s, phone] of [[staffA, STAFF_A], [staffB, STAFF_B]] as const) {
      await core.execute({
        sql: `INSERT INTO users (id, name, email, whatsapp_number, password_hash, role, status, department, email_verified_at, created_at)
              VALUES (?, ?, ?, ?, 'x', 'STAFF', 'ACTIVE', 'Sales & Support', ?, ?)`,
        args: [s.id, s.name, s.email, phone, nowIso, nowIso],
      });
      await conv.execute({
        sql: `INSERT INTO team_members (id, team_id, staff_id, staff_name, staff_email, tier, max_active_chats, is_available, created_at)
              VALUES (?, 'team_sales', ?, ?, ?, 'P0', 15, 1, ?)`,
        args: [`tm_test_${crypto.randomUUID().slice(0, 6)}`, s.id, s.name, s.email, nowIso],
      });
    }
    convIds.owner = await makeConversation(OWNER, "Owner Test", true);
    convIds.a = await makeConversation(STAFF_A, "Qzalpha Tester (Team)", true); // already said hi
    // Staff B has NOT said hi: no open window, no conversation yet.

    console.log("2) Named assignment to a staff member whose chat is unlocked...");
    await say(
      OWNER,
      convIds.owner,
      `${MARKER} Need 20 acrylic podiums for a hotel in Pune.\nCustomer name: Ravi Kumar, 90000 11111\nPlease assign to @Qzalpha`
    );
    let leads = await leadRows();
    check("one lead saved for the named staff member", () => {
      assert.equal(leads.length, 1);
      assert.equal(String(leads[0].staff_id), staffA.id);
      assert.equal(String(leads[0].assignment_mode), "NAMED");
    });
    check("lead marked DELIVERED because the chat was unlocked", () => {
      assert.equal(String(leads[0].delivery_status), "DELIVERED");
    });
    const aBodies = await outboundBodies(convIds.a);
    check("staff received the original enquiry text word for word", () => {
      assert.ok(aBodies.some((b) => b.includes("Need 20 acrylic podiums for a hotel in Pune.")), aBodies.join(" | ").slice(0, 200));
    });
    check("staff message shows the customer name and phone parsed from the text", () => {
      assert.ok(aBodies.some((b) => b.includes("Ravi Kumar") && b.includes("+919000011111")));
    });
    const confirm1 = await lastOutbound(convIds.owner);
    check("owner confirmation mentions Qzalpha and delivery", () => {
      assert.ok(/Qzalpha/.test(confirm1) && /received the full enquiry/i.test(confirm1), confirm1.slice(0, 160));
    });
    check("no em dashes in owner confirmation", () => assert.ok(!/[\u2014]|--/.test(confirm1)));
    const cq = await conv.execute({ sql: `SELECT assigned_staff_id FROM call_dispatch_queue WHERE notes LIKE ?`, args: [`%${MARKER}%`] });
    check("lead also saved in the hub Call Queue for the same staff member", () => {
      assert.equal(cq.rows.length, 1);
      assert.equal(String(cq.rows[0].assigned_staff_id), staffA.id);
    });

    console.log("3) Two-step flow: paste enquiry first, assign afterwards, staff chat locked...");
    await say(OWNER, convIds.owner, `${MARKER} Looking for 5 trophies for annual day, call 9000022222 tomorrow.`);
    const ack = await lastOutbound(convIds.owner);
    check("owner gets a short 'got it' and no AI essay for a pasted enquiry", () => {
      assert.ok(/Got it, sir/.test(ack) && ack.length < 220, ack);
    });
    await say(OWNER, convIds.owner, "please assign to @Qzbeta");
    leads = await leadRows();
    const second = leads[leads.length - 1];
    check("second lead picked up the earlier pasted enquiry", () => {
      assert.equal(leads.length, 2);
      assert.ok(String(second.lead_text).includes("5 trophies"));
      assert.equal(String(second.staff_id), staffB.id);
    });
    check("lead is held (PENDING_WINDOW) because staff B has not said hi", () => {
      assert.equal(String(second.delivery_status), "PENDING_WINDOW");
    });
    const confirm2 = await lastOutbound(convIds.owner);
    check("owner is told the chat is locked", () => {
      assert.ok(/locked/i.test(confirm2) && /Qzbeta/.test(confirm2), confirm2.slice(0, 200));
    });

    console.log("4) Staff B says hi: greeting first, then the held lead...");
    // The template sent to a locked chat already created Staff B's chat row. Reuse it and open the window, as the webhook would.
    const existingB = await conv.execute({ sql: `SELECT id FROM conversations WHERE customer_phone = ? LIMIT 1`, args: [STAFF_B] });
    if (existingB.rows[0]) {
      convIds.b = String(existingB.rows[0].id);
    } else {
      convIds.b = await makeConversation(STAFF_B, "Qzbeta Tester (Team)", true);
    }
    await say(STAFF_B, convIds.b, "hi");
    const bBodies = await outboundBodies(convIds.b);
    check("staff B gets a greeting that confirms the chat is unlocked", () => {
      assert.ok(bBodies.some((b) => /unlocked until/i.test(b)), bBodies.join(" | ").slice(0, 200));
    });
    check("held lead is delivered right after the greeting", () => {
      const gi = bBodies.findIndex((b) => /unlocked until/i.test(b));
      const li = bBodies.findIndex((b) => b.includes("5 trophies"));
      assert.ok(li > gi && gi >= 0, `greeting at ${gi}, lead at ${li}`);
    });
    leads = await leadRows();
    check("held lead is now marked DELIVERED", () => {
      assert.equal(String(leads[leads.length - 1].delivery_status), "DELIVERED");
    });

    console.log("5) 'please assign' with nobody named picks from the Sales Team...");
    await say(OWNER, convIds.owner, `${MARKER} Hospital needs 3 acrylic display stands, phone 90000 33333`);
    await say(OWNER, convIds.owner, "please assign");
    leads = await leadRows();
    const third = leads[leads.length - 1];
    check("third lead saved with automatic sales pick", () => {
      assert.equal(leads.length, 3);
      assert.equal(String(third.assignment_mode), "AUTO_SALES");
      assert.ok(String(third.staff_id).length > 0);
    });
    const confirm3 = await lastOutbound(convIds.owner);
    check("owner confirmation explains who was picked", () => assert.ok(/I picked/.test(confirm3), confirm3.slice(0, 200)));

    console.log("6) Swipe-reply picks exactly the quoted enquiry...");
    const w1 = await say(OWNER, convIds.owner, `${MARKER} Quote needed: 12 acrylic menu holders, restaurant in Banjara Hills, 90000 44444`);
    await say(OWNER, convIds.owner, `${MARKER} Another one: 2 podiums for school, 90000 55555`);
    await say(OWNER, convIds.owner, "assign to @Qzalpha", { replyTo: w1 });
    leads = await leadRows();
    const fourth = leads[leads.length - 1];
    check("only the quoted enquiry was forwarded", () => {
      assert.ok(String(fourth.lead_text).includes("12 acrylic menu holders"));
      assert.ok(!String(fourth.lead_text).includes("2 podiums for school"));
    });

    console.log("7) Unknown name and empty command are refused safely...");
    const before = (await leadRows()).length;
    await say(OWNER, convIds.owner, `${MARKER} Fresh enquiry for 4 trophies, 90000 66666`);
    await say(OWNER, convIds.owner, "please assign to @Nonexistentperson");
    const refuse = await lastOutbound(convIds.owner);
    check("unknown staff name: nothing assigned, owner told clearly", () => {
      assert.ok(/could not find a staff member called/i.test(refuse), refuse.slice(0, 160));
    });
    const afterUnknown = (await leadRows()).length;
    check("no lead row created for the unknown name", () => assert.equal(afterUnknown, before));
    await say(OWNER, convIds.owner, "please assign to @Qzbeta"); // consumes the fresh enquiry
    await say(OWNER, convIds.owner, "please assign");
    const empty = await lastOutbound(convIds.owner);
    check("empty command with nothing left to forward is refused", () => {
      assert.ok(/could not find an enquiry/i.test(empty), empty.slice(0, 160));
    });

    console.log("8) Owner read-only commands...");
    const cmds: Array<[string, RegExp]> = [
      ["help", /Owner commands/],
      ["summary", /Desk summary/],
      ["team", /Team status/],
      ["leads", /Leads forwarded today/],
      ["workload", /Open chats per staff|No staff member has an open chat/],
      ["callbacks", /Pending callbacks/],
      ["enquiries", /Website enquiries/],
      ["orders", /Orders/],
      ["billing", /WhatsApp message charges/],
      ["approvals", /Waiting for your approval|No staff account is waiting/],
      ["templates", /Template status/],
      ["broadcasts", /Latest broadcasts|No broadcast/],
      ["performance", /Staff performance|no staff performance data/i],
      ["waiting", /Customers waiting longest|No customer is waiting/],
      ["unassigned", /Chats handled by ACRIO|No open chat is sitting/],
      ["chats of Qzalpha", /Qzalpha Tester/],
    ];
    for (const [cmd, re] of cmds) {
      await say(OWNER, convIds.owner, cmd);
      const out = await lastOutbound(convIds.owner);
      check(`owner command "${cmd}"`, () => assert.ok(re.test(out), out.slice(0, 140)));
    }
    await say(OWNER, convIds.owner, "team");
    const teamOut = await lastOutbound(convIds.owner);
    check("team view shows Qzalpha unlocked and lists Qzbeta too", () => {
      const unlockedPart = teamOut.split("Locked (not said hi)")[0];
      assert.ok(/Qzalpha Tester/.test(unlockedPart) && /Qzbeta Tester/.test(teamOut));
    });

    console.log("9) Staff cannot use owner powers; staff 'my leads' works...");
    const beforeStaffTry = (await leadRows()).length;
    await say(STAFF_A, convIds.a, `${MARKER} please assign to @Qzbeta`);
    const afterStaffTry = (await leadRows()).length;
    check("a staff member saying 'please assign' does not forward a lead", () =>
      assert.equal(afterStaffTry, beforeStaffTry)
    );
    await say(STAFF_A, convIds.a, "my leads");
    const myLeads = await lastOutbound(convIds.a);
    check("staff 'my leads' lists the forwarded lead", () => {
      assert.ok(/Leads forwarded to you/.test(myLeads) && /Need 20 acrylic podiums/.test(myLeads), myLeads.slice(0, 200));
    });
    await say(STAFF_A, convIds.a, "summary");
    const staffSummary = await lastOutbound(convIds.a);
    check("owner-only 'summary' detail is not served as an owner report to staff", () => {
      assert.ok(!/Desk summary/.test(staffSummary));
    });
  } finally {
    await cleanup();
    process.env.ANTHROPIC_CLIENT_API_KEY = savedClientKey;
    process.env.ANTHROPIC_API_KEY = savedApiKey;
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} CHECK(S) FAILED:\n - ${failures.join("\n - ")}`);
    process.exit(1);
  }
  console.log("\nALL CHECKS PASSED!");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
