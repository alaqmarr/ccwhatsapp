import crypto from "node:crypto";
import module from "node:module";
import path from "node:path";
import { getSetupStatus, getSessionUserByToken, type AuthenticatedUser } from "@cc/auth";
import { createTestRequest } from "../harness";

// Global session user state for test executions
let currentTestUser: AuthenticatedUser | null = null;

export function setTestSessionUser(user: AuthenticatedUser | null): void {
  currentTestUser = user;
}

export function getTestSessionUser(): AuthenticatedUser | null {
  return currentTestUser;
}

// Hook Node's Module._resolveFilename so @/ routes resolve cleanly in tests
const originalResolve = (module as any)._resolveFilename;
if (originalResolve && !(globalThis as any).__aliasResolverRegistered) {
  (globalThis as any).__aliasResolverRegistered = true;
  (module as any)._resolveFilename = function (request: string, parent: any, isMain: boolean, options: any) {
    if (request === "@/lib/session" || request === "@/lib/session.ts") {
      // Return custom session hook that doesn't rely on Next's async request store cookies()
      return require.resolve("./tier3-session-shim");
    }
    if (request.startsWith("@/")) {
      const resolvedPath = path.resolve(process.cwd(), "apps/web/src", request.slice(2));
      return originalResolve.call(this, resolvedPath, parent, isMain, options);
    }
    return originalResolve.call(this, request, parent, isMain, options);
  };
}

/**
 * Creates a signed webhook request with valid HMAC-SHA256 signature.
 */
export async function createSignedWebhookRequest(body: unknown): Promise<Request> {
  const setup = await getSetupStatus();
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);
  const secret = setup.facebookConfig.metaAppSecret;
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (secret) {
    const hmac = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
    headers["x-hub-signature-256"] = `sha256=${hmac}`;
  }
  return createTestRequest({
    url: "/api/webhooks/whatsapp",
    method: "POST",
    headers,
    body: rawBody,
  });
}

let phoneCounter = 1000;
export function generateUniquePhone(): string {
  phoneCounter++;
  return `+919848${String(phoneCounter).padStart(6, "0")}`;
}
