import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  getSessionUserByToken,
  getSetupStatus,
  type AuthenticatedUser,
} from "@cc/auth";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  ensureBackgroundWorkersRunning();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getSessionUserByToken(token);
}

export async function getAppBootContext() {
  ensureBackgroundWorkersRunning();
  const [setup, user] = await Promise.all([
    getSetupStatus(),
    getCurrentUser(),
  ]);
  return { setup, user };
}
