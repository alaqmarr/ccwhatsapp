"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import {
  ClassicConceptsWordmark,
  WHATSAPP_PUBLIC_DOMAIN,
  WhatsAppLogoIcon,
} from "@cc/ui";

export default function LoginPage() {
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
        if (data.needsEmailVerify) {
          router.push(`/register?verify=${encodeURIComponent(email)}`);
          return;
        }
        setError(data.error || "Incorrect email or password.");
        return;
      }
      router.push("/");
      router.refresh();
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
            <div className="w-7 h-7 rounded-full bg-[#25d366] text-white flex items-center justify-center shrink-0">
              <WhatsAppLogoIcon size={15} />
            </div>
            <div>
              <div className="font-display text-sm font-bold tracking-tight text-slate-900">
                WhatsApp Business Desk
              </div>
              <div className="font-mono text-[11px] text-slate-500">
                {WHATSAPP_PUBLIC_DOMAIN}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs font-semibold">
          <Link href="/register" className="text-slate-700 hover:text-slate-950">
            Create staff account
          </Link>
          <Link href="/setup" className="text-slate-500 hover:text-slate-900">
            Developer setup
          </Link>
        </div>
      </header>

      <div className="flex-1 w-full flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white rounded-xl border border-neutral-200 p-7 space-y-5 shadow-xs">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Staff & Admin Sign In
            </h1>
            <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
              Sign in with your @classiconcepts.in email address.
            </p>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Work Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@classiconcepts.in"
                className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm focus:border-neutral-900 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-700 mb-1">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm focus:border-neutral-900 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>Sign in</span>
            </button>
          </form>

          <div className="pt-4 border-t border-neutral-200 text-xs text-neutral-600 flex items-center justify-between">
            <span>First time joining the desk?</span>
            <Link
              href="/register"
              className="font-medium text-neutral-900 underline"
            >
              Register staff account
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
