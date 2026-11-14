"use client";

import { ElementErrorState } from "@cc/ui";

export default function ContactsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full px-6 py-8">
      <ElementErrorState
        title="Could not open Contacts Database"
        message={
          error?.message ||
          "Something went wrong while loading your contacts directory."
        }
        onRetry={reset}
      />
    </div>
  );
}
