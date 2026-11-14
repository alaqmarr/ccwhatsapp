"use client";

import React from "react";
import { ElementErrorState } from "@cc/ui";

export default function TemplatesError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="w-full p-6">
      <ElementErrorState
        title="Could not load Message Templates Studio"
        message={
          error?.message ||
          "Could not load WhatsApp templates. Click Try Again to reload."
        }
        onRetry={() => reset()}
      />
    </div>
  );
}
