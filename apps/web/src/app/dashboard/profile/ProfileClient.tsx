"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Mail, ShieldCheck, UserCircle2 } from "lucide-react";

interface Profile {
  name: string;
  email: string;
  whatsappNumber: string;
  department: string;
  role: string;
}

type Step = "IDLE" | "ENTER_EMAIL" | "ENTER_CODES" | "DONE";

const inputCls =
  "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:border-[#00a884]";

function maskEmail(e: string): string {
  const [name, domain] = e.split("@");
  if (!domain) return e;
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

export function ProfileClient({ initial }: { initial: Profile }) {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile>(initial);
  const [form, setForm] = useState({
    name: initial.name,
    whatsappNumber: initial.whatsappNumber,
    department: initial.department,
  });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [step, setStep] = useState<Step>("IDLE");
  const [newEmail, setNewEmail] = useState("");
  const [requestId, setRequestId] = useState("");
  const [sentTo, setSentTo] = useState<{ oldEmail: string; newEmail: string } | null>(null);
  const [oldOtp, setOldOtp] = useState("");
  const [newOtp, setNewOtp] = useState("");
  const [expiresAt, setExpiresAt] = useState<number>(0);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [emailInfo, setEmailInfo] = useState("");

  useEffect(() => {
    if (step !== "ENTER_CODES" || !expiresAt) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [step, expiresAt]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Could not save.");
      setProfile((p) => ({ ...p, name: form.name.trim(), department: form.department.trim() }));
      setSaveMsg({ ok: true, text: "Profile saved." });
      router.refresh();
    } catch (err) {
      setSaveMsg({ ok: false, text: (err as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function sendCodes(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setEmailErr("");
    setEmailInfo("");
    try {
      const res = await fetch("/api/profile/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request", newEmail }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Could not send codes.");
      setRequestId(data.requestId);
      setSentTo({ oldEmail: data.oldEmail, newEmail: data.newEmail });
      setExpiresAt(new Date(data.expiresAt).getTime());
      setOldOtp("");
      setNewOtp("");
      setStep("ENTER_CODES");
      if (!data.delivered) {
        setEmailInfo(
          data.devPreviewOldCode
            ? `Email is not set up on this server. Test codes: current email ${data.devPreviewOldCode}, new email ${data.devPreviewNewCode}.`
            : "We could not deliver one of the emails. Check the addresses and use Resend codes, or ask a Superadmin to check the email settings."
        );
      }
    } catch (err) {
      setEmailErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCodes(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setEmailErr("");
    try {
      const res = await fetch("/api/profile/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", requestId, oldOtp, newOtp }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "Verification failed.");
      setProfile((p) => ({ ...p, email: data.email }));
      setStep("DONE");
      router.refresh();
    } catch (err) {
      setEmailErr((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, "0");
  const ss = String(secondsLeft % 60).padStart(2, "0");

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto w-full space-y-5">
      <div>
        <h1 className="font-display text-xl md:text-2xl font-bold text-slate-900 flex items-center gap-2">
          <UserCircle2 className="w-6 h-6 text-[#00a884]" /> My profile
        </h1>
        <p className="text-xs text-slate-500">Update your details and change the email you sign in with.</p>
      </div>

      {/* Details */}
      <form onSubmit={saveProfile} className="rounded-xl bg-white border border-neutral-200 shadow-2xs p-4 md:p-5 space-y-4">
        <h2 className="text-sm font-semibold text-slate-900">Your details</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="space-y-1 text-xs font-medium text-slate-600">
            Full name
            <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            WhatsApp number
            <input
              className={inputCls}
              value={form.whatsappNumber}
              onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value })}
              placeholder="+91 98480 22102"
            />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            Department
            <input className={inputCls} value={form.department} onChange={(e) => setForm({ ...form, department: e.target.value })} />
          </label>
          <div className="space-y-1 text-xs font-medium text-slate-600">
            Role
            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-neutral-200 text-sm text-slate-700">{profile.role}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
          {saveMsg && (
            <span className={`text-xs font-medium ${saveMsg.ok ? "text-emerald-700" : "text-rose-600"}`}>{saveMsg.text}</span>
          )}
        </div>
      </form>

      {/* Email change */}
      <section className="rounded-xl bg-white border border-neutral-200 shadow-2xs p-4 md:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <Mail className="w-4 h-4 text-sky-600" /> Login email
          </h2>
          <span className="text-sm font-mono text-slate-700">{profile.email}</span>
        </div>

        {step === "IDLE" && (
          <div className="space-y-2">
            <p className="text-xs text-slate-600">
              To change your email we send a 6-digit code to your <strong>current</strong> email and another to the{" "}
              <strong>new</strong> email. You need both codes, so nobody can change it without access to both inboxes.
            </p>
            <button
              type="button"
              onClick={() => {
                setStep("ENTER_EMAIL");
                setEmailErr("");
              }}
              className="px-4 py-2 rounded-lg border border-neutral-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 cursor-pointer"
            >
              Change email
            </button>
          </div>
        )}

        {step === "ENTER_EMAIL" && (
          <form onSubmit={sendCodes} className="space-y-3">
            <label className="space-y-1 text-xs font-medium text-slate-600 block">
              New email address
              <input
                type="email"
                required
                autoFocus
                className={inputCls}
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="you@classiconcepts.in"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !newEmail.trim()}
                className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {busy ? "Sending..." : "Send codes to both emails"}
              </button>
              <button
                type="button"
                onClick={() => setStep("IDLE")}
                className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {step === "ENTER_CODES" && sentTo && (
          <form onSubmit={verifyCodes} className="space-y-3">
            <div className="rounded-lg bg-sky-50 border border-sky-200 px-3 py-2 text-xs text-sky-900 flex gap-2">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                We sent a code to <strong>{maskEmail(sentTo.oldEmail)}</strong> (current) and another to{" "}
                <strong>{sentTo.newEmail}</strong> (new). They expire in{" "}
                <strong className="tabular-nums">
                  {mm}:{ss}
                </strong>
                .
              </span>
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1 text-xs font-medium text-slate-600">
                Code from your current email
                <input
                  className={`${inputCls} tracking-[0.3em] text-center font-mono`}
                  inputMode="numeric"
                  maxLength={6}
                  value={oldOtp}
                  onChange={(e) => setOldOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                />
              </label>
              <label className="space-y-1 text-xs font-medium text-slate-600">
                Code from your new email
                <input
                  className={`${inputCls} tracking-[0.3em] text-center font-mono`}
                  inputMode="numeric"
                  maxLength={6}
                  value={newOtp}
                  onChange={(e) => setNewOtp(e.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={busy || oldOtp.length !== 6 || newOtp.length !== 6 || secondsLeft === 0}
                className="px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-sm font-semibold disabled:opacity-50 cursor-pointer"
              >
                {busy ? "Checking..." : "Verify and change email"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendCodes()}
                className="px-3 py-2 rounded-lg border border-neutral-300 text-sm text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
              >
                Resend codes
              </button>
              <button
                type="button"
                onClick={() => {
                  setStep("IDLE");
                  setEmailErr("");
                  setEmailInfo("");
                }}
                className="px-3 py-2 rounded-lg text-sm text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {step === "DONE" && (
          <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-3 text-sm text-emerald-900 flex gap-2">
            <CheckCircle2 className="w-5 h-5 shrink-0" />
            <span>
              Done. Your login email is now <strong>{profile.email}</strong>. Use it the next time you sign in. Other devices
              were signed out, and both emails got a notice.
            </span>
          </div>
        )}

        {emailInfo && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{emailInfo}</p>}
        {emailErr && <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{emailErr}</p>}
      </section>
    </div>
  );
}
