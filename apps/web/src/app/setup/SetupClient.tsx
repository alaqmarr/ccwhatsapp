"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CardListSkeleton,
  ClassicConceptsWordmark,
  ElementErrorState,
  WHATSAPP_PUBLIC_DOMAIN,
  WHATSAPP_PUBLIC_ORIGIN,
  WhatsAppLogoIcon,
} from "@cc/ui";
import {
  DevAccountStepCard,
  FacebookChecklistStep,
  WebhookDetailsCard,
} from "./SetupSteps";
import type {
  SetupMode,
  SetupStateResponse,
  SetupStepsCompleted,
} from "./types";

export function SetupClient({
  initialData,
}: {
  initialData?: SetupStateResponse;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(!initialData);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [state, setState] = useState<SetupStateResponse | null>(initialData ?? null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [copied, setCopied] = useState("");

  // Dev account form
  const [name, setName] = useState("Platform Developer");
  const [email, setEmail] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("+91");
  const [password, setPassword] = useState("");

  // Facebook WhatsApp Business form
  const [mode, setMode] = useState<SetupMode>(
    initialData?.facebookConfig?.mode || "SANDBOX_SIMULATOR"
  );
  const [businessPortfolioId, setBusinessPortfolioId] = useState(
    initialData?.facebookConfig?.businessPortfolioId || ""
  );
  const [metaAppId, setMetaAppId] = useState(
    initialData?.facebookConfig?.metaAppId || ""
  );
  const [metaAppSecret, setMetaAppSecret] = useState(
    initialData?.facebookConfig?.metaAppSecret || ""
  );
  const [wabaId, setWabaId] = useState(
    initialData?.facebookConfig?.wabaId || ""
  );
  const [phoneNumberId, setPhoneNumberId] = useState(
    initialData?.facebookConfig?.phoneNumberId || ""
  );
  const [businessDisplayPhone, setBusinessDisplayPhone] = useState(
    initialData?.facebookConfig?.businessDisplayPhone || "+91 73372 20568"
  );
  const [systemUserAccessToken, setSystemUserAccessToken] = useState(
    initialData?.facebookConfig?.systemUserAccessToken || ""
  );
  const [webhookVerifyToken, setWebhookVerifyToken] = useState(
    initialData?.facebookConfig?.webhookVerifyToken || "cc_whatsapp_verify_2026"
  );
  const [anthropicApiKey, setAnthropicApiKey] = useState("");
  const [anthropicAdminApiKey, setAnthropicAdminApiKey] = useState("");
  const [steps, setSteps] = useState<SetupStepsCompleted>(
    initialData?.facebookConfig?.stepsCompleted || {
      metaBusinessVerified: false,
      whatsappAppCreated: false,
      phoneRegistered: false,
      webhookSubscribed: false,
      systemTokenSaved: false,
    }
  );

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
    if (!initialData) {
      void loadSetup();
    }
  }, [initialData, loadSetup]);

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
      <div className="min-h-dvh w-full bg-neutral-50 p-3.5 sm:p-6 space-y-6">
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
      <div className="min-h-dvh w-full bg-neutral-50 p-3.5 sm:p-6 space-y-6">
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
    <div className="min-h-dvh w-full bg-neutral-50 text-neutral-900">
      <header className="w-full bg-white border-b border-neutral-200 px-3.5 sm:px-6 py-3.5 sm:py-4 flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div className="flex flex-wrap items-center gap-2.5 sm:gap-3.5 min-w-0">
          <ClassicConceptsWordmark height={36} variant="light" />
          <div className="hidden sm:block h-7 w-px bg-neutral-200" />
          <div className="flex items-center gap-2.5 min-w-0">
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
            <div className="xl:col-span-5 space-y-6">
              <DevAccountStepCard
                hasDevAccount={Boolean(state?.hasDevAccount)}
                currentUserRole={state?.currentUser?.role}
                name={name}
                email={email}
                whatsappNumber={whatsappNumber}
                password={password}
                onNameChange={setName}
                onEmailChange={setEmail}
                onWhatsappNumberChange={setWhatsappNumber}
                onPasswordChange={setPassword}
              />
              <WebhookDetailsCard
                webhookUrl={webhookUrl}
                webhookVerifyToken={webhookVerifyToken}
                copied={copied}
                onCopy={copyValue}
              />
            </div>

            <FacebookChecklistStep
              hasDevAccount={Boolean(state?.hasDevAccount)}
              saving={saving}
              mode={mode}
              onModeChange={setMode}
              steps={steps}
              onToggleStep={(key, checked) =>
                setSteps((prev) => ({ ...prev, [key]: checked }))
              }
              businessPortfolioId={businessPortfolioId}
              onBusinessPortfolioIdChange={setBusinessPortfolioId}
              wabaId={wabaId}
              onWabaIdChange={setWabaId}
              phoneNumberId={phoneNumberId}
              onPhoneNumberIdChange={setPhoneNumberId}
              businessDisplayPhone={businessDisplayPhone}
              onBusinessDisplayPhoneChange={setBusinessDisplayPhone}
              metaAppId={metaAppId}
              onMetaAppIdChange={setMetaAppId}
              webhookVerifyToken={webhookVerifyToken}
              onWebhookVerifyTokenChange={setWebhookVerifyToken}
              systemUserAccessToken={systemUserAccessToken}
              onSystemUserAccessTokenChange={setSystemUserAccessToken}
              anthropicApiKey={anthropicApiKey}
              onAnthropicApiKeyChange={setAnthropicApiKey}
              anthropicAdminApiKey={anthropicAdminApiKey}
              onAnthropicAdminApiKeyChange={setAnthropicAdminApiKey}
              aiKeys={state?.aiKeys}
            />
          </div>
        </form>
      </div>
    </div>
  );
}
