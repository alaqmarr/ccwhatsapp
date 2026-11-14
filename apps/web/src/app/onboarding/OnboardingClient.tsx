"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  ShoppingBag,
  Megaphone,
  Workflow,
  IndianRupee,
  ShieldCheck,
  HelpCircle,
} from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";
import { WhatsAppLogoIcon } from "@cc/ui";

const ONBOARDING_MODULES: Array<{
  id: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  summary: string;
  points: string[];
  tip: string;
}> = [
  {
    id: "approval_flow",
    title: "1. Account Verification & Approval",
    icon: ShieldCheck,
    summary:
      "How team members join the WhatsApp desk and get approved.",
    points: [
      "Every staff member registers with an active WhatsApp phone number and their @classiconcepts.in work email.",
      "Once you enter the 6-digit email code, your account is sent to a Superadmin or Dev for approval.",
      "While you wait for approval, you can read through this guide so you know where everything is.",
    ],
    tip: "Keep your registered WhatsApp number reachable during work hours so teammates can reach you on urgent orders.",
  },
  {
    id: "inbox_24h",
    title: "2. Replying to Customers & the 24-Hour Chat Window",
    icon: WhatsAppLogoIcon,
    summary:
      "How free WhatsApp chat replies work compared to template messages.",
    points: [
      "Whenever a customer sends us a message on WhatsApp, the chat window stays open for 24 hours.",
      "All normal replies sent by our staff inside this 24-hour window are completely free (₹0.00).",
      "If the chat window expires after 24 hours, WhatsApp requires sending an approved template message to restart the chat.",
    ],
    tip: "Check 'Chat window expires in ...' at the top of the chat so you reply while normal chat is still open and free.",
  },
  {
    id: "acrio_copilot",
    title: "3. System (ACRIO) Handling & Sales Team Handoff",
    icon: HelpCircle,
    summary:
      "ACRIO is used ONLY when a chat is assigned to System (when a customer starts a conversation or an agent assigns to System).",
    points: [
      "When a customer initiates a new conversation, the chat is assigned to System (ACRIO) and ACRIO answers product and machine questions automatically using Classic Concepts and Classic Edge 53 catalogs.",
      "If the customer asks to speak to support or ACRIO cannot resolve the query, ACRIO connects the chat to our Sales Team (default).",
      "Once a chat is assigned to our staff or Sales Team, ACRIO stays completely off to save AI credits and ₹0.30 message bills. Agents can click 'Assign to System' anytime if they want ACRIO to handle incoming replies again.",
    ],
    tip: "Click 'Take Over Chat' to step in personally (free ₹0.00 replies), or 'Assign to System' only when you want ACRIO to take over.",
  },
  {
    id: "customer_360",
    title: "4. Customer Details, Orders & Internal Team Notes",
    icon: ShoppingBag,
    summary:
      "Checking customer history and leaving private notes for colleagues.",
    points: [
      "On the right side of every chat, you can see the customer's company name, city, past orders, and website enquiries from both classicconcepts.in and classicedge53.com.",
      "Switch your reply box to 'Internal Team Note' to write a private yellow note for your teammates that is never sent to the customer on WhatsApp.",
      "Internal team notes are completely free and help Sales and Fabrication stay aligned on custom sizes or pricing.",
    ],
    tip: "Always check past orders and internal notes before quoting a repeat buyer.",
  },
  {
    id: "assignments_automations",
    title: "5. Teams, Wait-Time Tracking & P0 to P1 Escalation",
    icon: Workflow,
    summary:
      "Making sure no customer is kept waiting after ACRIO hands over a chat.",
    points: [
      "When ACRIO connects a customer to staff, the chat goes to the Sales Team P0 member with the fewest active chats.",
      "A live wait timer tracks how long the customer has been waiting for a human reply.",
      "If the P0 member is busy past the team wait limit, the chat automatically escalates to P1 and then P2 so the customer gets a fast answer.",
    ],
    tip: "Admins can create teams and adjust P0 and P1 wait limits anytime under 'Teams & Escalation'.",
  },
  {
    id: "marketing_links",
    title: "6. Customer Lists & Short Links (whatsapp.ccapl.cc)",
    icon: Megaphone,
    summary:
      "Creating targeted broadcast lists with ACRIO and sharing clean short links.",
    points: [
      "In 'Broadcasts & Short Links', type who you want to reach in plain English (for example, 'Hotels and banquets') and ACRIO will gather matching contacts.",
      "Create clean short links like https://whatsapp.ccapl.cc/l/stage-podiums for catalogs, quotes, or payment pages.",
      "Every click on a short link is counted so you know how many customers opened it.",
    ],
    tip: "Short links look much cleaner inside a WhatsApp message than long website addresses.",
  },
  {
    id: "pricing_categories",
    title: "7. Message Charges (Only ACRIO & Templates Are Billed)",
    icon: IndianRupee,
    summary:
      "Normal staff chat is free. Charges apply only to ACRIO automated replies and templated messages.",
    points: [
      "Normal WhatsApp chat replies by staff inside the 24-hour window and Internal Team Notes are completely free (₹0.00).",
      "ACRIO automated replies and Utility or Verification template messages cost ₹0.30 per message.",
      "Marketing template messages (promotions, festival offers, and catalog broadcasts) cost ₹0.95 per message.",
    ],
    tip: "You can check exact monthly ACRIO and template message counts anytime under 'Message Charges'.",
  },
];

