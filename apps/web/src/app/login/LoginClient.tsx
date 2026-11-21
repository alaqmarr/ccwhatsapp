"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { AuthPortalShell } from "@/components/auth/AuthPortalShell";

export function LoginClient() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthPortalShell
      mode="login"
      overviewTitle="Handle client enquiries, quotes, and orders from one place"
      overviewSubtitle="Sign in to view live WhatsApp conversations, assigned leads, shared customer media, and order tracking across Classic Concepts and Classic Edge 53."
    >
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
          Welcome back
        </h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Enter your work email and password to open your desk.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="login-email"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Work Email Address
          </label>
          <div className="relative">
            <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@classicconcepts.in"
              className="w-full pl-9 pr-3.5 py-2.5 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#00a884]"
            />
          </div>
        </div>

        <div>
          <label
            htmlFor="login-password"
            className="block text-xs font-semibold text-slate-700 mb-1.5"
          >
            Password
          </label>
          <div className="relative">
            <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              id="login-password"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              className="w-full pl-9 pr-10 py-2.5 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#00a884]"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              className="p-1.5 rounded text-slate-400 hover:text-slate-700 absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer"
            >
              {showPassword ? (
                <EyeOff className="w-4 h-4" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 shadow-2xs"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{loading ? "Signing in..." : "Sign In to Staff Desk"}</span>
        </button>
      </form>

      <div className="rounded-lg bg-neutral-50 border border-neutral-200 px-3.5 py-2.5 text-xs text-slate-600 space-y-1">
        <div className="font-semibold text-slate-800">Waiting for manager approval?</div>
        <p className="text-[11.5px] leading-relaxed text-slate-500">
          You can still sign in here anytime to view your approval status and setup guide.
        </p>
      </div>

      <div className="pt-3 border-t border-neutral-200 text-xs text-slate-600 flex items-center justify-between gap-2">
        <span>Need a new staff account?</span>
        <Link
          href="/register"
          className="font-semibold text-[#008069] hover:underline"
        >
          Create staff account
        </Link>
      </div>
    </AuthPortalShell>
  );
}
