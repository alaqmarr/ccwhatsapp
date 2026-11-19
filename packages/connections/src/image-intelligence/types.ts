import type { AiTokenUsage } from "@cc/database";

export type SupportedVisionMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "image/gif";

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: SupportedVisionMimeType;
        data: string;
      };
    };

export interface CustomerImageAttachmentInput {
  mediaId?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
  sha256?: string;
  isSticker?: boolean;
  /** In-memory fixture or pre-downloaded bytes for tests / local staging. */
  buffer?: Buffer | Uint8Array;
}

export interface ImageValidationResult {
  ok: boolean;
  mimeType?: SupportedVisionMimeType;
  buffer?: Buffer;
  base64?: string;
  byteLength?: number;
  sha256?: string;
  safeFileName?: string;
  errorCode?:
    | "MISSING_MEDIA_ID"
    | "UNSUPPORTED_MEDIA_TYPE"
    | "INVALID_IMAGE_TYPE"
    | "INVALID_IMAGE_SIGNATURE"
    | "OVERSIZED_IMAGE"
    | "SSRF_BLOCKED"
    | "MEDIA_FETCH_FAILED"
    | "EMPTY_OR_CORRUPT";
  errorMessage?: string;
}

export interface CustomerImageAnalysis {
  sha256: string;
  mimeType: SupportedVisionMimeType;
  analyzedAt: string;
  fromCache: boolean;
  productType: string;
  productFamily: string | null;
  businessDomain: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53" | "BOTH" | "UNKNOWN";
  shapeAndDesign: string;
  colorAppearance: string;
  materialAppearance: string;
  visibleComponents: string[];
  readableModelCodes: string[];
  readableDimensions: string | null;
  readableSpecifications: string[];
  identifiedApplication: string | null;
  recommendedSearchQuery: string;
  isDesignSketchOrDrawing: boolean;
  needsCustomFabrication: boolean;
  needsNameplateOrDimensions: boolean;
  unreadableDetails: string[];
  promptInjectionDetected: boolean;
  customerObservationSummary: string;
  analysisTokenUsage?: AiTokenUsage | null;
}

export interface VisionCallResult {
  ok: boolean;
  text: string | null;
  usage: AiTokenUsage | null;
  error: string | null;
}

export type VisionClaudeCaller = (params: {
  system: string;
  messages: { role: "user" | "assistant"; content: string | AnthropicContentBlock[] }[];
  maxTokens?: number;
  effort?: "low" | "medium";
  timeoutMs?: number;
}) => Promise<VisionCallResult>;
