import type React from "react";
import { redirect } from "next/navigation";
import { isDevRole } from "@cc/rbac";
import { loadClaudeUsagePayload } from "@/lib/loaders/operations";
import { getCurrentUser } from "@/lib/session";
import { ClaudeUsageClient } from "./ClaudeUsageClient";

export const dynamic = "force-dynamic";

export default async function DevClaudeUsagePage() {
  const user = await getCurrentUser();
  if (!user || user.status !== "ACTIVE" || !isDevRole(user.role)) {
    redirect("/dashboard/inbox");
  }

  let initialData: React.ComponentProps<typeof ClaudeUsageClient>["initialData"] = null;
  let initialError = "";
  try {
    initialData = (await loadClaudeUsagePayload({
      preset: "mtd",
    })) as React.ComponentProps<typeof ClaudeUsageClient>["initialData"];
  } catch (err: any) {
    initialError =
      err?.message || "Failed to load Claude API usage & spend report.";
  }

  return (
    <ClaudeUsageClient initialData={initialData} initialError={initialError} />
  );
}
