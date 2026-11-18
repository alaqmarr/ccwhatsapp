import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
} from "../packages/database/src/index";
import {
  buildSmartCorrectedReplyOption,
  convertInternalNoteToCustomerMessage,
  detectAccidentalCustomerReplyInNote,
  executeAcrioPendingNoteAction,
  processStaffNote,
} from "../packages/workers/src/index";

async function main() {
  process.env.WHATSAPP_FORCE_SANDBOX = "1";
  await ensureDatabasesBootstrapped();

  let passed = 0;
  const check = (cond: unknown, label: string) => {
    assert.ok(cond, `FAIL: ${label}`);
    passed++;
    console.log(`  [PASS] ${label}`);
  };

  console.log("=== 1. Unit Detection: Lalitha Barma Screenshot Scenario & True Internal Memos ===");
  const merged = buildSmartCorrectedReplyOption(
    "sorry 3mm thickness",
    "5mm thickness Each one 3,220/- plus Gst and Transport charges sir,"
  );
  check(
    merged === "Sorry, 3mm thickness Each one 3,220/- plus Gst and Transport charges sir",
    `Builds smart merged correction: "${merged}"`
  );

  const detQuoted = detectAccidentalCustomerReplyInNote({
    noteText: "sorry 3mm thickness",
    replyTo: {
      messageId: "msg_out_1",
      waMessageId: "wamid.out.1",
      senderName: "Lalitha Barma",
      senderType: "STAFF",
      direction: "OUTBOUND",
      body: "5mm thickness Each one 3,220/- plus Gst and Transport charges sir,",
    },
  });
  check(
    detQuoted.isAccidentalCustomerReply === true &&
      detQuoted.mergedCorrectionText ===
        "Sorry, 3mm thickness Each one 3,220/- plus Gst and Transport charges sir",
    "Detects quoted outbound correction inside Internal Note and produces merged quote"
  );

  const detDirectQuote = detectAccidentalCustomerReplyInNote({
    noteText: "5mm thickness Each one 4,950/- plus Gst and Transport charges sir,",
    replyTo: null,
  });
  check(
    detDirectQuote.isAccidentalCustomerReply === true,
    "Detects unquoted direct customer price/GST/sir quote written in Internal Note"
  );

  const detInternalMemo = detectAccidentalCustomerReplyInNote({
    noteText: "Customer asked to call tomorrow morning, waiting for PO approval.",
    replyTo: null,
  });
  check(
    detInternalMemo.isAccidentalCustomerReply === false,
    "Does NOT false-flag genuine internal team memo ('Customer asked to call tomorrow...')"
  );

  const detMention = detectAccidentalCustomerReplyInNote({
    noteText: "@Lalitha Barma please check this rate sir",
    replyTo: null,
  });
  check(
    detMention.isAccidentalCustomerReply === false,
    "Does NOT false-flag notes that @mention a teammate"
  );

  console.log("\n=== 2. End-to-End Automatic ACRIO Warning Card & One-Click 'Send in Chat' ===");
  const conv = getRawLibSqlClient("conversations");
  const convId = `conv_note_fix_${crypto.randomUUID().slice(0, 8)}`;
  const customerPhone = "+919966015550";
  const baseTs = Date.now() - 60_000;

  await conv.execute({
    sql: `INSERT INTO conversations (
      id, customer_phone, customer_name, status, smart_category, priority,
      assigned_staff_id, assigned_staff_name, assigned_team_name, unread_count,
      last_message_preview, last_message_at, created_at
    ) VALUES (?, ?, 'laxman05550', 'ASSIGNED', 'Custom Fabrication', 'HIGH', 'staff_lalitha', 'Lalitha Barma', 'Sales Team', 0, '5mm thickness', ?, ?)`,
    args: [convId, customerPhone, new Date(baseTs).toISOString(), new Date(baseTs).toISOString()],
  });

  // Seed customer message + Lalitha's outbound WhatsApp message
  await conv.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, body, wa_message_id, created_at)
          VALUES (?, ?, 'INBOUND', 'CUSTOMER', 'laxman05550', 'TEXT', 'Yes this cost', 'wamid.in.laxman1', ?)`,
    args: [`m_in_${convId}`, convId, new Date(baseTs + 1000).toISOString()],
  });
  const outQuoteId = `m_out_${convId}`;
  await conv.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_staff_id, sender_name, message_type, body, wa_message_id, created_at)
          VALUES (?, ?, 'OUTBOUND', 'STAFF', 'staff_lalitha', 'Lalitha Barma', 'TEXT', '5mm thickness Each one 3,220/- plus Gst and Transport charges sir,', 'wamid.out.lalitha1', ?)`,
    args: [outQuoteId, convId, new Date(baseTs + 2000).toISOString()],
  });

  // Lalitha accidentally clicks "Note" on her outbound message and saves "sorry 3mm thickness"
  const lalithaNoteId = `m_note_lalitha_${convId}`;
  const replyMeta = {
    messageId: outQuoteId,
    waMessageId: "wamid.out.lalitha1",
    senderName: "Lalitha Barma",
    senderType: "STAFF",
    direction: "OUTBOUND",
    body: "5mm thickness Each one 3,220/- plus Gst and Transport charges sir,",
  };
  await conv.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, metadata_json, delivery_status, created_at)
          VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', 'Lalitha Barma', 'INTERNAL_NOTE', 'INTERNAL', 'sorry 3mm thickness', ?, 'SAVED', ?)`,
    args: [lalithaNoteId, convId, JSON.stringify({ replyTo: replyMeta }), new Date(baseTs + 3000).toISOString()],
  });

  const staffRoster = [
    { id: "staff_lalitha", name: "Lalitha Barma", email: "lalitha@classicconcepts.in" },
    { id: "staff_alaqmar", name: "AL AQMAR", email: "admin@classicconcepts.in" },
  ];

  const procRes = await processStaffNote({
    conversationId: convId,
    noteId: lalithaNoteId,
    noteText: "sorry 3mm thickness",
    author: { id: "staff_lalitha", name: "Lalitha Barma" },
    staff: staffRoster,
  });

  check(
    procRes.accidentalReplyDetected === true,
    "processStaffNote detects accidental customer reply in Lalitha's internal note"
  );

  // Verify ACRIO posted the warning note with pendingAction and 2 candidateOptions
  const acrioWarnRes = await conv.execute({
    sql: `SELECT id, body, metadata_json FROM messages
          WHERE conversation_id = ? AND sender_name = 'ACRIO' AND message_type = 'INTERNAL_NOTE'
          ORDER BY created_at DESC LIMIT 1`,
    args: [convId],
  });
  const acrioWarnRow = acrioWarnRes.rows[0];
  check(Boolean(acrioWarnRow), "ACRIO posted a private warning note immediately");
  const acrioWarnMeta = JSON.parse(String(acrioWarnRow.metadata_json || "{}"));
  check(
    acrioWarnMeta.pendingAction?.status === "PENDING_CONFIRMATION" &&
      Array.isArray(acrioWarnMeta.pendingAction?.candidateOptions) &&
      acrioWarnMeta.pendingAction.candidateOptions.length === 2,
    "ACRIO warning note includes 2 smart one-click options (full corrected message + exact note text)"
  );

  // Click Option 1 ("opt_merged_correction") on ACRIO's smart card
  const execRes = await executeAcrioPendingNoteAction({
    conversationId: convId,
    noteMessageId: String(acrioWarnRow.id),
    actorStaffId: "staff_lalitha",
    actorStaffName: "Lalitha Barma",
    decision: "CONFIRM",
    selectedOptionId: "opt_merged_correction",
  });
  check(
    execRes.ok === true && execRes.actionStatus === "CONFIRMED",
    "One-click 'Send in Chat' on ACRIO card succeeds and marks action CONFIRMED"
  );

  // Verify the outbound WhatsApp message was sent to the customer with the merged correction & replyTo preserved
  const sentOutRes = await conv.execute({
    sql: `SELECT body, sender_name, metadata_json FROM messages
          WHERE id = ? LIMIT 1`,
    args: [String(execRes.messageId)],
  });
  const sentOut = sentOutRes.rows[0];
  const sentOutMeta = JSON.parse(String(sentOut?.metadata_json || "{}"));
  check(
    String(sentOut?.body) ===
      "Sorry, 3mm thickness Each one 3,220/- plus Gst and Transport charges sir" &&
      String(sentOut?.sender_name) === "Lalitha Barma" &&
      sentOutMeta.replyTo?.waMessageId === "wamid.out.lalitha1",
    `Sent outbound WhatsApp message as 'Lalitha Barma' quoting original message: "${sentOut?.body}"`
  );

  // Verify Lalitha's original note is now marked status = "SENT"
  const updatedNoteRes = await conv.execute({
    sql: `SELECT metadata_json FROM messages WHERE id = ? LIMIT 1`,
    args: [lalithaNoteId],
  });
  const updatedNoteMeta = JSON.parse(String(updatedNoteRes.rows[0]?.metadata_json || "{}"));
  check(
    updatedNoteMeta.accidentalCustomerReply?.status === "SENT",
    "Original staff internal note metadata.accidentalCustomerReply.status is updated to 'SENT'"
  );

  console.log("\n=== 3. Manager/Teammate Points Out Mistake ('@Lalitha Barma you have replied in note instead of message reply') ===");
  const lalithaNote2Id = `m_note2_lalitha_${convId}`;
  await conv.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, metadata_json, delivery_status, created_at)
          VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', 'Lalitha Barma', 'INTERNAL_NOTE', 'INTERNAL', 'sorry 3mm thickness', ?, 'SAVED', ?)`,
    args: [lalithaNote2Id, convId, JSON.stringify({ replyTo: replyMeta }), new Date(baseTs + 10_000).toISOString()],
  });

  const managerNoteId = `m_note_manager_${convId}`;
  const managerText =
    "@Lalitha Barma you have replied in note instead of message reply - please check";
  await conv.execute({
    sql: `INSERT INTO messages (id, conversation_id, direction, sender_type, sender_name, message_type, billing_category, body, metadata_json, delivery_status, created_at)
          VALUES (?, ?, 'INTERNAL', 'STAFF_NOTE', 'AL AQMAR', 'INTERNAL_NOTE', 'INTERNAL', ?, '{}', 'SAVED', ?)`,
    args: [managerNoteId, convId, managerText, new Date(baseTs + 11_000).toISOString()],
  });

  await processStaffNote({
    conversationId: convId,
    noteId: managerNoteId,
    noteText: managerText,
    author: { id: "staff_alaqmar", name: "AL AQMAR" },
    staff: staffRoster,
  });

  const helperNotesRes = await conv.execute({
    sql: `SELECT id, body, metadata_json FROM messages
          WHERE conversation_id = ? AND sender_name = 'ACRIO' AND metadata_json LIKE ?
          LIMIT 1`,
    args: [convId, `%"inReplyToNoteId":"${managerNoteId}"%`],
  });
  check(
    helperNotesRes.rows.length === 1,
    "When manager points out 'replied in note instead of message reply', ACRIO surfaces a 1-click Send in Chat card"
  );

  // Test direct convertInternalNoteToCustomerMessage from the note bubble itself
  const directConvRes = await convertInternalNoteToCustomerMessage({
    conversationId: convId,
    noteMessageId: lalithaNote2Id,
    actorStaffId: "staff_lalitha",
    actorStaffName: "Lalitha Barma",
  });
  check(
    directConvRes.ok === true && directConvRes.status === "SENT",
    "Direct 'Send in Chat' button on staff note bubble sends to WhatsApp and marks note SENT"
  );

  // Cleanup test rows
  await conv.execute({
    sql: `DELETE FROM staff_notifications WHERE conversation_id = ?`,
    args: [convId],
  });
  await conv.execute({
    sql: `DELETE FROM messages WHERE conversation_id = ?`,
    args: [convId],
  });
  await conv.execute({
    sql: `DELETE FROM conversations WHERE id = ?`,
    args: [convId],
  });

  console.log(`\nALL ${passed} ACCIDENTAL NOTE-REPLY & SMART 'SEND IN CHAT' CHECKS PASSED!`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
