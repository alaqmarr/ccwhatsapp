"use client";

import React from "react";
import { ElementErrorState } from "@cc/ui";

export default function AnalyticsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full p-6">
      <ElementErrorState
        title="Could not load Analytics & Reports"
        message={
          error?.message ||
          "Could not load WhatsApp analytics right now. Click Try Again to reload."
        }
        onRetry={() => reset()}
      />
    </div>
  );
}
