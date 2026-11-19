import { NextResponse } from "next/server";
import { isDevRole } from "@cc/rbac";
import {
  getClaudeUsageAndSpendComparison,
  saveAnthropicBillingConfigToDb,
} from "@cc/connections";
import { loadClaudeUsagePayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: "DEV access is required to view Claude API Usage & Spend.",
      },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const preset = searchParams.get("preset") || "mtd";
  const startingAt = searchParams.get("starting_at") || null;
  const endingAt = searchParams.get("ending_at") || null;
  const forceRefresh = searchParams.get("refresh") === "1";

  try {
    const report = await loadClaudeUsagePayload({
      preset,
      startingAt,
      endingAt,
      forceRefresh,
    });
    return NextResponse.json(report, {
      status: 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err?.message || "Failed to load Claude API usage & spend report.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    return NextResponse.json(
      {
        ok: false,
        error: "DEV access is required to configure Claude API Usage & Spend.",
      },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    await saveAnthropicBillingConfigToDb({
      ANTHROPIC_ORG_ADMIN_API_KEY: body.sharedOrgAdminApiKey,
      ACRIO_ANTHROPIC_ORG_ADMIN_API_KEY: body.acrioAdminApiKey,
      ACRO_ANTHROPIC_ORG_ADMIN_API_KEY: body.acroAdminApiKey,
      ACRIO_ANTHROPIC_WORKSPACE_ID: body.acrioWorkspaceId,
      ACRO_ANTHROPIC_WORKSPACE_ID: body.acroWorkspaceId,
      ACRIO_ANTHROPIC_API_KEY_ID: body.acrioApiKeyId,
      ACRO_ANTHROPIC_API_KEY_ID: body.acroApiKeyId,
      ACRIO_WORKSPACE_SHARED_WITH_OTHER_INTEGRATIONS:
        body.acrioWorkspaceSharedWithOthers,
      ACRO_WORKSPACE_SHARED_WITH_OTHER_INTEGRATIONS:
        body.acroWorkspaceSharedWithOthers,
    });

    const report = await getClaudeUsageAndSpendComparison({
      preset: body.preset || "mtd",
      startingAt: body.startingAt || null,
      endingAt: body.endingAt || null,
      forceRefresh: true,
    });
    return NextResponse.json(report);
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Failed to save Anthropic billing configuration.",
      },
      { status: 500 }
    );
  }
}
