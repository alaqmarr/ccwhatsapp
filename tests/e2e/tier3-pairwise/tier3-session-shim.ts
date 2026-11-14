import { getTestSessionUser } from "./tier3-helper";
import { getSetupStatus, type AuthenticatedUser } from "@cc/auth";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  ensureBackgroundWorkersRunning();
  return getTestSessionUser();
}

export async function getAppBootContext() {
  ensureBackgroundWorkersRunning();
  const [setup, user] = await Promise.all([
    getSetupStatus(),
    getCurrentUser(),
  ]);
  return { setup, user };
}
