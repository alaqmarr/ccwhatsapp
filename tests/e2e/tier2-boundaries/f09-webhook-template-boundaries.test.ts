import crypto from "node:crypto";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import * as whatsappWebhookRoute from "../../../apps/web/src/app/api/webhooks/whatsapp/route";

function createSignedWebhookRequest(body: unknown, secret = "c8d985700cd2266bc184703d329722e7") {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  return createTestRequest({
    url: "/api/webhooks/whatsapp",
    method: "POST",
    body: rawBody,
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": sig,
    },
  });
}

describe("F09: Webhook Template Status Updates - Boundary & Corner Cases", () => {
  it("empty string meta_template_id does NOT match or overwrite draft templates", async () => {
    const mkt = getRawLibSqlClient("marketing");

    // Insert a draft template with empty meta_template_id
    const draftTplId = `tpl_draft_${Date.now()}`;
    await mkt.execute({
      sql: `INSERT INTO templates (id, name, category, language, body_text, meta_template_id, approval_status, created_at, updated_at)
            VALUES (?, 'draft_unlinked_notice', 'UTILITY', 'en_US', 'Your order is confirmed.', '', 'DRAFT', datetime('now'), datetime('now'))`,
      args: [draftTplId],
    });

    // Webhook fires with empty message_template_id and empty name
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: "",
                message_template_name: "",
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    // Verify draft template was NOT overwritten
    const checkRes = await mkt.execute({
      sql: `SELECT approval_status FROM templates WHERE id = ?`,
      args: [draftTplId],
    });

    assertStrictEqual(checkRes.rows[0].approval_status, "DRAFT", "Draft template must remain DRAFT");
  });

  it("matches template by name when meta_template_id was not yet set in database", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const tplId = `tpl_sync_${Date.now()}`;
    const tplName = `quote_approved_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO templates (id, name, category, language, body_text, meta_template_id, approval_status, created_at, updated_at)
            VALUES (?, ?, 'UTILITY', 'en_US', 'Quote details {{1}}', '', 'DRAFT', datetime('now'), datetime('now'))`,
      args: [tplId, tplName],
    });

    const metaAssignedId = `meta_tpl_id_${Date.now()}`;
    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "APPROVED",
                message_template_id: metaAssignedId,
                message_template_name: tplName,
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const checkRes = await mkt.execute({
      sql: `SELECT approval_status, meta_template_id FROM templates WHERE id = ?`,
      args: [tplId],
    });

    assertStrictEqual(checkRes.rows[0].approval_status, "APPROVED");
    assertStrictEqual(checkRes.rows[0].meta_template_id, metaAssignedId);
  });

  it("handles unknown or non-standard status events gracefully", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const tplId = `tpl_unknown_evt_${Date.now()}`;
    const metaId = `meta_evt_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO templates (id, name, category, language, body_text, meta_template_id, approval_status, created_at, updated_at)
            VALUES (?, 'unknown_status_tpl', 'UTILITY', 'en_US', 'Body text', ?, 'DRAFT', datetime('now'), datetime('now'))`,
      args: [tplId, metaId],
    });

    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "CUSTOM_UNKNOWN_STATE",
                message_template_id: metaId,
                message_template_name: "unknown_status_tpl",
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const checkRes = await mkt.execute({
      sql: `SELECT approval_status FROM templates WHERE id = ?`,
      args: [tplId],
    });

    // Safe fallback status
    assertStrictEqual(checkRes.rows[0].approval_status, "PENDING_APPROVAL");
  });

  it("handles rejected template event with empty or null reason string", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const tplId = `tpl_rej_${Date.now()}`;
    const metaId = `meta_rej_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO templates (id, name, category, language, body_text, meta_template_id, approval_status, created_at, updated_at)
            VALUES (?, 'rejected_tpl', 'MARKETING', 'en_US', 'Promo body text', ?, 'DRAFT', datetime('now'), datetime('now'))`,
      args: [tplId, metaId],
    });

    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "REJECTED",
                message_template_id: metaId,
                message_template_name: "rejected_tpl",
                reason: "NONE", // Meta sometimes sends "NONE"
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const checkRes = await mkt.execute({
      sql: `SELECT approval_status, rejection_reason FROM templates WHERE id = ?`,
      args: [tplId],
    });

    assertStrictEqual(checkRes.rows[0].approval_status, "REJECTED");
    assertStrictEqual(checkRes.rows[0].rejection_reason, null);
  });

  it("case-insensitive and trimmed name matching for status events", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const tplId = `tpl_case_${Date.now()}`;

    await mkt.execute({
      sql: `INSERT INTO templates (id, name, category, language, body_text, meta_template_id, approval_status, created_at, updated_at)
            VALUES (?, 'order_ready_notice', 'UTILITY', 'en_US', 'Your acrylic order is ready', '', 'DRAFT', datetime('now'), datetime('now'))`,
      args: [tplId],
    });

    const payload = {
      entry: [
        {
          changes: [
            {
              field: "message_template_status_update",
              value: {
                event: "PAUSED",
                message_template_id: `meta_paused_${Date.now()}`,
                message_template_name: "  ORDER_READY_NOTICE  ", // Uppercase + whitespace
              },
            },
          ],
        },
      ],
    };

    const req = createSignedWebhookRequest(payload);

    const res = await callRoute(whatsappWebhookRoute, req);
    res.assertStatus(200);

    const checkRes = await mkt.execute({
      sql: `SELECT approval_status FROM templates WHERE id = ?`,
      args: [tplId],
    });

    assertStrictEqual(checkRes.rows[0].approval_status, "PAUSED");
  });
});
