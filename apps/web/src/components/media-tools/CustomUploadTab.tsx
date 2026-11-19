"use client";

import React, { useRef } from "react";
import {
  FileText,
  Film,
  Image as ImageIcon,
  Loader2,
  Paperclip,
} from "lucide-react";

export function CustomUploadTab({
  uploading,
  onFileSelected,
}: {
  uploading: boolean;
  onFileSelected: (file: File) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer?.files?.[0];
        if (f) onFileSelected(f);
      }}
      className="border-2 border-dashed border-[#00a884]/45 hover:border-[#00a884] rounded-xl p-4 sm:p-6 text-center bg-[#f8fbf9] transition"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.cdr,.dxf,.ai"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFileSelected(f);
          e.target.value = "";
        }}
      />
      <div className="flex justify-center gap-2 mb-2 text-[#008069]">
        <ImageIcon className="w-6 h-6" />
        <Film className="w-6 h-6" />
        <FileText className="w-6 h-6" />
      </div>
      <div className="text-xs font-semibold text-[#111b21]">
        Drag and drop any Image, Video, PDF, Quotation, or CAD/Design file here
      </div>
      <p className="text-[11px] text-[#667781] mt-1">
        Supports JPG, PNG, WEBP, MP4, MOV, PDF, DOCX, XLSX, CSV, DXF, CDR, ZIP (up to 64 MB)
      </p>
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="mt-3 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
      >
        {uploading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Uploading...</span>
          </>
        ) : (
          <>
            <Paperclip className="w-3.5 h-3.5" />
            <span>Choose File from Device</span>
          </>
        )}
      </button>
    </div>
  );
}
