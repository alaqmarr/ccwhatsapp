import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, requestEmailChange, verifyEmailChange } from "@cc/auth";
import {
  sendEmailChangeOtpEmail,
  sendEmailChangedNoticeEmail,
} from "@cc/connections";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/profile/email
 *   { action: "request", newEmail }                         -> sends a code to the OLD and the NEW email
 *   { action: "verify", requestId, oldOtp, newOtp }         -> needs BOTH codes, then switches the login email
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "request") {
    const result = await requestEmailChange({ userId: user.id, newEmail: String(body.newEmail || "") });
    if (!result.ok || !result.oldOtp || !result.newOtp || !result.oldEmail || !result.newEmail) {
      return NextResponse.json({ ok: false, error: result.error || "Could not start the email change." }, { status: 400 });
    }
    const [oldMail, newMail] = await Promise.all([
      sendEmailChangeOtpEmail({
        to: result.oldEmail,
        staffName: result.staffName || user.name,
        otpCode: result.oldOtp,
        which: "OLD",
        oldEmail: result.oldEmail,
        newEmail: result.newEmail,
      }),
      sendEmailChangeOtpEmail({
        to: result.newEmail,
        staffName: result.staffName || user.name,
        otpCode: result.newOtp,
        which: "NEW",
        oldEmail: result.oldEmail,
        newEmail: result.newEmail,
      }),
    ]);

    const delivered = oldMail.ok && newMail.ok;
    // Never show codes in the response on a real server: that would defeat the check.
    const isDev = process.env.NODE_ENV !== "production";
    return NextResponse.json({
      ok: true,
      requestId: result.requestId,
      expiresAt: result.expiresAt,
      oldEmail: result.oldEmail,
      newEmail: result.newEmail,
      delivered,
      deliveredOld: oldMail.ok,
      deliveredNew: newMail.ok,
      ...(isDev && !delivered ? { devPreviewOldCode: result.oldOtp, devPreviewNewCode: result.newOtp } : {}),
    });
  }

  if (action === "verify") {
    const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
    const result = await verifyEmailChange({
      userId: user.id,
      requestId: String(body.requestId || ""),
      oldOtp: String(body.oldOtp || ""),
      newOtp: String(body.newOtp || ""),
      keepSessionToken: token,
    });
    if (!result.ok || !result.oldEmail || !result.newEmail) {
      return NextResponse.json({ ok: false, error: result.error || "Verification failed." }, { status: 400 });
    }
    // Tell both addresses what happened.
    void sendEmailChangedNoticeEmail({
      to: result.oldEmail,
      staffName: result.staffName || user.name,
      oldEmail: result.oldEmail,
      newEmail: result.newEmail,
    });
    void sendEmailChangedNoticeEmail({
      to: result.newEmail,
      staffName: result.staffName || user.name,
      oldEmail: result.oldEmail,
      newEmail: result.newEmail,
    });
    return NextResponse.json({ ok: true, email: result.newEmail });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
