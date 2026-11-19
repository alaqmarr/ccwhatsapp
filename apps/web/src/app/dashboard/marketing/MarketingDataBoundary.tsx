import type React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadMarketingPayload } from "@/lib/loaders/crm";
import { MarketingClient } from "./MarketingClient";

export async function MarketingDataBoundary({
  user,
}: {
  user: AuthenticatedUser;
}) {
  const initialData = await loadMarketingPayload(user);
  return (
    <MarketingClient
      initialData={
        initialData as React.ComponentProps<typeof MarketingClient>["initialData"]
      }
    />
  );
}
