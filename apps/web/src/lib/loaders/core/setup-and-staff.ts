import { listAllStaffAccounts, type AuthenticatedUser } from "@cc/auth";
import { getAcrioKeysStatus } from "@cc/database";
import { canAssignToDev, isDevRole, isSuperAdminCapable } from "@cc/rbac";
import { getCachedSetupStatus, getCurrentUser } from "@/lib/session";

export interface StaffMetricsPayload {
  staffId: string;
  name: string;
  role: string;
  openChats: number;
  waitingChats: number;
  resolvedToday: number;
  resolved7d: number;
  resolved30d: number;
  avgFirstResponseSec: number | null;
  medianFirstResponseSec: number | null;
  repliesToday: number;
  replies7d: number;
  assignments30d: number;
  callbacksDone30d: number;
}

export async function loadSetupPayload() {
  const [setup, user, aiKeys] = await Promise.all([
    getCachedSetupStatus(),
    getCurrentUser(),
    getAcrioKeysStatus(),
  ]);
  const isDev = isDevRole(user?.role);

  const safeFacebookConfig =
    !setup.hasDevAccount || isDev
      ? setup.facebookConfig
      : {
          ...setup.facebookConfig,
          metaAppSecret: setup.facebookConfig.metaAppSecret ? "••••••••" : "",
          systemUserAccessToken: setup.facebookConfig.systemUserAccessToken
            ? "••••••••"
            : "",
        };

  const safeAiKeys =
    !setup.hasDevAccount || isDev
      ? aiKeys
      : {
          clientConnected: aiKeys.clientConnected,
          clientMasked: "",
          clientSource: aiKeys.clientSource,
          adminConnected: aiKeys.adminConnected,
          adminMasked: "",
          adminSource: aiKeys.adminSource,
        };

  return {
    hasDevAccount: setup.hasDevAccount,
    allFacebookStepsDone: setup.allFacebookStepsDone,
    facebookConfig: safeFacebookConfig,
    aiConnected: aiKeys.clientConnected || aiKeys.adminConnected,
    aiMaskedKey: !setup.hasDevAccount || isDev ? aiKeys.clientMasked : "",
    aiKeys: safeAiKeys,
    currentUser: user,
  };
}

export async function loadFullStaffAccountsPayload(user: AuthenticatedUser) {
  const accounts = await listAllStaffAccounts();
  return {
    ok: true as const,
    viewerRole: user.role,
    staff: accounts,
  };
}

export async function loadStaffDirectoryPayload(user: AuthenticatedUser) {
  const accounts = await listAllStaffAccounts();
  if (!isSuperAdminCapable(user.role)) {
    const allowDevAssign = canAssignToDev(user.role);
    return {
      ok: true as const,
      viewerRole: user.role,
      staff: accounts
        .filter(
          (a) =>
            a.status === "ACTIVE" &&
            a.role !== "CLIENT" &&
            (a.role !== "DEV" || allowDevAssign)
        )
        .map((a) => ({
          id: a.id,
          name: a.name,
          email: a.email,
          role: a.role,
          department: a.department,
        })),
    };
  }

  return {
    ok: true as const,
    viewerRole: user.role,
    staff: accounts,
  };
}
