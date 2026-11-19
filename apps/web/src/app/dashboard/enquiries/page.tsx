import React, { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import EnquiriesLoading from "./loading";
import { EnquiriesDataBoundary } from "./EnquiriesDataBoundary";

export const dynamic = "force-dynamic";

export default async function UnifiedWebsiteEnquiriesPage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE") {
    redirect("/login");
  }
  if (user.role === "CLIENT") {
    redirect("/dashboard/pricing");
  }

  return (
    <Suspense fallback={<EnquiriesLoading />}>
      <EnquiriesDataBoundary />
    </Suspense>
  );
}
