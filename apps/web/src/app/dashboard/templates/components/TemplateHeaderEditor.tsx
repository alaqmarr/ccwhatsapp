"use client";

import React from "react";
import type {
  CatalogMediaOption,
  HeaderType,
  LocationHeader,
} from "@/app/dashboard/templates/types";

export function TemplateHeaderEditor({
  headerType,
  setHeaderType,
  headerText,
  setHeaderText,
  headerMediaUrl,
  setHeaderMediaUrl,
  headerLocation,
  setHeaderLocation,
  catalogMedia,
}: {
  headerType: HeaderType;
  setHeaderType: (v: HeaderType) => void;
  headerText: string;
  setHeaderText: (v: string) => void;
  headerMediaUrl: string;
  setHeaderMediaUrl: (v: string) => void;
  headerLocation: LocationHeader;
  setHeaderLocation: React.Dispatch<React.SetStateAction<LocationHeader>>;
  catalogMedia: CatalogMediaOption[];
}) {
  return (
    <div className="p-3.5 rounded-lg border border-neutral-200 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-neutral-900">
          Header (Optional Top Banner)
        </span>
        <div className="flex flex-wrap gap-1">
          {(
            [
              { key: "NONE", label: "None" },
              { key: "TEXT", label: "Text" },
              { key: "IMAGE", label: "Image" },
              { key: "VIDEO", label: "Video" },
              { key: "DOCUMENT", label: "PDF / Doc" },
              { key: "LOCATION", label: "Map Location" },
            ] as const
          ).map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => setHeaderType(h.key)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium cursor-pointer ${
                headerType === h.key
                  ? "bg-neutral-900 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              {h.label}
            </button>
          ))}
        </div>
      </div>

      {headerType === "TEXT" && (
        <div>
          <div className="flex items-center justify-between mb-1 text-[11px] text-neutral-500">
            <span>Bold title shown above the message</span>
            <span>{headerText.length}/60</span>
          </div>
          <input
            type="text"
            maxLength={60}
            value={headerText}
            onChange={(e) => setHeaderText(e.target.value)}
            placeholder="e.g. New Clear Acrylic Podiums"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </div>
      )}

      {(headerType === "IMAGE" ||
        headerType === "VIDEO" ||
        headerType === "DOCUMENT") && (
        <div className="space-y-2">
          <input
            type="url"
            value={headerMediaUrl}
            onChange={(e) => setHeaderMediaUrl(e.target.value)}
            placeholder={
              headerType === "IMAGE"
                ? "https://www.classicconcepts.in/.../product.jpg"
                : headerType === "VIDEO"
                ? "https://www.classicconcepts.in/.../demo.mp4"
                : "https://www.classicconcepts.in/.../catalog.pdf"
            }
            className="w-full rounded-md border border-neutral-300 px-3 py-2 font-mono"
          />
          {headerType === "IMAGE" && catalogMedia.length > 0 && (
            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">
                Or pick a product / machine image from Classic Concepts &amp; Classic Edge 53:
              </label>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) setHeaderMediaUrl(e.target.value);
                }}
                className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 bg-white"
              >
                <option value="">Select a catalog photo to insert...</option>
                {catalogMedia.map((item, idx) => (
                  <option key={idx} value={item.imageUrl}>
                    [{item.brandLabel}] {item.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {headerType === "LOCATION" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <input
            type="text"
            value={headerLocation.name}
            onChange={(e) =>
              setHeaderLocation((p) => ({ ...p, name: e.target.value }))
            }
            placeholder="Location Name"
            className="rounded-md border border-neutral-300 px-3 py-1.5"
          />
          <input
            type="text"
            value={headerLocation.address}
            onChange={(e) =>
              setHeaderLocation((p) => ({ ...p, address: e.target.value }))
            }
            placeholder="Street Address & City"
            className="rounded-md border border-neutral-300 px-3 py-1.5"
          />
          <input
            type="number"
            step="0.0001"
            value={headerLocation.latitude}
            onChange={(e) =>
              setHeaderLocation((p) => ({
                ...p,
                latitude: Number(e.target.value),
              }))
            }
            placeholder="Latitude"
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-mono"
          />
          <input
            type="number"
            step="0.0001"
            value={headerLocation.longitude}
            onChange={(e) =>
              setHeaderLocation((p) => ({
                ...p,
                longitude: Number(e.target.value),
              }))
            }
            placeholder="Longitude"
            className="rounded-md border border-neutral-300 px-3 py-1.5 font-mono"
          />
        </div>
      )}
    </div>
  );
}
