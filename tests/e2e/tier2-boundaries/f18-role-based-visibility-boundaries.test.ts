import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import {
  canViewCostBreakdown,
  isDevRole,
  isSuperAdminCapable,
  hasPermission,
  canAssignToDev,
} from "@cc/rbac";

describe("F18: Role-Based Visibility & Access Controls - Boundary & Corner Cases", () => {
  it("regular staff is strictly prohibited from viewing cost breakdown or message charges", () => {
    // Message charges and profit margins must be hidden from regular staff
    const staffCanViewCosts = canViewCostBreakdown("STAFF");
    assertStrictEqual(staffCanViewCosts, false);

    // Regular staff must not have client pricing view permission
    const staffBillingPerm = hasPermission("STAFF", "billing:view_client_pricing", "ACTIVE");
    assertStrictEqual(staffBillingPerm, false);

    // Regular staff must not have actual meta cost view permission
    const staffMetaCostPerm = hasPermission("STAFF", "billing:view_actual_meta_cost", "ACTIVE");
    assertStrictEqual(staffMetaCostPerm, false);
  });

  it("superadmin role has full cost visibility and superadmin capability", () => {
    const adminCanViewCosts = canViewCostBreakdown("SUPERADMIN");
    assertStrictEqual(adminCanViewCosts, true);

    const isSuperAdmin = isSuperAdminCapable("SUPERADMIN");
    assertStrictEqual(isSuperAdmin, true);

    const adminBillingPerm = hasPermission("SUPERADMIN", "billing:view_client_pricing", "ACTIVE");
    assertStrictEqual(adminBillingPerm, true);
  });

  it("staff attempting to access dev routes is blocked", () => {
    // Staff cannot perform dev actions or access system internals
    const staffIsDev = isDevRole("STAFF");
    assertStrictEqual(staffIsDev, false);

    const devPerm = hasPermission("STAFF", "dev:inspect_databases_queues", "ACTIVE");
    assertStrictEqual(devPerm, false);

    const assignToDevPerm = canAssignToDev("STAFF");
    assertStrictEqual(assignToDevPerm, false);
  });

  it("dev role is enabled for development and system observability routes", () => {
    const devIsDev = isDevRole("DEV");
    assertStrictEqual(devIsDev, true);

    const devPerm = hasPermission("DEV", "dev:inspect_databases_queues", "ACTIVE");
    assertStrictEqual(devPerm, true);

    const devMetaCost = hasPermission("DEV", "billing:view_actual_meta_cost", "ACTIVE");
    assertStrictEqual(devMetaCost, true);
  });

  it("inactive or suspended user accounts are denied permissions across all operational routes", () => {
    // Suspended staff
    const suspendedInbox = hasPermission("STAFF", "inbox:view", "SUSPENDED");
    assertStrictEqual(suspendedInbox, false);

    // Pending approval staff
    const pendingInbox = hasPermission("STAFF", "inbox:view", "PENDING_APPROVAL");
    assertStrictEqual(pendingInbox, false);

    // Inactive admin cannot view billing
    const inactiveBilling = hasPermission("SUPERADMIN", "billing:view_client_pricing", "INACTIVE");
    assertStrictEqual(inactiveBilling, false);
  });
});
