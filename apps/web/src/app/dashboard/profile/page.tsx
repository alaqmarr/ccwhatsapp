import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { ProfileClient } from "./ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "ACTIVE") redirect("/onboarding");
  return (
    <ProfileClient
      initial={{
        name: user.name,
        email: user.email,
        whatsappNumber: user.whatsappNumber,
        department: user.department,
        role: user.role,
      }}
    />
  );
}
