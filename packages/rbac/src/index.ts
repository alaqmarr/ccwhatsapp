export type UserRole =
  | "DEV"
  | "SUPERADMIN"
  | "MANAGER"
  | "ADMIN"
  | "STAFF"
  | "CLIENT";

export type AccountStatus =
  | "UNVERIFIED_EMAIL"
  | "PENDING_APPROVAL"
  | "ACTIVE"
  | "REJECTED"
  | "SUSPENDED";

export type Permission =
  // Staff / Agent permissions
  | "onboarding:view"
  | "inbox:view"
  | "inbox:reply"
  | "inbox:smart_resolve"
  | "enquiries:view"
  | "enquiries:reply"
  | "acrio:use_chat_copilot"
  | "crm:view_customer_360"
  | "crm:manage_orders_notes"
  | "contacts:view"
  | "contacts:manage"
  | "contacts:delete"
  | "links:use_custom_links"
  // Admin permissions
  | "inbox:assign_chats"
  | "analytics:view"
  | "links:manage_custom_links"
  | "marketing:manage_lists"
  | "marketing:send_broadcasts"
  | "automations:manage"
  | "billing:view_client_pricing"
  // Superadmin permissions (DEV also inherits ALL of these!)
  | "staff:approve_accounts"
  | "staff:manage_roles"
  | "templates:manage"
  | "settings:organization"
  // Exclusive DEV permissions
  | "billing:view_actual_meta_cost"
  | "billing:configure_set_pricing"
  | "dev:setup_facebook_api"
  | "dev:configure_gdrive_backup"
  | "dev:inspect_databases_queues";

const STAFF_PERMISSIONS: Permission[] = [
  "onboarding:view",
  "inbox:view",
  "inbox:reply",
  "inbox:smart_resolve",
  "enquiries:view",
  "enquiries:reply",
  "analytics:view",
  "acrio:use_chat_copilot",
  "crm:view_customer_360",
  "crm:manage_orders_notes",
  "contacts:view",
  "contacts:manage",
  "links:use_custom_links",
];

const ADMIN_PERMISSIONS: Permission[] = [
  ...STAFF_PERMISSIONS,
  "contacts:delete",
  "inbox:assign_chats",
  "links:manage_custom_links",
  "marketing:manage_lists",
  "marketing:send_broadcasts",
  "automations:manage",
  "templates:manage",
];

const MANAGER_PERMISSIONS: Permission[] = [
  ...ADMIN_PERMISSIONS,
  "settings:organization",
];

const SUPERADMIN_PERMISSIONS: Permission[] = [
  ...ADMIN_PERMISSIONS,
  "billing:view_client_pricing",
  "staff:approve_accounts",
  "staff:manage_roles",
  "templates:manage",
  "settings:organization",
];

/**
 * DEV is a distinct role from SUPERADMIN, AND every DEV is also a SUPERADMIN
 * (inherits 100% of SUPERADMIN_PERMISSIONS plus exclusive DEV infrastructure/cost permissions).
 */
const DEV_PERMISSIONS: Permission[] = [
  ...SUPERADMIN_PERMISSIONS,
  "billing:view_actual_meta_cost",
  "billing:configure_set_pricing",
  "dev:setup_facebook_api",
  "dev:configure_gdrive_backup",
  "dev:inspect_databases_queues",
];

const CLIENT_PERMISSIONS: Permission[] = [
  "onboarding:view",
  "analytics:view",
];

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  STAFF: new Set(STAFF_PERMISSIONS),
  ADMIN: new Set(ADMIN_PERMISSIONS),
  MANAGER: new Set(MANAGER_PERMISSIONS),
  SUPERADMIN: new Set(SUPERADMIN_PERMISSIONS),
  DEV: new Set(DEV_PERMISSIONS),
  CLIENT: new Set(CLIENT_PERMISSIONS),
};

export const ROLE_LABELS: Record<UserRole, string> = {
  DEV: "Developer (Superadmin + Dev Ops)",
  SUPERADMIN: "Superadmin",
  MANAGER: "Manager",
  ADMIN: "Operations Admin",
  STAFF: "WhatsApp Staff Agent",
  CLIENT: "Client Billing Viewer",
};

export function hasPermission(
  role: UserRole | null | undefined,
  permission: Permission,
  status: AccountStatus = "ACTIVE"
): boolean {
  if (!role) return false;
  if (status !== "ACTIVE") {
    return permission === "onboarding:view";
  }
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function isDevRole(role: UserRole | null | undefined): boolean {
  return role === "DEV";
}

/**
 * Both SUPERADMIN and DEV act as Superadmins (e.g. approving staff accounts, managing roles).
 */
export function isSuperAdminCapable(role: UserRole | null | undefined): boolean {
  return role === "SUPERADMIN" || role === "DEV";
}

export function canApproveStaff(
  approverRole: UserRole,
  targetDesiredRole: UserRole
): boolean {
  if (!isSuperAdminCapable(approverRole)) return false;
  // Only a DEV can create, approve, or modify another DEV
  if (targetDesiredRole === "DEV" && approverRole !== "DEV") return false;
  return true;
}

/**
 * DEV accounts are NEVER auto-assigned by round-robin/escalation, and regular STAFF/ADMIN
 * cannot manually assign chats to DEV. Only MANAGER, SUPERADMIN, and DEV can assign chats to DEV
 * (or DEV auto-assigns to themselves when replying inside a chat).
 */
export function canAssignToDev(role: UserRole | string | null | undefined): boolean {
  return role === "DEV" || role === "SUPERADMIN" || role === "MANAGER";
}

/**
 * Cost Breakdown is visible only to SUPERADMIN and DEV (never regular staff/admin/manager).
 * Actual Meta wholesale cost & profit/margin remain strictly reserved for DEV.
 */
export function canViewCostBreakdown(role: UserRole | string | null | undefined): boolean {
  return role === "DEV" || role === "SUPERADMIN";
}

/**
 * Pricing visibility mode:
 * - "dev_actual_and_margin": Shows Meta's actual wholesale rate, Classic Concepts set rate (0.95 / 0.30), and net margin.
 * - "client_set_pricing": Shows ONLY Classic Concepts' configured rate (₹0.95 marketing, ₹0.30 utility/auth/service).
 */
export function getPricingDashboardMode(
  role: UserRole | null | undefined
): "dev_actual_and_margin" | "client_set_pricing" {
  return role === "DEV" ? "dev_actual_and_margin" : "client_set_pricing";
}

export const ALLOWED_STAFF_EMAIL_DOMAINS: readonly string[] = [];

/**
 * Accepts any valid email address (staff do not need a @classicconcepts.in domain).
 */
export function isAllowedStaffEmail(email: string, _extraDomains: string[] = []): boolean {
  const clean = email.trim().toLowerCase();
  if (clean.length < 5 || clean.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean);
}

export function normalizeWhatsAppNumber(raw: string): {
  valid: boolean;
  e164: string;
  digits: string;
  error?: string;
} {
  const digitsOnly = raw.replace(/\D/g, "");
  if (digitsOnly.length === 10 && /^[6-9]\d{9}$/.test(digitsOnly)) {
    return {
      valid: true,
      digits: `91${digitsOnly}`,
      e164: `+91${digitsOnly}`,
    };
  }
  if (digitsOnly.length >= 11 && digitsOnly.length <= 15) {
    return {
      valid: true,
      digits: digitsOnly,
      e164: `+${digitsOnly}`,
    };
  }
  return {
    valid: false,
    e164: "",
    digits: "",
    error: "Enter a valid WhatsApp number with country code (for example +91 98765 43210).",
  };
}
