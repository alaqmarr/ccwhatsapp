import type React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadAiTrainingPayload } from "@/lib/loaders/operations";
import { AiTrainingClient } from "./AiTrainingClient";

export async function AiTrainingDataBoundary({
  user,
}: {
  user: AuthenticatedUser;
}) {
  const initialData = await loadAiTrainingPayload(user);
  return (
    <AiTrainingClient
      initialData={
        initialData as React.ComponentProps<typeof AiTrainingClient>["initialData"]
      }
    />
  );
}
