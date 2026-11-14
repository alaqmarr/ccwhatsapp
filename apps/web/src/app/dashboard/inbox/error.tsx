"use client";

import React from "react";
import { ElementErrorState } from "@cc/ui";

export default function InboxError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full p-6">
      <ElementErrorState
        title="Could not load Customer Chats"
        message={
          error?.message ||
          "A temporary issue stopped chats from loading. Click Try Again."
        }
        onRetry={() => reset()}
      />
    </div>
  );
}
