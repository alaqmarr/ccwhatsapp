"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Copy, Loader2 } from "lucide-react";
import {
  CardListSkeleton,
  ClassicConceptsWordmark,
  ElementErrorState,
  WHATSAPP_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_ORIGIN,
  WhatsAppLogoIcon,
} from "@cc/ui";

interface SetupStateResponse {
  hasDevAccount: boolean;
  allFacebookStepsDone: boolean;
  facebookConfig: {
    mode: "SANDBOX_SIMULATOR" | "LIVE_META_CLOUD";
    businessPortfolioId?: string;
    verifiedName?: string;
    metaAppId: string;
    metaAppSecret: string;
    wabaId: string;
    phoneNumberId: string;
    businessDisplayPhone: string;
    systemUserAccessToken: string;
    webhookVerifyToken: string;
    stepsCompleted: {
      metaBusinessVerified: boolean;
      whatsappAppCreated: boolean;
      phoneRegistered: boolean;
      webhookSubscribed: boolean;
      systemTokenSaved: boolean;
    };
  };
  currentUser: { id: string; name: string; role: string } | null;
  aiConnected?: boolean;
  aiMaskedKey?: string;
  aiKeys?: {
    clientConnected: boolean;
    clientSource: string;
    clientMasked: string;
    adminConnected: boolean;
    adminSource: string;
    adminMasked: string;
  };
}

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SetupStateResponse | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [copied, setCopied] = useState("");

  // Dev account form
  const [name, setName] = useState("Platform Developer");
  const [email, setEmail] = useState("dev@classiconcepts.in");
  const [whatsappNumber, setWhatsappNumber] = useState("+917337222876");
  const [password, setPassword] = useState("");

  // Facebook WhatsApp Business form
  const [mode, setMode] = useState<"SANDBOX_SIMULATOR" | "LIVE_META_CLOUD">(
    "SANDBOX_SIMULATOR"
  );
  const [businessPortfolioId, setBusinessPortfolioId] = useState("");
  const [metaAppId, setMetaAppId] = useState("");
  const [metaAppSecret, setMetaAppSecret] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [businessDisplayPhone, setBusinessDisplayPhone] =
    useState("+91 73372 20568");
  const [systemUserAccessToken, setSystemUserAccessToken] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState(
    "cc_whatsapp_verify_2026"
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicAdminApiKey, setAnthropicAdminApiKey] = useState("");
  const [steps, setSteps] = useState({
    metaBusinessVerified: false,
    whatsappAppCreated: false,
    phoneRegistered: false,
    webhookSubscribed: false,
    systemTokenSaved: false,
  });

  const loadSetup = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const r = await fetch("/api/setup", { cache: "no-store" });
      if (!r.ok) {
        setLoadError("Could not load Facebook WhatsApp setup configuration.");
        return;
      }
      const d: SetupStateResponse = await r.json();
      setState(d);
      if (d.facebookConfig) {
        setMode(d.facebookConfig.mode || "SANDBOX_SIMULATOR");
        setBusinessPortfolioId(d.facebookConfig.businessPortfolioId || "");
        setMetaAppId(d.facebookConfig.metaAppId || "");
        setMetaAppSecret(d.facebookConfig.metaAppSecret || "");
        setWabaId(d.facebookConfig.wabaId || "");
        setPhoneNumberId(d.facebookConfig.phoneNumberId || "");
        setBusinessDisplayPhone(
          d.facebookConfig.businessDisplayPhone || "+91 73372 20568"
        );
        setSystemUserAccessToken(
          d.facebookConfig.systemUserAccessToken || ""
        );
        setWebhookVerifyToken(
          d.facebookConfig.webhookVerifyToken || "cc_whatsapp_verify_2026"
        );
        if (d.facebookConfig.stepsCompleted) {
          setSteps(d.facebookConfig.stepsCompleted);
        }
      }
    } catch {
      setLoadError(
        "Network error while loading Facebook setup. Click Try Again."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSetup();
  }, [loadSetup]);

  const webhookUrl = `${WHATSAPP_PUBLIC_ORIGIN}/api/webhooks/whatsapp`;

  function copyValue(label: string, val: string) {
    navigator.clipboard.writeText(val);
    setCopied(label);
    setTimeout(() => setCopied(""), 1800);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setSaving(true);

    const facebookPayload = {
      mode,
      businessPortfolioId,
      metaAppId,
      metaAppSecret: metaAppSecret === "••••••••" ? undefined : metaAppSecret,
      wabaId,
      phoneNumberId,
      businessDisplayPhone,
      systemUserAccessToken:
        systemUserAccessToken === "••••••••"
          ? undefined
          : systemUserAccessToken,
      webhookVerifyToken,
      stepsCompleted: steps,
    };

    try {
      if (!state?.hasDevAccount) {
        const res = await fetch("/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create_dev",
            name,
            email,
            whatsappNumber,
            password,
            facebookConfig: facebookPayload,
            anthropicApiKey,
            anthropicAdminApiKey,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || "Setup failed.");
          return;
        }
        router.push("/onboarding");
        router.refresh();
      } else {
        const res = await fetch("/api/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "update_facebook",
            facebookConfig: facebookPayload,
            anthropicApiKey,
            anthropicAdminApiKey,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          setError(data.error || "Could not save Facebook settings.");
          return;
        }
        setSuccessMsg("Facebook WhatsApp settings saved.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen w-full bg-neutral-50 p-6 space-y-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-4 flex items-center gap-3">
          <ClassicConceptsWordmark height={38} variant="light" />
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-5">
            <CardListSkeleton rows={3} />
          </div>
          <div className="xl:col-span-7">
            <CardListSkeleton rows={5} />
          </div>
        </div>
      </div>
    );
  }

  if (loadError && !state) {
    return (
      <div className="min-h-screen w-full bg-neutral-50 p-6 space-y-6">
        <div className="bg-white rounded-lg border border-neutral-200 p-4 flex items-center gap-3">
          <ClassicConceptsWordmark height={38} variant="light" />
        </div>
        <ElementErrorState
          title="Could not load Facebook WhatsApp setup"
          message={loadError}
          onRetry={() => loadSetup()}
          retrying={loading}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-neutral-50 text-neutral-900">
      {/* Full-Width Top Bar */}
      <header className="w-full bg-white border-b border-neutral-200 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <ClassicConceptsWordmark height={40} variant="light" />
          <div className="h-7 w-px bg-neutral-200" />
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-[#25d366] flex items-center justify-center text-white shrink-0">
              <WhatsAppLogoIcon size={17} />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight text-slate-900">
                Developer Account & Facebook WhatsApp Setup
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Domain:{" "}
                <strong className="font-mono font-semibold text-slate-800">
                  {WHATSAPP_PUBLIC_DOMAIN}
                </strong>
              </p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {state?.currentUser ? (
            <Link
              href="/dashboard/inbox"
              className="px-3.5 py-2 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800"
            >
              Back to Workspace
            </Link>
          ) : (
            <Link
              href="/login"
              className="px-3.5 py-2 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 text-xs font-medium text-neutral-800"
            >
              Staff / Admin Sign In
            </Link>
          )}
        </div>
      </header>

      <div className="w-full px-6 py-6 space-y-6">
        {error && (
          <div className="p-3.5 rounded-md bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            {error}
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center justify-between">
            <span>{successMsg}</span>
            <Link
              href="/dashboard/inbox"
              className="px-3 py-1.5 rounded bg-emerald-700 text-white text-xs font-medium"
            >
              Open Customer Chats
            </Link>
          </div>
        )}

        <form onSubmit={handleSubmit} className="w-full space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Dev Account + Mode + Webhook URLs */}
            <div className="xl:col-span-5 space-y-6">
              {!state?.hasDevAccount ? (
                <section className="p-5 rounded-lg bg-white border border-neutral-200 space-y-4">
                  <div>
                    <h2 className="text-sm font-semibold text-neutral-900">
                      1. Create Developer Account
                    </h2>
                    <p className="text-xs text-neutral-500 mt-1">
                      The Dev account also has full Superadmin permissions to approve
                      staff, plus access to Meta actual costs and daily Google Drive backups.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        Full Name
                      </label>
                      <input
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                      />
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
                        className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        WhatsApp Number
                      </label>
                      <input
                        type="text"
                        required
                        value={whatsappNumber}
                        onChange={(e) => setWhatsappNumber(e.target.value)}
                        placeholder="+91 98765 43210"
                        className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-neutral-700 mb-1">
                        Password (minimum 6 characters)
                      </label>
                      <input
                        type="password"
                        required
                        minLength={6}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter password"
                        className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                      />
                    </div>
                  </div>
                </section>
              ) : (
                <div className="p-4 rounded-lg bg-white border border-neutral-200 flex items-center gap-2.5 text-xs text-neutral-700">
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Developer account is active.{" "}
                    {state.currentUser?.role === "DEV"
                      ? "You can update your Facebook WhatsApp connection below."
                      : "Sign in as Dev to edit Facebook connection keys."}
                  </span>
                </div>
              )}

              {/* Webhook Details for whatsapp.ccapl.cc */}
              <section className="p-5 rounded-lg bg-white border border-neutral-200 space-y-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    Webhook Details for Meta Dashboard
                  </h2>
                  <p className="text-xs text-neutral-500 mt-1">
                    Paste these two values inside developers.facebook.com under
                    WhatsApp &rarr; Configuration.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-neutral-500 font-medium">
                        Callback URL
                      </div>
                      <div className="text-xs font-mono text-neutral-900 truncate">
                        {webhookUrl}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyValue("url", webhookUrl)}
                      className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copied === "url" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>

                  <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] text-neutral-500 font-medium">
                        Verify Token
                      </div>
                      <div className="text-xs font-mono text-neutral-900 truncate">
                        {webhookVerifyToken}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyValue("token", webhookVerifyToken)}
                      className="px-2.5 py-1.5 rounded border border-neutral-300 bg-white hover:bg-neutral-100 text-xs font-medium inline-flex items-center gap-1 shrink-0 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                      <span>{copied === "token" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>

            {/* RIGHT COLUMN: Facebook Steps Checklist & API Keys */}
            <section className="xl:col-span-7 p-5 rounded-lg bg-white border border-neutral-200 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-4">
                <div>
                  <h2 className="text-sm font-semibold text-neutral-900">
                    2. Facebook WhatsApp Connection Steps
                  </h2>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    Keep Test Mode on while testing locally, and switch to Live Mode
                    once your Facebook token is ready.
                  </p>
                </div>
                <div className="inline-flex rounded-md bg-neutral-100 p-1 border border-neutral-200">
                  <button
                    type="button"
                    onClick={() => setMode("SANDBOX_SIMULATOR")}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
                      mode === "SANDBOX_SIMULATOR"
                        ? "bg-white text-neutral-900 shadow-2xs"
                        : "text-neutral-600 hover:text-neutral-900"
                    }`}
                  >
                    Test Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("LIVE_META_CLOUD")}
                    className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer ${
                      mode === "LIVE_META_CLOUD"
                        ? "bg-[#1da851] text-white"
                        : "text-neutral-600 hover:text-neutral-900"
                    }`}
                  >
                    Live Facebook API
                  </button>
                </div>
              </div>

              {/* 5-Step Checklist */}
              <div className="space-y-2">
                <div className="text-xs font-medium text-neutral-700">
                  Facebook Setup Checklist
                </div>
                {[
                  {
                    key: "metaBusinessVerified" as const,
                    title: "1. Verify Classic Concepts Business Account on Facebook",
                    desc: "Upload GST certificate in business.facebook.com under Business Info.",
                  },
                  {
                    key: "whatsappAppCreated" as const,
                    title: "2. Create a Business App on developers.facebook.com",
                    desc: "Add the WhatsApp product inside your Facebook app.",
                  },
                  {
                    key: "phoneRegistered" as const,
                    title: "3. Connect Official Classic Concepts Phone Number",
                    desc: "Verify the phone number by SMS or phone call and copy the Phone Number ID.",
                  },
                  {
                    key: "systemTokenSaved" as const,
                    title: "4. Create a Permanent System User Token",
                    desc: "In Business Settings -> System Users, generate a permanent token with WhatsApp messaging access.",
                  },
                  {
                    key: "webhookSubscribed" as const,
                    title: "5. Connect Webhook to whatsapp.ccapl.cc",
                    desc: "Paste the Callback URL and Verify Token on the left, then turn on the 'messages' toggle.",
                  },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 p-3 rounded-md bg-neutral-50 border border-neutral-200 hover:border-neutral-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={steps[item.key]}
                      onChange={(e) =>
                        setSteps((prev) => ({
                          ...prev,
                          [item.key]: e.target.checked,
                        }))
                      }
                      className="mt-0.5 w-4 h-4 accent-[#1da851]"
                    />
                    <div>
                      <div className="text-xs font-medium text-neutral-900">
                        {item.title}
                      </div>
                      <div className="text-xs text-neutral-500">{item.desc}</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Credentials Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Business Portfolio ID
                  </label>
                  <input
                    type="text"
                    value={businessPortfolioId}
                    onChange={(e) => setBusinessPortfolioId(e.target.value)}
                    placeholder="30341529622102835"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Messaging Account ID (WABA)
                  </label>
                  <input
                    type="text"
                    value={wabaId}
                    onChange={(e) => setWabaId(e.target.value)}
                    placeholder="2195463394700930"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Phone Number ID
                  </label>
                  <input
                    type="text"
                    value={phoneNumberId}
                    onChange={(e) => setPhoneNumberId(e.target.value)}
                    placeholder="1456145487577989"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Business WhatsApp Number
                  </label>
                  <input
                    type="text"
                    value={businessDisplayPhone}
                    onChange={(e) => setBusinessDisplayPhone(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Facebook App ID
                  </label>
                  <input
                    type="text"
                    value={metaAppId}
                    onChange={(e) => setMetaAppId(e.target.value)}
                    placeholder="Optional when using System Access Token"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Webhook Verify Token
                  </label>
                  <input
                    type="text"
                    value={webhookVerifyToken}
                    onChange={(e) => setWebhookVerifyToken(e.target.value)}
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-neutral-700 mb-1">
                    Permanent System Access Token (Never Expires)
                  </label>
                  <input
                    type="password"
                    value={systemUserAccessToken}
                    onChange={(e) => setSystemUserAccessToken(e.target.value)}
                    placeholder="Paste permanent Facebook system access token"
                    className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                  />
                </div>
                <div className="sm:col-span-2 pt-2 border-t border-neutral-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Client ACRIO Key (claude-haiku-5-5){" "}
                      {state?.aiKeys?.clientConnected
                        ? `(Active via ${state.aiKeys.clientSource}: ${state.aiKeys.clientMasked})`
                        : ""}
                    </label>
                    <input
                      type="password"
                      value={anthropicApiKey}
                      onChange={(e) => setAnthropicApiKey(e.target.value)}
                      placeholder="ANTHROPIC_CLIENT_API_KEY (loaded from .env)"
                      className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-neutral-700 mb-1">
                      Admin ACRIO Key (claude-haiku-5-5){" "}
                      {state?.aiKeys?.adminConnected
                        ? `(Active via ${state.aiKeys.adminSource}: ${state.aiKeys.adminMasked})`
                        : ""}
                    </label>
                    <input
                      type="password"
                      value={anthropicAdminApiKey}
                      onChange={(e) => setAnthropicAdminApiKey(e.target.value)}
                      placeholder="ANTHROPIC_ADMIN_API_KEY (loaded from .env)"
                      className="w-full px-3 py-2 rounded-md border border-neutral-300 text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] text-white text-sm font-medium cursor-pointer disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>
                    {!state?.hasDevAccount
                      ? "Create Dev Account & Continue"
                      : "Save Settings"}
                  </span>
                </button>
              </div>
            </section>
          </div>
        </form>
      </div>
    </div>
  );
}
