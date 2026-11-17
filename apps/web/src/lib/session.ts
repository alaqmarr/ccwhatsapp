import { cache } from "react";
import { cookies } from "next/headers";
import {
  SESSION_COOKIE_NAME,
  getSessionUserByToken,
  getSetupStatus,
  type AuthenticatedUser,
} from "@cc/auth";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export const getCachedSetupStatus = cache(async () => {
  ensureBackgroundWorkersRunning();
  return getSetupStatus();
});

export const getCurrentUser = cache(async (): Promise<AuthenticatedUser | null> => {
  ensureBackgroundWorkersRunning();
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  return getSessionUserByToken(token);
});

export const getAppBootContext = cache(async () => {
  ensureBackgroundWorkersRunning();
  const [setup, user] = await Promise.all([
    getCachedSetupStatus(),
    getCurrentUser(),
  ]);
  return { setup, user };
});