export function OnboardingClient({
  initialUser,
}: {
  initialUser: AuthenticatedUser;
}) {
  const router = useRouter();
  const [completedSteps, setCompletedSteps] = useState<string[]>(
    initialUser.onboardingSteps || []
  );
  const [activeIdx, setActiveIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const activeModule = ONBOARDING_MODULES[activeIdx];
  const allDone = completedSteps.length >= ONBOARDING_MODULES.length;

  async function markStepAndNext(stepId: string, finishAll = false) {
    setSaving(true);
    try {
      const next = Array.from(new Set([...completedSteps, stepId]));
      setCompletedSteps(next);
      await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stepId,
          markAllComplete:
            finishAll || next.length >= ONBOARDING_MODULES.length,
        }),
      });
      if (finishAll) {
        if (initialUser.status === "ACTIVE") {
          router.push("/dashboard/inbox");
          router.refresh();
        }
      } else if (activeIdx < ONBOARDING_MODULES.length - 1) {
        setActiveIdx(activeIdx + 1);
      }
    } finally {
      setSaving(false);
    }
  }

  const ActiveIcon = activeModule.icon;

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* Top Bar / Approval Notice */}
      {initialUser.status === "PENDING_APPROVAL" ? (
        <div className="p-4 rounded-lg bg-amber-50 border border-amber-200 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <Clock className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h1 className="text-sm font-semibold text-amber-950">
                Waiting for Superadmin or Dev Approval
              </h1>
              <p className="text-xs text-amber-900 mt-0.5">
                Your email (<strong>{initialUser.email}</strong>) and WhatsApp number (
                <strong>{initialUser.whatsappNumber}</strong>) are verified. Read through
                how the desk works below while your account is approved.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="px-3.5 py-2 rounded-md bg-white border border-amber-300 hover:bg-amber-100 text-amber-950 text-xs font-medium cursor-pointer shrink-0"
          >
            Refresh Status
          </button>
        </div>
      ) : (
        <div className="p-5 rounded-xl bg-white border border-neutral-200 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
          <div>
            <h1 className="font-display text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
              How to Use the Classic Concepts WhatsApp Desk
            </h1>
            <p className="text-[13.5px] leading-relaxed text-slate-500 mt-0.5">
              Go through each short topic below, or open Customer Chats whenever you are ready.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium tabular-nums text-slate-500">
              {completedSteps.length} of {ONBOARDING_MODULES.length} read
            </span>
            <button
              type="button"
              onClick={() => markStepAndNext(activeModule.id, true)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-xs font-medium cursor-pointer"
            >
              <WhatsAppLogoIcon size={14} />
              <span>Open Customer Chats</span>
            </button>
          </div>
        </div>
      )}

      {/* Full-Width Split Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        <div className="lg:col-span-4 bg-white rounded-lg border border-neutral-200 divide-y divide-neutral-200">
          {ONBOARDING_MODULES.map((mod, idx) => {
            const Icon = mod.icon;
            const done = completedSteps.includes(mod.id);
            const isCurrent = idx === activeIdx;
            return (
              <button
                key={mod.id}
                type="button"
                onClick={() => setActiveIdx(idx)}
                className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                  isCurrent ? "bg-neutral-100" : "hover:bg-neutral-50"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-7 h-7 rounded flex items-center justify-center shrink-0 ${
                      done
                        ? "bg-emerald-100 text-emerald-700"
                        : isCurrent
                        ? "bg-neutral-900 text-white"
                        : "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {done ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Icon className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span
                    className={`text-xs ${
                      isCurrent
                        ? "font-semibold text-neutral-900"
                        : "font-medium text-neutral-700"
                    }`}
                  >
                    {mod.title}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        <div className="lg:col-span-8 bg-white rounded-lg border border-neutral-200 p-6 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3 border-b border-neutral-200 pb-4">
              <div className="w-9 h-9 rounded-md bg-neutral-100 text-neutral-800 flex items-center justify-center shrink-0">
                <ActiveIcon className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs text-neutral-500">
                  Step {activeIdx + 1} of {ONBOARDING_MODULES.length}
                </div>
                <h2 className="text-base font-semibold text-neutral-900">
                  {activeModule.title}
                </h2>
              </div>
            </div>

            <p className="text-sm text-neutral-700">{activeModule.summary}</p>

            <ul className="space-y-2.5">
              {activeModule.points.map((pt, i) => (
                <li
                  key={i}
                  className="p-3 rounded-md bg-neutral-50 border border-neutral-200 flex items-start gap-2.5 text-sm text-neutral-800"
                >
                  <Check className="w-4 h-4 text-[#1da851] shrink-0 mt-0.5" />
                  <span>{pt}</span>
                </li>
              ))}
            </ul>

            <div className="p-3.5 rounded-md bg-blue-50/70 border border-blue-200 text-xs text-blue-950">
              <strong>Helpful tip:</strong> {activeModule.tip}
            </div>
          </div>

          <div className="pt-4 border-t border-neutral-200 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={activeIdx === 0}
              onClick={() => setActiveIdx((p) => Math.max(0, p - 1))}
              className="px-3.5 py-2 rounded-md border border-neutral-300 text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40 cursor-pointer"
            >
              Previous
            </button>

            {activeIdx < ONBOARDING_MODULES.length - 1 ? (
              <button
                type="button"
                disabled={saving}
                onClick={() => markStepAndNext(activeModule.id, false)}
                className="px-4 py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium cursor-pointer"
              >
                Next Step
              </button>
            ) : (
              <button
                type="button"
                disabled={saving}
                onClick={() => markStepAndNext(activeModule.id, true)}
                className="px-4 py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-xs font-medium cursor-pointer"
              >
                {initialUser.status === "ACTIVE"
                  ? "Finish & Open Customer Chats"
                  : allDone
                  ? "Guide Completed (Waiting for Approval)"
                  : "Finish Guide"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
