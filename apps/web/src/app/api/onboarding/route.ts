import { NextResponse } from "next/server";
import { recordOnboardingStep } from "@cc/auth";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const updated = await recordOnboardingStep({
    userId: user.id,
    stepId: String(body.stepId || ""),
    markAllComplete: Boolean(body.markAllComplete),
  });

  return NextResponse.json({ ok: true, user: updated });
}
