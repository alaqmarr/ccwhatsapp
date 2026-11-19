import type React from "react";
import type { AuthenticatedUser } from "@cc/auth";
import { loadContactsPayload } from "@/lib/loaders/crm";
import { ContactsClient } from "./ContactsClient";

export async function ContactsDataBoundary({
  user,
}: {
  user: AuthenticatedUser;
}) {
  const initialData = await loadContactsPayload(user);
  return (
    <ContactsClient
      initialData={
        initialData as React.ComponentProps<typeof ContactsClient>["initialData"]
      }
    />
  );
}
