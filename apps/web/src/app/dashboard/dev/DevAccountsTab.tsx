"use client";

import React from "react";
import { Plus } from "lucide-react";
import { AccountStatusBadge, formatDateIst } from "@cc/ui";
import type { StaffMemberRecord } from "./dev-types";

export default function DevAccountsTab({
  devAccounts,
  newDevName,
  setNewDevName,
  newDevEmail,
  setNewDevEmail,
  newDevPhone,
  setNewDevPhone,
  newDevPassword,
  setNewDevPassword,
  creatingDev,
  devFormError,
  onCreateDevAccount,
}: {
  devAccounts: StaffMemberRecord[];
  newDevName: string;
  setNewDevName: (v: string) => void;
  newDevEmail: string;
  setNewDevEmail: (v: string) => void;
  newDevPhone: string;
  setNewDevPhone: (v: string) => void;
  newDevPassword: string;
  setNewDevPassword: (v: string) => void;
  creatingDev: boolean;
  devFormError: string;
  onCreateDevAccount: (e: React.FormEvent) => void;
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      <form
        onSubmit={onCreateDevAccount}
        className="lg:col-span-5 bg-white rounded-lg border border-neutral-200 p-5 space-y-4 text-xs"
      >
        <div>
          <h2 className="text-sm font-semibold text-neutral-900">
            Create Another Dev Account
          </h2>
          <p className="text-neutral-500 mt-0.5 leading-relaxed">
            Only an active DEV can create or manage another DEV. Dev accounts can view every page and step into any chat directly, and are never placed in automatic chat round-robin.
          </p>
        </div>

        {devFormError && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-700">
            {devFormError}
          </div>
        )}

        <div>
          <label className="block font-medium text-neutral-700 mb-1">Full Name</label>
          <input
            type="text"
            required
            value={newDevName}
            onChange={(e) => setNewDevName(e.target.value)}
            placeholder="Developer Name"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block font-medium text-neutral-700 mb-1">Email Address</label>
          <input
            type="email"
            required
            value={newDevEmail}
            onChange={(e) => setNewDevEmail(e.target.value)}
            placeholder="name@example.com"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </div>

        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            WhatsApp Number
          </label>
          <input
            type="tel"
            required
            value={newDevPhone}
            onChange={(e) => setNewDevPhone(e.target.value)}
            placeholder="+91 98XXXXXXXX"
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
        </div>

        <div>
          <label className="block font-medium text-neutral-700 mb-1">
            Password (min 8 characters)
          </label>
          <input
            type="password"
            required
            minLength={8}
            value={newDevPassword}
            onChange={(e) => setNewDevPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          disabled={creatingDev}
          className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 rounded-md bg-slate-900 hover:bg-slate-800 text-white font-semibold cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>{creatingDev ? "Creating Dev..." : "Create Dev Account"}</span>
        </button>
      </form>

      <div className="lg:col-span-7 bg-white rounded-lg border border-neutral-200 p-5 space-y-3 text-xs">
        <h2 className="text-sm font-semibold text-neutral-900">
          Existing Dev Accounts ({devAccounts.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[580px]">
            <thead>
              <tr className="border-b border-neutral-200 text-neutral-500">
                <th className="py-2 pr-3 font-medium">Name & Email</th>
                <th className="py-2 px-3 font-medium">WhatsApp</th>
                <th className="py-2 px-3 font-medium">Status</th>
                <th className="py-2 pl-3 text-right font-medium">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {devAccounts.map((acc) => (
                <tr key={acc.id}>
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-neutral-900">{acc.name}</div>
                    <div className="text-neutral-500 font-mono">{acc.email}</div>
                  </td>
                  <td className="py-3 px-3 font-mono text-neutral-700">
                    {acc.whatsappNumber}
                  </td>
                  <td className="py-3 px-3">
                    <AccountStatusBadge status={acc.status} />
                  </td>
                  <td className="py-3 pl-3 text-right text-neutral-500">
                    {formatDateIst(acc.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
