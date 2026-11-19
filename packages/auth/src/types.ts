import type { AccountStatus, UserRole } from "@cc/rbac";

export const SESSION_COOKIE_NAME = "ccwa_session";

export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: UserRole;
  status: AccountStatus;
  department: string;
  emailVerifiedAt: string | null;
  onboardingCompletedAt: string | null;
  onboardingSteps: string[];
  approvedByName: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  assignmentsEnabled: boolean;
  createdAt: string;
}

export interface FacebookWhatsAppSetupConfig {
  mode: "SANDBOX_SIMULATOR" | "LIVE_META_CLOUD";
  businessPortfolioId?: string;
  verifiedName?: string;
  metaAppId: string;
  metaAppSecret: string;
  wabaId: string;
  phoneNumberId: string;
  businessDisplayPhone: string;
  systemUserAccessToken: string;
  webhookVerifyToken: string;
  stepsCompleted: {
    metaBusinessVerified: boolean;
    whatsappAppCreated: boolean;
    phoneRegistered: boolean;
    webhookSubscribed: boolean;
    systemTokenSaved: boolean;
  };
}

export function mapUserRow(r: Record<string, unknown>): AuthenticatedUser {
  let steps: string[] = [];
  try {
    const parsed = JSON.parse(String(r.onboarding_progress_json || "[]"));
    if (Array.isArray(parsed)) steps = parsed.map(String);
  } catch {
    steps = [];
  }
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email),
    whatsappNumber: String(r.whatsapp_number),
    role: String(r.role) as UserRole,
    status: String(r.status) as AccountStatus,
    department: String(r.department || "Sales & Support"),
    emailVerifiedAt: r.email_verified_at ? String(r.email_verified_at) : null,
    onboardingCompletedAt: r.onboarding_completed_at
      ? String(r.onboarding_completed_at)
      : null,
    onboardingSteps: steps,
    approvedByName: r.approved_by_name ? String(r.approved_by_name) : null,
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    rejectionReason: r.rejection_reason ? String(r.rejection_reason) : null,
    assignmentsEnabled: Number(r.assignments_enabled ?? 1) !== 0,
    createdAt: String(r.created_at),
  };
}
