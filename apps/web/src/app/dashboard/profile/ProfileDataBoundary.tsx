import React from "react";
import { getCurrentUser } from "@/lib/session";
import { ProfileClient } from "./ProfileClient";

export async function ProfileDataBoundary({
  initial,
}: {
  initial?: React.ComponentProps<typeof ProfileClient>["initial"];
}) {
  if (initial) {
    return <ProfileClient initial={initial} />;
  }
  const user = await getCurrentUser();
  if (!user) return null;
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
