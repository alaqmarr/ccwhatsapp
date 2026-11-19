"use client";

import React from "react";
import { Loader2, Search } from "lucide-react";
import { PdfLibraryTab } from "@/components/media-tools/PdfLibraryTab";
import type {
  CatalogMediaProduct,
  CatalogMediaResource,
  StagedComposerAttachment,
} from "@/components/media-tools/types";

export function CataloguePickerTab({
  searchQuery,
  onSearchChange,
  catalogLoading,
  products,
  resources,
  onStageAndClose,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  catalogLoading: boolean;
  products: CatalogMediaProduct[];
  resources: CatalogMediaResource[];
  onStageAndClose: (att: StagedComposerAttachment) => void;
}) {
  return (
    <div className="space-y-2.5">
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-[#667781] absolute left-2.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search product (e.g. CCP054, CCP111, Chair), variant colour, or PDF catalogue..."
          className="w-full rounded-lg border border-[#d1d7db] pl-8 pr-3 py-1.5 text-xs text-[#111b21] focus:outline-none focus:border-[#00a884]"
        />
      </div>

      <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
        {catalogLoading && (
          <div className="py-6 text-center text-xs text-[#667781] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#00a884]" />
            <span>Loading catalog media & PDF brochures...</span>
          </div>
        )}

        {!catalogLoading && (
          <PdfLibraryTab
            resources={resources}
            onSelectPdf={onStageAndClose}
          />
        )}

        {!catalogLoading && products.length > 0 && (
          <div className="space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[#54656f]">
              Product & Variant Photos ({products.length})
            </div>
            {products.map((prod) => {
              const priceLabel =
                typeof prod.basePrice === "number" && prod.basePrice > 0
                  ? `₹${prod.basePrice.toLocaleString("en-IN")}`
                  : "";
              return (
                <div
                  key={prod.id}
                  className="rounded-lg border border-[#e2e8f0] p-2.5 bg-[#f8fafc] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-xs font-bold text-[#111b21]">
                        {prod.name}
                      </span>
                      {priceLabel && (
                        <span className="ml-1.5 text-xs font-semibold text-[#008069]">
                          ({priceLabel})
                        </span>
                      )}
                      <span className="ml-2 text-[11px] text-[#667781]">
                        {prod.categoryName}
                      </span>
                    </div>
                    {prod.mainImage && (
                      <button
                        type="button"
                        onClick={() =>
                          onStageAndClose({
                            mediaType: "IMAGE",
                            url: prod.mainImage!,
                            fileName: `${prod.slug}.jpg`,
                            mimeType: "image/jpeg",
                            productName: prod.name,
                            suggestedCaption: `*${prod.name}*${priceLabel ? ` (${priceLabel})` : ""}\n${prod.shortUrl}`,
                          })
                        }
                        className="px-2.5 py-1 rounded bg-[#00a884] hover:bg-[#008f6f] text-white text-[11px] font-semibold cursor-pointer shrink-0"
                      >
                        Attach Main Photo
                      </button>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {prod.variants.map((v) => {
                      const vPrice =
                        typeof v.price === "number" && v.price > 0
                          ? `₹${v.price.toLocaleString("en-IN")}`
                          : priceLabel;
                      return (
                        <button
                          key={v.id}
                          type="button"
                          onClick={() => {
                            if (!v.imageUrl) return;
                            onStageAndClose({
                              mediaType: "IMAGE",
                              url: v.imageUrl,
                              fileName: `${prod.slug}-${v.name
                                .toLowerCase()
                                .replace(/\s+/g, "-")}.jpg`,
                              mimeType: "image/jpeg",
                              productName: prod.name,
                              variantName: v.name,
                              suggestedCaption: `*${prod.name}* - *${v.name}* variant${vPrice ? ` (${vPrice})` : ""}\n${prod.shortUrl}`,
                            });
                          }}
                          className="inline-flex items-center gap-1.5 p-1 pr-2.5 rounded-md bg-white border border-[#d1d7db] hover:border-[#00a884] text-left cursor-pointer transition"
                          title={`Attach ${v.name} variant photo`}
                        >
                          {v.imageUrl && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={v.imageUrl}
                              alt={v.name}
                              className="w-8 h-8 rounded object-cover border border-neutral-200 bg-white shrink-0"
                            />
                          )}
                          <div>
                            <div className="text-[11px] font-semibold text-[#111b21]">
                              {v.name}
                            </div>
                            {vPrice && (
                              <div className="text-[10px] text-[#008069]">
                                {vPrice}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}

                    {prod.images.slice(1, 5).map((imgUrl, idx) => (
                      <button
                        key={imgUrl}
                        type="button"
                        onClick={() =>
                          onStageAndClose({
                            mediaType: "IMAGE",
                            url: imgUrl,
                            fileName: `${prod.slug}-photo-${idx + 2}.jpg`,
                            mimeType: "image/jpeg",
                            productName: prod.name,
                            suggestedCaption: `*${prod.name}* (Photo ${idx + 2})\n${prod.shortUrl}`,
                          })
                        }
                        className="inline-flex items-center gap-1.5 p-1 pr-2 rounded-md bg-white border border-[#d1d7db] hover:border-[#00a884] text-[11px] text-[#54656f] cursor-pointer"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={imgUrl}
                          alt={`Photo ${idx + 2}`}
                          className="w-8 h-8 rounded object-cover border border-neutral-200 bg-white"
                        />
                        <span>Photo {idx + 2}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
