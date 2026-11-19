import { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, loginWithPassword } from "@cc/auth";
import { enforcePublicRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const limited = enforcePublicRateLimit(req, {
    bucket: "auth-login",
    maxRequests: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const result = await loginWithPassword({
    email: String(body.email || ""),
    password: String(body.password || ""),
  });

  if (!result.ok || !result.sessionToken) {
    return NextResponse.json(
      {
        ok: false,
        needsEmailVerify: result.needsEmailVerify,
        error: result.error || "Sign-in failed.",
      },
      { status: 401 }
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
