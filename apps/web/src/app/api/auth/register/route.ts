import { NextResponse } from "next/server";
import { registerStaffAccount } from "@cc/auth";
import { sendStaffVerificationEmail } from "@cc/connections";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const result = await registerStaffAccount({
    name: String(body.name || ""),
    email: String(body.email || ""),
    whatsappNumber: String(body.whatsappNumber || ""),
    password: String(body.password || ""),
    department: String(body.department || "Sales & Support"),
    requestedRole: body.requestedRole === "ADMIN" ? "ADMIN" : "STAFF",
  });

  if (!result.ok || !result.email || !result.otpCodeForDelivery) {
    return NextResponse.json(
      { ok: false, error: result.error || "Registration failed." },
      { status: 400 }
    );
  }

  const mailDelivery = await sendStaffVerificationEmail({
    email: result.email,
    staffName: String(body.name || "Team Member"),
    otpCode: result.otpCodeForDelivery,
  });

  return NextResponse.json({
    ok: true,
    email: result.email,
    deliveredViaSmtp: mailDelivery.deliveredViaSmtp,
    devPreviewCode: mailDelivery.devPreviewCode,
  });
}
