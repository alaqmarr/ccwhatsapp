import type React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadTemplatesPayload } from "@/lib/loaders/crm";
import { TemplatesClient } from "./TemplatesClient";

export async function TemplatesDataBoundary({
  user,
}: {
  user: AuthenticatedUser;
}) {
  const initialData = await loadTemplatesPayload(user);
  return (
    <TemplatesClient
      initialData={
        initialData as React.ComponentProps<typeof TemplatesClient>["initialData"]
      }
    />
  );
}
