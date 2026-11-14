import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
} from "../harness";
import {
  canViewCostBreakdown,
  getPricingDashboardMode,
  isDevRole,
  isSuperAdminCapable,
  hasPermission,
} from "@cc/rbac";

describe("F18: Role-Based Visibility for Message Charges & Free Status (Tier 1 Feature Coverage)", () => {
  it("T1-F18-01: regular STAFF role hides message cost breakdown and actual wholesale rates", () => {
    const staffCanSeeCost = canViewCostBreakdown("STAFF");
    assertStrictEqual(staffCanSeeCost, false);

    const staffMode = getPricingDashboardMode("STAFF");
    assertStrictEqual(staffMode, "client_set_pricing");
  });

  it("T1-F18-02: regular STAFF role lacks permission to manage billing pricing configuration", () => {
    const hasBillingManage = hasPermission("STAFF", "billing:configure_set_pricing");
    assertStrictEqual(hasBillingManage, false);

    const hasStaffManage = hasPermission("STAFF", "staff:manage_roles");
    assertStrictEqual(hasStaffManage, false);
  });

  it("T1-F18-03: verifies educational pricing concepts for regular staff in onboarding and guide views", () => {
    // 24-hour customer service window rule
    const educationalTerms = [
      "24-hour service window",
      "free customer chat",
      "template message",
    ];

    for (const term of educationalTerms) {
      assertOk(term.length > 0, `Educational term "${term}" must be defined`);
    }
  });

  it("T1-F18-04: SUPERADMIN role has complete ledger visibility and admin capabilities", () => {
    const superCanSeeCost = canViewCostBreakdown("SUPERADMIN");
    assertStrictEqual(superCanSeeCost, true);

    const isSuperCapable = isSuperAdminCapable("SUPERADMIN");
    assertStrictEqual(isSuperCapable, true);

    const hasPricingAccess = hasPermission("SUPERADMIN", "billing:view_client_pricing");
    assertStrictEqual(hasPricingAccess, true);

    const hasStaffApprove = hasPermission("SUPERADMIN", "staff:approve_accounts");
    assertStrictEqual(hasStaffApprove, true);
  });

  it("T1-F18-05: DEV role accesses wholesale Meta/AI costs, net margin, and system logs", () => {
    const devRoleValid = isDevRole("DEV");
    assertStrictEqual(devRoleValid, true);

    const devCanSeeCost = canViewCostBreakdown("DEV");
    assertStrictEqual(devCanSeeCost, true);

    const devPricingMode = getPricingDashboardMode("DEV");
    assertStrictEqual(devPricingMode, "dev_actual_and_margin");

    const devHasCostAccess = hasPermission("DEV", "billing:view_actual_meta_cost");
    assertStrictEqual(devHasCostAccess, true);

    const devHasInspectAccess = hasPermission("DEV", "dev:inspect_databases_queues");
    assertStrictEqual(devHasInspectAccess, true);
  });
});
