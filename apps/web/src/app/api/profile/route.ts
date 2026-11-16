import { NextResponse } from "next/server";
import { updateStaffProfile } from "@cc/auth";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** GET /api/profile  - my own details. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  return NextResponse.json({
    ok: true,
    profile: {
      id: user.id,
      name: user.name,
      email: user.email,
      whatsappNumber: user.whatsappNumber,
      department: user.department,
      role: user.role,
    },
  });
}

/** PATCH /api/profile { name, whatsappNumber, department } */
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const result = await updateStaffProfile({
    userId: user.id,
    name: String(body.name ?? user.name),
    whatsappNumber: String(body.whatsappNumber ?? user.whatsappNumber),
    department: String(body.department ?? user.department),
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
