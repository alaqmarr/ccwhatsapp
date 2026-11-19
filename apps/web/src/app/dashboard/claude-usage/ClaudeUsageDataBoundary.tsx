import type React from "react";
import { loadClaudeUsagePayload } from "@/lib/loaders/operations";
import { ClaudeUsageClient } from "./ClaudeUsageClient";

export async function ClaudeUsageDataBoundary() {
  let initialData: React.ComponentProps<typeof ClaudeUsageClient>["initialData"] =
    null;
  let initialError = "";
  try {
    initialData = (await loadClaudeUsagePayload({
      preset: "mtd",
    })) as React.ComponentProps<typeof ClaudeUsageClient>["initialData"];
  } catch (err: unknown) {
    initialError =
      err instanceof Error
        ? err.message
        : "Failed to load Claude API usage & spend report.";
  }

  return (
    <ClaudeUsageClient initialData={initialData} initialError={initialError} />
  );
}
