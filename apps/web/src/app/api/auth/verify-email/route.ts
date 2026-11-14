import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifyStaffEmailOtp } from "@cc/auth";
import { socketHub } from "@cc/sockets";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await verifyStaffEmailOtp({
    email: String(body.email || ""),
    otpCode: String(body.otpCode || ""),
  });

  if (!result.ok || !result.sessionToken) {
    return NextResponse.json(
      { ok: false, error: result.error || "Verification failed." },
      { status: 400 }
    );
  }

  socketHub.emit("staff:approval_changed", {
    userId: result.user?.id,
    status: result.user?.status,
    name: result.user?.name,
  });

  const res = NextResponse.json({ ok: true, user: result.user });
  res.cookies.set(SESSION_COOKIE_NAME, result.sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 14 * 24 * 60 * 60,
  });
  return res;
}
