"use client";

import React from "react";
import Link from "next/link";
import {
  FolderOpen,
  MessageSquare,
  PackageCheck,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import { ClassicConceptsWordmark } from "@cc/ui";

const PORTAL_HIGHLIGHTS = [
  {
    icon: MessageSquare,
    title: "Shared Customer Chats",
    description:
      "Reply to WhatsApp enquiries from one team desk with ready templates, message polish, and 24-hour window reminders.",
  },
  {
    icon: FolderOpen,
    title: "Saved Client Media & Context",
    description:
      "Photos, voice notes, locations, and past enquiry details stay linked to the client number even when leads change hands.",
  },
  {
    icon: UserCheck,
    title: "Sticky Staff Ownership",
    description:
      "Returning customers route to their preferred staff member, while managers track open follow-ups and reply times.",
  },
  {
    icon: PackageCheck,
    title: "Contacts & Order Desk",
    description:
      "Manage contacts, bulk sheet imports, tracking updates, and short product links for Classic Concepts and Classic Edge 53.",
  },
] as const;

export function AuthPortalShell({
  mode,
  overviewTitle,
  overviewSubtitle,
  children,
}: {
  mode: "login" | "register";
  overviewTitle: string;
  overviewSubtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh w-full bg-neutral-50 text-slate-900 flex flex-col">
      <header className="w-full bg-white border-b border-neutral-200 px-4 sm:px-8 py-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ClassicConceptsWordmark height={34} variant="light" />
          <div className="hidden sm:block h-6 w-px bg-neutral-200" />
          <div className="hidden sm:flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-[#e7fce3] border border-[#b7ebaf] text-[#008069] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="font-display text-sm font-bold tracking-tight text-slate-900 truncate">
                Customer &amp; Order Desk
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                classicconcepts.in • classicedge53.com
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 text-xs">
          {mode === "login" ? (
            <>
              <span className="hidden sm:inline text-slate-500">
                New team member?
              </span>
              <Link
                href="/register"
                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 font-semibold text-slate-800 transition-colors"
              >
                Register Account
              </Link>
            </>
          ) : (
            <>
              <span className="hidden sm:inline text-slate-500">
                Already have an account?
              </span>
              <Link
                href="/login"
                className="px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 font-semibold text-slate-800 transition-colors"
              >
                Sign In
              </Link>
            </>
          )}
        </div>
      </header>

      <main className="flex-1 w-full px-4 sm:px-8 py-6 sm:py-10 flex items-center">
        <div className="w-full max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-12 items-start lg:items-center">
          <section className="lg:col-span-7 space-y-5 order-2 lg:order-1">
            <div className="space-y-2.5">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white border border-neutral-200 text-xs font-semibold text-[#008069]">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Authorized Classic Concepts Staff Portal</span>
              </div>
              <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 leading-snug">
                {overviewTitle}
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed max-w-2xl">
                {overviewSubtitle}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              {PORTAL_HIGHLIGHTS.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="bg-white rounded-xl border border-neutral-200 p-4 space-y-2 shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-[#e7fce3] text-[#008069] flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <h2 className="text-sm font-semibold text-slate-900">
                        {item.title}
                      </h2>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      {item.description}
                    </p>
                  </div>
                );
              })}
            </div>

            <div className="bg-white rounded-xl border border-neutral-200 px-4 py-3 text-[11.5px] leading-relaxed text-slate-500">
              Operated by{" "}
              <a
                href="https://classicconcepts.in"
                className="font-medium text-slate-700 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Classic Concepts (classicconcepts.in)
              </a>{" "}
              and{" "}
              <a
                href="https://classicedge53.com"
                className="font-medium text-slate-700 underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Classic Edge 53 (classicedge53.com)
              </a>
              . Authorized staff access only. Independent business software; not affiliated with external messaging platforms.
            </div>
          </section>

          <section className="lg:col-span-5 w-full order-1 lg:order-2">
            <div className="bg-white rounded-2xl border border-neutral-200 p-5 sm:p-7 shadow-sm space-y-5">
              <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-neutral-100 border border-neutral-200 text-xs font-semibold">
                <Link
                  href="/login"
                  className={`py-2 rounded-md text-center transition-colors ${
                    mode === "login"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Staff Sign In
                </Link>
                <Link
                  href="/register"
                  className={`py-2 rounded-md text-center transition-colors ${
                    mode === "register"
                      ? "bg-white text-slate-900 shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  New Registration
                </Link>
              </div>

              {children}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
