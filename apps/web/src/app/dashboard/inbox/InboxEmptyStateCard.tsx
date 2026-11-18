import React from "react";
import { WhatsAppLogoIcon } from "@cc/ui";

export function InboxEmptyStateCard() {
  return (
    <div className="p-8 text-center flex justify-center">
      <div className="bg-white/95 border border-[#d1d7db] rounded-xl p-6 max-w-sm shadow-xs space-y-2.5">
        <div className="mx-auto w-12 h-12 rounded-full bg-[#e7fce3] flex items-center justify-center text-[#00a884]">
          <WhatsAppLogoIcon size={24} />
        </div>
        <h2 className="font-display text-lg font-bold tracking-tight text-[#111b21]">
          Classic Concepts WhatsApp Desk
        </h2>
        <p className="text-[13px] leading-relaxed text-[#54656f]">
          Select any customer chat on the left. New enquiries are handled
          automatically by ACRIO first and connected to Sales Team whenever
          human help is needed.
        </p>
      </div>
    </div>
  );
}
