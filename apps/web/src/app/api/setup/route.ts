import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  createInitialDevAccount,
  getSetupStatus,
  saveFacebookWhatsAppConfig,
} from "@cc/auth";
import {
  getAcrioKeysStatus,
  saveSharedAnthropicApiKey,
} from "@cc/database";
import { isDevRole } from "@cc/rbac";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const [setup, user, aiKeys] = await Promise.all([
    getSetupStatus(),
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

  return NextResponse.json({
    hasDevAccount: setup.hasDevAccount,
    allFacebookStepsDone: setup.allFacebookStepsDone,
    facebookConfig: safeFacebookConfig,
    aiConnected: aiKeys.clientConnected || aiKeys.adminConnected,
    aiMaskedKey: aiKeys.clientMasked,
    aiKeys,
    currentUser: user,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "create_dev");

  if (action === "create_dev") {
    const result = await createInitialDevAccount({
      name: String(body.name || ""),
      email: String(body.email || ""),
      whatsappNumber: String(body.whatsappNumber || ""),
      password: String(body.password || ""),
      facebookConfig: body.facebookConfig,
    });

    if (!result.ok || !result.sessionToken) {
      return NextResponse.json(
        { ok: false, error: result.error || "Could not create DEV account." },
        { status: 400 }
      );
    }

    if (typeof body.anthropicApiKey === "string" && body.anthropicApiKey.trim()) {
      await saveSharedAnthropicApiKey(
        body.anthropicApiKey.trim(),
        typeof body.anthropicAdminApiKey === "string" && body.anthropicAdminApiKey.trim()
          ? body.anthropicAdminApiKey.trim()
          : undefined
      );
    }

    const res = NextResponse.json({ ok: true, user: result.user });
    res.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 14 * 24 * 60 * 60,
    });
    return res;
  }

  if (action === "update_facebook") {
    const setup = await getSetupStatus();
    const user = await getCurrentUser();
    if (setup.hasDevAccount && !isDevRole(user?.role)) {
      return NextResponse.json(
        { ok: false, error: "Only a DEV account can modify Facebook Cloud API setup." },
        { status: 403 }
      );
    }

    const updated = await saveFacebookWhatsAppConfig(body.facebookConfig || {});
    if (typeof body.anthropicApiKey === "string" && body.anthropicApiKey.trim()) {
      await saveSharedAnthropicApiKey(
        body.anthropicApiKey.trim(),
        typeof body.anthropicAdminApiKey === "string" && body.anthropicAdminApiKey.trim()
          ? body.anthropicAdminApiKey.trim()
          : undefined
      );
    }
    return NextResponse.json({ ok: true, facebookConfig: updated });
  }

  return NextResponse.json({ ok: false, error: "Invalid setup action." }, { status: 400 });
}
