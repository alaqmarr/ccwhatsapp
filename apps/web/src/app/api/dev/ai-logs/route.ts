import { NextResponse } from "next/server";
import { isDevRole } from "@cc/rbac";
import {
  clearAiTraceLogs,
  readAiTraceLogs,
  readRawAiLogFile,
} from "@cc/database";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "DEV access is required to view ai.logs." },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "").toLowerCase();
  const download = searchParams.get("download") === "1";

  if (format === "raw" || download) {
    const raw = readRawAiLogFile();
    return new NextResponse(raw.content, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...(download
          ? { "Content-Disposition": 'attachment; filename="ai.logs"' }
          : {}),
      },
    });
  }

  const website = searchParams.get("website") || "ALL";
  const outcome = searchParams.get("outcome") || "ALL";
  const cache = searchParams.get("cache") || "ALL";
  const search = searchParams.get("search") || "";
  const limit = Number(searchParams.get("limit") || "150");

  const summary = readAiTraceLogs({
    website,
    outcome,
    cache,
    search,
    limit: Number.isFinite(limit) ? limit : 150,
  });

  return NextResponse.json({
    ok: true,
    ...summary,
  });
}

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    return NextResponse.json(
      { ok: false, error: "DEV access is required to clear ai.logs." },
      { status: 403 }
    );
  }

  const cleared = clearAiTraceLogs();
  return NextResponse.json({
    ok: true,
    filePath: cleared.filePath,
  });
}
