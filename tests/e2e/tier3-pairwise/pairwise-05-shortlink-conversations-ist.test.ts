import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertMatch,
  assertUtcIso,
  assertIstFormatted,
  createTestRequest,
  callRoute,
  mockMeta,
  createTestStaffSession,
} from "../harness";
import { getRawLibSqlClient, normalizeWhatsAppPhone } from "@cc/database";
import { createCustomAdminLink } from "@cc/storage";
import { formatDateTimeIst, formatTimeIst } from "@cc/ui";
import { setTestSessionUser, generateUniquePhone } from "./tier3-helper";
import * as lCodeRoute from "../../../apps/web/src/app/l/[code]/route";

describe("Pairwise 05: Short Link Resolution, Conversations & IST Tracking (F17 + F2 + F12)", () => {
  it("creates a standardized 6-character ccapl.cc short link (F17)", async () => {
    const linkRes = await createCustomAdminLink({
      code: "x7K9pQ",
      title: "Acrylic Podiums",
      targetUrl: "https://www.classicconcepts.in/acrylic-podiums",
      createdByName: "Staff Tester",
    });

    assertOk(linkRes.ok, "Short link creation should succeed");
    assertOk(linkRes.link, "Should return created link metadata");
    assertStrictEqual(linkRes.link.code, "x7K9pQ");
    const fullShortUrl = `https://ccapl.cc/${linkRes.link.code}`;
    assertStrictEqual(fullShortUrl, "https://ccapl.cc/x7K9pQ");
    assertMatch(fullShortUrl, /^https:\/\/ccapl\.cc\/[a-zA-Z0-9]{6}$/);
  });

  it("resolves backwards-compatible /l/[code] route and redirects to target URL (F17)", async () => {
    const req = createTestRequest({
      url: "/l/x7K9pQ",
      method: "GET",
    });

    const res = await callRoute(lCodeRoute, req, { params: { code: "x7K9pQ" } });
    assertStrictEqual(res.status, 307);
    const location = res.headers.get("location");
    assertOk(location);
    assertStrictEqual(location, "https://www.classicconcepts.in/acrylic-podiums");
  });

  it("tracks click counts and records last_clicked_at in UTC ISO rendered in IST (F17 + F2)", async () => {
    const conv = getRawLibSqlClient("conversations");
    const linkRow = await conv.execute({
      sql: `SELECT clicks_count, last_clicked_at FROM custom_links WHERE code = 'x7K9pQ' LIMIT 1`,
      args: [],
    });
    assertOk(linkRow.rows[0]);
    assertStrictEqual(Number(linkRow.rows[0].clicks_count), 1, "Clicks count should be incremented to 1");

    const lastClicked = String(linkRow.rows[0].last_clicked_at);
    assertUtcIso(lastClicked, "last_clicked_at must be stored in UTC ISO format");

    // UI formatting converts to IST
    const istDisplay = formatDateTimeIst(lastClicked);
    assertIstFormatted(istDisplay, { format: "dateTime" });
  });

  it("dispatches conversation message containing short link with phone normalization (F17 + F12)", async () => {
    mockMeta.reset();
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const conv = getRawLibSqlClient("conversations");
    const nowIso = new Date().toISOString();
    const uniquePhone = generateUniquePhone();
    const convId = `conv_link_${Date.now()}`;

    // Insert conversation with 10-digit unnormalized phone
    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority,
        assigned_staff_id, assigned_staff_name, last_message_at, created_at
      ) VALUES (?, ?, 'Client With Link', 'OPEN', 'NORMAL', ?, ?, ?, ?)`,
      args: [convId, uniquePhone, staffSession.user.id, staffSession.user.name, nowIso, nowIso],
    });

    const conversationIdRoute = await import("../../../apps/web/src/app/api/conversations/[id]/route");
    const messageText = "Check our acrylic podiums: https://ccapl.cc/x7K9pQ";

    const dispatchReq = createTestRequest({
      url: `/api/conversations/${convId}`,
      method: "POST",
      sessionToken: staffSession.token,
      body: {
        action: "send_message",
        text: messageText,
      },
    });

    const dispatchRes = await callRoute(conversationIdRoute, dispatchReq, { params: { id: convId } });
    dispatchRes.assertStatus(200);

    // Verify outbound message was inserted and body contains short link
    const msgRes = await conv.execute({
      sql: `SELECT body, delivery_status FROM messages WHERE conversation_id = ? AND direction = 'OUTBOUND' LIMIT 1`,
      args: [convId],
    });
    assertOk(msgRes.rows[0]);
    assertOk(String(msgRes.rows[0].body).includes("https://ccapl.cc/x7K9pQ"));
  });

  it("safely handles non-existent short code redirects without throwing exceptions (F17)", async () => {
    const req = createTestRequest({
      url: "/l/non_existent_code_999",
      method: "GET",
    });

    const res = await callRoute(lCodeRoute, req, { params: { code: "non_existent_code_999" } });
    assertStrictEqual(res.status, 307);
    const fallbackLocation = res.headers.get("location");
    assertOk(fallbackLocation);
    assertOk(fallbackLocation.includes("classicconcepts.in"));
  });
});
