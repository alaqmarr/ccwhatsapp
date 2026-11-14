"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  Clock,
  MessageSquare,
  ShoppingBag,
  Megaphone,
  Workflow,
  IndianRupee,
  ShieldCheck,
  HelpCircle,
} from "lucide-react";
import type { AuthenticatedUser } from "@cc/auth";

const ONBOARDING_MODULES = [
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
    title: "2. Replying to Customers & the 24-Hour Rule",
    icon: MessageSquare,
    summary:
      "How normal WhatsApp replies work compared to template messages.",
    points: [
      "Whenever a customer sends us a message on WhatsApp, you can reply freely for the next 24 hours.",
      "Within those 24 hours, you can type normal messages, share product links, and answer questions.",
      "If more than 24 hours pass since the customer's last message, WhatsApp requires sending an approved template message to restart the chat.",
    ],
    tip: "Try to reply to new enquiries quickly while the customer is still online.",
  },
  {
    id: "acrio_copilot",
    title: "3. Using ACRIO Reply Suggestions",
    icon: HelpCircle,
    summary:
      "Getting quick, clear reply drafts and product links right inside the chat.",
    points: [
      "Above the message box, ACRIO reads what the customer asked and suggests 3 simple replies in plain English.",
      "Click any suggested reply to put it in your text box, edit anything you want, and press Send.",
      "When a customer's enquiry is finished, click 'Mark Resolved' at the top to save a short note for the next team member.",
    ],
    tip: "You can also click any suggested product button to paste its website link straight into your message.",
  },
  {
    id: "customer_360",
    title: "4. Customer Details, Orders & Past Enquiries",
    icon: ShoppingBag,
    summary:
      "Checking who the customer is and what they bought before.",
    points: [
      "On the right side of every chat, you can see the customer's company name, city, and notes.",
      "Switch to the 'Orders' tab to check their past orders, payment status, or add a new order.",
      "Switch to the 'Past History' tab to see earlier WhatsApp chats and enquiries they sent on the Classic Concepts website.",
    ],
    tip: "Always check Past History first so repeat hotel or college buyers do not have to explain their requirement twice.",
  },
  {
    id: "assignments_automations",
    title: "5. Assigning Chats & Auto-Replies",
    icon: Workflow,
    summary:
      "Passing a chat to the right person on the team and setting up automatic replies.",
    points: [
      "Use the 'Assign' dropdown at the top of a chat to assign an enquiry to yourself or another colleague.",
      "Use the 'Mine Only' button above the chat list when you only want to see chats assigned to you.",
      "Under 'Auto-Replies', Admins can turn on automatic greetings or automatic tags when customers mention words like podium or trophy.",
    ],
    tip: "Assign custom size or drawing enquiries to the fabrication desk right away so quotes go out faster.",
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
    title: "7. Choosing the Right Message Type & Charges",
    icon: IndianRupee,
    summary:
      "Understanding Marketing messages versus normal order and support messages.",
    points: [
      "Marketing messages cost ₹0.95 per message. Use this for promotions, festival offers, and catalog broadcasts.",
      "All other messages (Order updates, Service replies, and Verification codes) cost ₹0.30 per message.",
      "You can check your monthly message counts and charges anytime under 'Message Charges'.",
    ],
    tip: "When sending an order update or reply to an enquiry, keep the type set to Service or Order Update (₹0.30).",
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
        <div className="p-4 rounded-lg bg-white border border-neutral-200 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-neutral-900">
              How to Use the Classic Concepts WhatsApp Desk
            </h1>
            <p className="text-xs text-neutral-500 mt-0.5">
              Go through each short topic below, or open Customer Chats whenever you are ready.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-500">
              {completedSteps.length} of {ONBOARDING_MODULES.length} read
            </span>
            <button
              type="button"
              onClick={() => markStepAndNext(activeModule.id, true)}
              className="px-4 py-2 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-xs font-medium cursor-pointer"
            >
              Open Customer Chats
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
