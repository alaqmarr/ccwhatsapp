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

export default function RegisterStaffPage() {
  const router = useRouter();
  const [step, setStep] = useState<"FORM" | "OTP">("FORM");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("+91");
  const [department, setDepartment] = useState("Sales & Support");
  const [requestedRole, setRequestedRole] = useState<
    "STAFF" | "ADMIN" | "MANAGER"
  >("STAFF");
  const [password, setPassword] = useState("");

  const [otpCode, setOtpCode] = useState("");
  const [devPreviewCode, setDevPreviewCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          whatsappNumber,
          department,
          requestedRole,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not create account.");
        return;
      }
      if (data.devPreviewCode) {
        setDevPreviewCode(String(data.devPreviewCode));
      }
      setStep("OTP");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otpCode }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Verification code did not match.");
        return;
      }
      router.push("/onboarding");
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
        <Link
          href="/login"
          className="text-xs font-semibold text-slate-700 hover:text-slate-950"
        >
          Back to sign in
        </Link>
      </header>

      <div className="flex-1 w-full flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white rounded-xl border border-neutral-200 p-7 space-y-5 shadow-xs">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
              Staff Registration
            </h1>
            <p className="text-[13.5px] leading-relaxed text-slate-500 mt-1">
              Register with your active WhatsApp number and email address.
              After verifying your email code, your account goes to Superadmin or Dev for approval.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2 text-xs">
            <div
              className={`px-2.5 py-1.5 rounded border text-center font-medium ${
                step === "FORM"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-emerald-50 text-emerald-800 border-emerald-200"
              }`}
            >
              1. Your Details
            </div>
            <div
              className={`px-2.5 py-1.5 rounded border text-center font-medium ${
                step === "OTP"
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-neutral-50 text-neutral-500 border-neutral-200"
              }`}
            >
              2. Verify Email
            </div>
            <div className="px-2.5 py-1.5 rounded border bg-neutral-50 border-neutral-200 text-neutral-500 text-center font-medium">
              3. Admin Approval
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          {step === "FORM" ? (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Rahul Verma"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    WhatsApp Phone Number
                  </label>
                  <input
                    type="text"
                    required
                    value={whatsappNumber}
                    onChange={(e) => setWhatsappNumber(e.target.value)}
                    placeholder="+91 98480 12345"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="rahul@gmail.com"
                  className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Team / Department
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Role Needed
                  </label>
                  <select
                    value={requestedRole}
                    onChange={(e) =>
                      setRequestedRole(
                        e.target.value as "STAFF" | "ADMIN" | "MANAGER"
                      )
                    }
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm bg-white"
                  >
                    <option value="STAFF">Staff (Reply to customers)</option>
                    <option value="ADMIN">Admin (Chats + Broadcasts)</option>
                    <option value="MANAGER">
                      Manager (Templates + Broadcasts + Teams)
                    </option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  Password (at least 6 characters)
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Send verification code to email</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOtp} className="space-y-4">
              <div className="p-3.5 rounded-md bg-neutral-50 border border-neutral-200 space-y-1.5 text-xs">
                <div className="font-semibold text-neutral-900">
                  Check your inbox ({email})
                </div>
                <p className="text-neutral-600">
                  Enter the 6-digit code we sent. Right after this, you will see the
                  step-by-step usage guide while Superadmin or Dev approves your account.
                </p>
                {devPreviewCode && (
                  <div className="mt-2 p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900">
                    Test code (until email server is connected):{" "}
                    <strong className="font-mono text-sm">{devPreviewCode}</strong>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-700 mb-1">
                  6-Digit Email Code
                </label>
                <input
                  type="text"
                  required
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3 py-2.5 rounded-md border border-neutral-300 text-center text-base font-mono font-semibold tracking-widest"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium flex items-center justify-center gap-2 cursor-pointer"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                <span>Verify email & send for approval</span>
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
