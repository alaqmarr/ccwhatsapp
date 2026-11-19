import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import ProfileLoading from "./loading";
import { ProfileDataBoundary } from "./ProfileDataBoundary";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.status !== "ACTIVE") redirect("/onboarding");
  return (
    <Suspense fallback={<ProfileLoading />}>
      <ProfileDataBoundary
        initial={{
          name: user.name,
          email: user.email,
          whatsappNumber: user.whatsappNumber,
          department: user.department,
          role: user.role,
        }}
      />
    </Suspense>
  );
}
