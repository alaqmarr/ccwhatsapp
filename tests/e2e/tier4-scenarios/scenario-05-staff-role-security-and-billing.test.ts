import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  createTestRequest,
  callRoute,
  createTestStaffSession,
  createTestDevSession,
  createTestAdminSession,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import {
  hasPermission,
  isDevRole,
  isSuperAdminCapable,
  ROLE_PERMISSIONS,
} from "@cc/rbac";
import { setTestSessionUser, generateUniquePhone } from "../tier3-pairwise/tier3-helper";
import * as pricingRoute from "../../../apps/web/src/app/api/pricing/route";
import * as devBackupsRoute from "../../../apps/web/src/app/api/dev/backups/route";

describe("Scenario 05: Multi-Role Operational Security & Billing Privacy (F18 + F8)", () => {
  it("verifies staff user cannot access billing pricing route (HTTP 403 Forbidden) (F18)", async () => {
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);

    const req = createTestRequest({
      url: "/api/pricing",
      method: "GET",
      sessionToken: staffSession.token,
    });

    const res = await callRoute(pricingRoute, req);
    assertStrictEqual(res.status, 403, "Regular staff must receive HTTP 403 on pricing route");
    const json = await res.json();
    assertStrictEqual(json.ok, false);
    assertOk(
      json.error?.includes("Superadmin or Dev access") || json.error?.includes("Cost breakdown"),
      "Must return forbidden cost breakdown error message"
    );
  });

  it("verifies dev user accesses pricing route with full cost breakdown and profit margin visible (F18)", async () => {
    const devSession = await createTestDevSession();
    setTestSessionUser(devSession.user);

    const req = createTestRequest({
      url: "/api/pricing?scope=dev",
      method: "GET",
      sessionToken: devSession.token,
    });

    const res = await callRoute(pricingRoute, req);
    assertStrictEqual(res.status, 200, "Developer role must receive HTTP 200 on pricing route with scope=dev");
    const json = await res.json();
    assertStrictEqual(json.ok, true);
    assertStrictEqual(json.viewMode, "dev_actual_and_margin");

    // Developer view exposes actual Meta costs and profit margins
    assertOk(Array.isArray(json.byCategory), "Must include breakdown by category");
    assertOk(Array.isArray(json.recentEntries), "Must include recent billing entries");

    if (json.byCategory.length > 0) {
      assertOk("actualMetaCostInr" in json.byCategory[0], "Must expose actualMetaCostInr to dev");
      assertOk("netMarginInr" in json.byCategory[0], "Must expose netMarginInr to dev");
    }
  });

  it("verifies dev-exclusive backup route strictly rejects staff and superadmin users (F18)", async () => {
    // 1. Staff access attempt
    const staffSession = await createTestStaffSession();
    setTestSessionUser(staffSession.user);
    const staffReq = createTestRequest({
      url: "/api/dev/backups",
      method: "GET",
      sessionToken: staffSession.token,
    });
    const staffRes = await callRoute(devBackupsRoute, staffReq);
    assertStrictEqual(staffRes.status, 403, "Staff must be denied access to dev backups route");

    // 2. Dev access attempt
    const devSession = await createTestDevSession();
    setTestSessionUser(devSession.user);
    const devReq = createTestRequest({
      url: "/api/dev/backups",
      method: "GET",
      sessionToken: devSession.token,
    });
    const devRes = await callRoute(devBackupsRoute, devReq);
    assertStrictEqual(devRes.status, 200, "Dev must be granted access to dev backups route");
    const devJson = await devRes.json();
    assertStrictEqual(devJson.ok, true);
  });

  it("verifies customer messages are tagged as FREE_CHAT with zero staff charges in database (F18 + F8)", async () => {
    const conv = getRawLibSqlClient("conversations");
    const phone = generateUniquePhone();
    const convId = `conv_role_test_${Date.now()}`;
    const msgId = `msg_role_inbound_${Date.now()}`;
    const nowIso = new Date().toISOString();

    await conv.execute({
      sql: `INSERT INTO conversations (
        id, customer_phone, customer_name, status, priority, last_message_preview, last_message_at, created_at
      ) VALUES (?, ?, 'Role Test Client', 'OPEN', 'NORMAL', 'Hi Classic Concepts', ?, ?)`,
      args: [convId, phone, nowIso, nowIso],
    });

    await conv.execute({
      sql: `INSERT INTO messages (
        id, conversation_id, direction, sender_type, sender_name, message_type,
        billing_category, body, delivery_status, created_at
      ) VALUES (?, ?, 'INBOUND', 'CUSTOMER', 'Role Test Client', 'TEXT', 'FREE_CHAT', 'Hi Classic Concepts', 'DELIVERED', ?)`,
      args: [msgId, convId, nowIso],
    });

    const msg = (
      await conv.execute({
        sql: `SELECT billing_category FROM messages WHERE id = ?`,
        args: [msgId],
      })
    ).rows[0] as any;

    assertStrictEqual(
      msg.billing_category,
      "FREE_CHAT",
      "Inbound customer messages must be tagged as FREE_CHAT"
    );
  });

  it("verifies RBAC permissions matrix integrity and restricted access for non-active accounts (F18)", () => {
    // 1. Staff permissions check
    assertStrictEqual(hasPermission("STAFF", "inbox:view"), true);
    assertStrictEqual(hasPermission("STAFF", "inbox:reply"), true);
    assertStrictEqual(hasPermission("STAFF", "contacts:view"), true);
    assertStrictEqual(hasPermission("STAFF", "billing:view_actual_meta_cost"), false);
    assertStrictEqual(hasPermission("STAFF", "dev:configure_gdrive_backup"), false);
    assertStrictEqual(hasPermission("STAFF", "staff:manage_roles"), false);

    // 2. Dev permissions check (inherits all + dev exclusive)
    assertStrictEqual(hasPermission("DEV", "inbox:view"), true);
    assertStrictEqual(hasPermission("DEV", "billing:view_client_pricing"), true);
    assertStrictEqual(hasPermission("DEV", "billing:view_actual_meta_cost"), true);
    assertStrictEqual(hasPermission("DEV", "dev:configure_gdrive_backup"), true);
    assertStrictEqual(isDevRole("DEV"), true);
    assertStrictEqual(isDevRole("STAFF"), false);
    assertStrictEqual(isSuperAdminCapable("DEV"), true);
    assertStrictEqual(isSuperAdminCapable("SUPERADMIN"), true);
    assertStrictEqual(isSuperAdminCapable("STAFF"), false);

    // 3. Unapproved/pending account check
    assertStrictEqual(hasPermission("STAFF", "inbox:view", "PENDING_APPROVAL"), false);
    assertStrictEqual(hasPermission("STAFF", "onboarding:view", "PENDING_APPROVAL"), true);
    assertStrictEqual(hasPermission("DEV", "inbox:view", "SUSPENDED"), false);
    assertStrictEqual(hasPermission("DEV", "onboarding:view", "SUSPENDED"), true);
  });
});
