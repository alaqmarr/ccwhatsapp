"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { AuthPortalShell } from "@/components/auth/AuthPortalShell";

export function RegisterClient() {
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
  const [showPassword, setShowPassword] = useState(false);

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
    } catch {
      setError("Could not reach the server. Please try again.");
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
    } catch {
      setError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthPortalShell
      mode="register"
      overviewTitle="Set up your Classic Concepts staff account in three quick steps"
      overviewSubtitle="Register with your work phone number and email address. Once you verify your email code, a manager approves your role so you can start handling leads and orders."
    >
      <div className="space-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
          Staff Registration
        </h2>
        <p className="text-xs leading-relaxed text-slate-500">
          Your WhatsApp phone number links your My Leads notifications and forwarded attachments.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <div
          className={`px-2 py-1.5 rounded-md border text-center font-semibold ${
            step === "FORM"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-emerald-50 text-emerald-800 border-emerald-200"
          }`}
        >
          1. Your Details
        </div>
        <div
          className={`px-2 py-1.5 rounded-md border text-center font-semibold ${
            step === "OTP"
              ? "bg-slate-900 text-white border-slate-900"
              : "bg-neutral-50 text-slate-500 border-neutral-200"
          }`}
        >
          2. Verify Email
        </div>
        <div className="px-2 py-1.5 rounded-md border bg-neutral-50 border-neutral-200 text-slate-500 text-center font-semibold">
          3. Approval
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700"
        >
          {error}
        </div>
      )}

      {step === "FORM" ? (
        <form onSubmit={handleRegister} className="space-y-3.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="reg-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Full Name
              </label>
              <input
                id="reg-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rahul Verma"
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#00a884]"
              />
            </div>

            <div>
              <label
                htmlFor="reg-phone"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Work WhatsApp Number
              </label>
              <input
                id="reg-phone"
                type="text"
                required
                value={whatsappNumber}
                onChange={(e) => setWhatsappNumber(e.target.value)}
                placeholder="+91 98480 12345"
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 font-mono focus:outline-none focus:border-[#00a884]"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="reg-email"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Email Address
            </label>
            <input
              id="reg-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@classicconcepts.in"
              className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#00a884]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="reg-dept"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Team / Department
              </label>
              <input
                id="reg-dept"
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#00a884]"
              />
            </div>

            <div>
              <label
                htmlFor="reg-role"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Role Needed
              </label>
              <select
                id="reg-role"
                value={requestedRole}
                onChange={(e) =>
                  setRequestedRole(
                    e.target.value as "STAFF" | "ADMIN" | "MANAGER"
                  )
                }
                className="w-full px-3 py-2 rounded-lg border border-neutral-300 text-sm bg-white text-slate-900 focus:outline-none focus:border-[#00a884]"
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
            <label
              htmlFor="reg-password"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Password (at least 6 characters)
            </label>
            <div className="relative">
              <input
                id="reg-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={6}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong password"
                className="w-full pl-3 pr-10 py-2 rounded-lg border border-neutral-300 bg-white text-sm text-slate-900 focus:outline-none focus:border-[#00a884]"
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
            <span>
              {loading
                ? "Sending verification code..."
                : "Send verification code to email"}
            </span>
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div className="p-3.5 rounded-lg bg-neutral-50 border border-neutral-200 space-y-1.5 text-xs">
            <div className="font-semibold text-slate-900">
              Check your inbox ({email})
            </div>
            <p className="text-slate-600 leading-relaxed">
              Enter the 6-digit code we sent. Right after this, you will see the quick-start guide while Superadmin or Dev approves your account.
            </p>
            {devPreviewCode && (
              <div className="mt-2 p-2.5 rounded bg-amber-50 border border-amber-200 text-amber-900">
                Test code (until email server is connected):{" "}
                <strong className="font-mono text-sm">{devPreviewCode}</strong>
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="reg-otp"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              6-Digit Email Code
            </label>
            <input
              id="reg-otp"
              type="text"
              required
              maxLength={6}
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="123456"
              className="w-full px-3 py-2.5 rounded-lg border border-neutral-300 bg-white text-center text-base font-mono font-semibold tracking-widest focus:outline-none focus:border-[#00a884]"
            />
          </div>

          <div className="flex flex-col gap-2">
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {loading
                  ? "Verifying email..."
                  : "Verify email & send for approval"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setError("");
                setStep("FORM");
              }}
              className="inline-flex items-center justify-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900 py-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Edit email or details</span>
            </button>
          </div>
        </form>
      )}

      <div className="pt-3 border-t border-neutral-200 text-xs text-slate-600 flex items-center justify-between gap-2">
        <span>Already registered?</span>
        <Link
          href="/login"
          className="font-semibold text-[#008069] hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </AuthPortalShell>
  );
}
