import { NextResponse } from "next/server";
import { isDevRole } from "@cc/rbac";
import {
  executeAcrioEcosystemAutoFix,
  runAcrioEcosystemIssuesIdentifier,
} from "@cc/connections";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "DEV access is required to run Issues Identifier." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const forceFresh = searchParams.get("fresh") === "1";

  try {
    const report = await runAcrioEcosystemIssuesIdentifier({
      forceFreshCatalog: forceFresh,
      actorName: user.name,
    });
    return NextResponse.json({
      ok: true,
      report,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Failed to run ecosystem issues audit.",
      },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "DEV access is required." },
      { status: 403 }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "auto_fix") {
      const fixType =
        body.fixType === "REFRESH_CATALOG_CACHE"
          ? "REFRESH_CATALOG_CACHE"
          : "SYNC_SHORTLINKS";
      const fixRes = await executeAcrioEcosystemAutoFix(fixType, user.name);
      const report = await runAcrioEcosystemIssuesIdentifier({
        forceFreshCatalog: true,
        actorName: user.name,
      });
      return NextResponse.json({
        ok: fixRes.ok,
        message: fixRes.message,
        fixedCount: fixRes.fixedCount,
        report,
      });
    }

    if (action === "ask_acrio") {
      const prompt = String(body.prompt || "").trim();
      if (!prompt) {
        return NextResponse.json(
          { ok: false, error: "Please enter a question or audit prompt for ACRIO." },
          { status: 400 }
        );
      }
      const report = await runAcrioEcosystemIssuesIdentifier({
        askPrompt: prompt,
        forceFreshCatalog: Boolean(body.forceFresh),
        actorName: user.name,
      });
      return NextResponse.json({
        ok: true,
        report,
      });
    }

    return NextResponse.json(
      { ok: false, error: "Invalid action." },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Issues Identifier request failed.",
      },
      { status: 500 }
    );
  }
}
