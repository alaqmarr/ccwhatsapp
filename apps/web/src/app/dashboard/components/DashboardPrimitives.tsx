"use client";

import React from "react";
import Link from "next/link";

const kpiTones: Record<string, string> = {
  slate: "bg-slate-100 text-slate-700",
  emerald: "bg-emerald-100 text-emerald-700",
  amber: "bg-amber-100 text-amber-800",
  rose: "bg-rose-100 text-rose-700",
  violet: "bg-violet-100 text-violet-700",
  sky: "bg-sky-100 text-sky-700",
};

export function Kpi({
  label,
  value,
  hint,
  icon,
  tone = "slate",
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  icon: React.ReactNode;
  tone?: "slate" | "emerald" | "amber" | "rose" | "violet" | "sky";
  href?: string;
}) {
  const card = (
    <div className="rounded-xl bg-white border border-neutral-200 px-3 py-2.5 shadow-2xs hover:border-neutral-300 transition-colors h-full">
      <div className="flex items-center justify-between gap-1.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wide text-slate-500 truncate">
          {label}
        </span>
        <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${kpiTones[tone]}`}>
          {icon}
        </span>
      </div>
      <div className="mt-1 text-xl font-bold text-slate-900 tabular-nums leading-tight">{value}</div>
      {hint && <div className="text-[10.5px] text-slate-500 mt-0.5 truncate">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{card}</Link> : card;
}

export function Panel({
  title,
  icon,
  right,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl bg-white border border-neutral-200 shadow-2xs overflow-hidden">
      <header className="px-4 py-2.5 border-b border-neutral-100 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          {icon}
          {title}
        </h2>
        {right}
      </header>
      {children}
    </section>
  );
}
