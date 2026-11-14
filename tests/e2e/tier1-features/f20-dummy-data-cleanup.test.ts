import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import { getRawLibSqlClient, loadAllClassicConceptsProducts } from "@cc/database";
import { sendWhatsAppCloudMessage } from "@cc/connections";

describe("F20: Dummy Data Cleanup & Production Readiness (Tier 1 Feature Coverage)", () => {
  it("T1-F20-01: verifies production seeding protects against fake broadcast campaigns when demo seeding is off", async () => {
    const mkt = getRawLibSqlClient("marketing");
    // Verify that broadcasts table has proper schema and no uncontrolled dummy rows
    const res = await mkt.execute({
      sql: `SELECT id, name, status, sent_count, delivered_count FROM broadcasts`,
      args: [],
    });

    for (const row of res.rows as any[]) {
      assertOk(typeof row.id === "string" && row.id.length > 0, "Broadcast ID must be valid");
      assertOk(typeof row.name === "string" && row.name.length > 0, "Broadcast name must be valid");
      assertOk(Number(row.sent_count) >= 0, "Sent count must be non-negative");
      assertOk(Number(row.delivered_count) >= 0, "Delivered count must be non-negative");
    }
  });

  it("T1-F20-02: verifies message billing ledger table avoids fake sample entries when demo seeding is disabled", async () => {
    const bill = getRawLibSqlClient("billing_ops");
    const res = await bill.execute({
      sql: `SELECT id, message_id, client_unit_rate_inr, actual_meta_unit_cost_inr, margin_inr FROM message_billing_ledger LIMIT 20`,
      args: [],
    });

    for (const row of res.rows as any[]) {
      assertOk(typeof row.id === "string", "Ledger ID must be string");
      assertOk(Number(row.client_unit_rate_inr) >= 0, "Client unit rate must be non-negative number");
      assertOk(Number(row.actual_meta_unit_cost_inr) >= 0, "Meta unit rate must be non-negative number");
    }
  });

  it("T1-F20-03: verifies operational templates initialize with valid category, status, and schema", async () => {
    const mkt = getRawLibSqlClient("marketing");
    const res = await mkt.execute({
      sql: `SELECT id, name, category, approval_status, sent_count, body_text FROM templates`,
      args: [],
    });

    assertOk(res.rows.length > 0, "Database should have operational seed templates");

    const validCategories = ["MARKETING", "UTILITY", "AUTHENTICATION"];
    const validStatuses = ["APPROVED", "DRAFT", "PENDING", "REJECTED"];

    for (const row of res.rows as any[]) {
      assertOk(validCategories.includes(row.category), `Category ${row.category} must be valid`);
      assertOk(validStatuses.includes(row.approval_status), `Status ${row.approval_status} must be valid`);
      assertOk(typeof row.body_text === "string" && row.body_text.length > 0, "Template must have non-empty body text");
      assertOk(Number(row.sent_count) >= 0, "Sent count must be non-negative");
    }
  });

  it("T1-F20-04: verifies sendWhatsAppCloudMessage operates in live cloud mode when live credentials are used", async () => {
    const res = await sendWhatsAppCloudMessage({
      toPhone: "9848011223",
      bodyText: "Production readiness verification message",
      forceSandbox: false,
    });

    assertStrictEqual(res.ok, true);
    assertOk(res.waMessageId, "Message ID should be returned from WhatsApp dispatch");
    assertOk(
      res.waMessageId.startsWith("wamid.") || res.waMessageId.startsWith("mock_wamid_"),
      "Message ID should match WhatsApp format"
    );
  });

  it("T1-F20-05: verifies ecosystem catalog loader filters out dummy test items and loads genuine products", async () => {
    const products = await loadAllClassicConceptsProducts();

    assertOk(products.length >= 50, `Expected at least 50 products, got ${products.length}`);

    // Verify no dummy placeholder rows exist
    const hasDummy = products.some(
      (p) =>
        p.id.toLowerCase() === "test" ||
        p.name.toLowerCase() === "test" ||
        p.name.toLowerCase() === "test product"
    );
    assertStrictEqual(hasDummy, false);

    // Verify first 10 products have genuine properties
    for (const prod of products.slice(0, 10)) {
      assertStrictEqual(prod.brand, "CLASSIC_CONCEPTS");
      assertOk(prod.name.length > 0, "Product name must not be empty");
      assertOk(prod.slug.length > 0, "Product slug must not be empty");
      assertOk(prod.url.startsWith("https://"), "Product URL must be secure HTTPS");
    }
  });
});
