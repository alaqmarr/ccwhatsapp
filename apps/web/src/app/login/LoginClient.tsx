"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { ClassicConceptsWordmark } from "@cc/ui";

export function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Sign in failed. Please check your credentials.");
        return;
      }
      if (data.user?.status === "PENDING_EMAIL_OTP") {
        router.push("/register");
      } else if (data.user?.status !== "ACTIVE") {
        router.push("/onboarding");
      } else {
        router.push("/dashboard");
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 flex flex-col">
      <header className="w-full bg-white border-b border-neutral-200 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3.5">
          <ClassicConceptsWordmark height={38} variant="light" />
          <div className="h-6 w-px bg-neutral-200" />
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-slate-900 text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <div className="font-display text-sm font-bold tracking-tight text-slate-900">
                Internal Staff & Order Portal
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                classicconcepts.in • classicedge53.com
              </div>
            </div>
          </div>
        </div>
        <span className="text-xs text-slate-500 hidden sm:inline font-medium">
          Authorized Classic Concepts Staff Only
        </span>
      </header>

      <div className="flex-1 w-full flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 p-7 space-y-5 shadow-xs">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Staff Portal Sign In
            </h1>
            <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
              Sign in with your approved Classic Concepts staff email and password to access internal customer enquiries and orders.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@classicconcepts.in"
                className="w-full px-3.5 py-2 rounded-md border border-neutral-300 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2 rounded-md border border-neutral-300 text-sm focus:outline-none focus:border-neutral-900"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Sign in to Classic Concepts Portal</span>
            </button>
          </form>

          <div className="pt-4 border-t border-neutral-200 text-xs text-neutral-600 flex items-center justify-between">
            <span>New Classic Concepts team member?</span>
            <Link
              href="/register"
              className="font-medium text-neutral-900 underline"
            >
              Register staff account
            </Link>
          </div>

          <div className="pt-3 border-t border-neutral-100 text-[11px] leading-relaxed text-neutral-500">
            Internal employee CRM and order portal operated by{" "}
            <a
              href="https://classicconcepts.in"
              className="underline text-neutral-700"
              target="_blank"
              rel="noopener noreferrer"
            >
              Classic Concepts (classicconcepts.in)
            </a>{" "}
            and{" "}
            <a
              href="https://classicedge53.com"
              className="underline text-neutral-700"
              target="_blank"
              rel="noopener noreferrer"
            >
              Classic Edge 53 (classicedge53.com)
            </a>
            . Authorized internal staff access only. Independent business software; not affiliated with or endorsed by consumer messaging platforms.
          </div>
        </div>
      </div>
    </div>
  );
}
