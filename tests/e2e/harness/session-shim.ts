import { AsyncLocalStorage } from "node:async_hooks";
import { getSessionUserByToken, type AuthenticatedUser } from "@cc/auth";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export const sessionContextStorage = new AsyncLocalStorage<AuthenticatedUser | null>();
let manualTestUser: AuthenticatedUser | null = null;

export function setTestSessionUser(user: AuthenticatedUser | null): void {
  manualTestUser = user;
}

export function getTestSessionUser(): AuthenticatedUser | null {
  return manualTestUser;
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  ensureBackgroundWorkersRunning();
  const contextUser = sessionContextStorage.getStore();
  if (contextUser !== undefined) {
    return contextUser;
  }
  return manualTestUser;
}

export async function getAppBootContext() {
  ensureBackgroundWorkersRunning();
  const user = await getCurrentUser();
  return { setup: null, user };
}
