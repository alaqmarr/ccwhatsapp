"use client";

import React from "react";
import { ElementErrorState } from "@cc/ui";

export default function TeamsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full p-6">
      <ElementErrorState
        title="Could not load Teams & Escalation"
        message={
          error?.message ||
          "Could not load team routing settings. Click Try Again."
        }
        onRetry={() => reset()}
      />
    </div>
  );
}
