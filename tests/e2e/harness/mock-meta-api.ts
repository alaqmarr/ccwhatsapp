export interface MockSentMessageRecord {
  timestamp: string;
  url: string;
  headers: Record<string, string>;
  payload: {
    messaging_product?: string;
    recipient_type?: string;
    to?: string;
    type?: string;
    text?: { body: string; preview_url?: boolean };
    template?: {
      name: string;
      language: { code: string };
      components?: Array<{
        type: string;
        sub_type?: string;
        index?: number;
        parameters?: Array<{ type: string; text?: string; image?: unknown }>;
      }>;
    };
    context?: { message_id: string };
    [key: string]: unknown;
  };
}

export interface MockClaudeCallRecord {
  timestamp: string;
  model: string;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
}

export interface MockTemplateFixture {
  id: string;
  name: string;
  status: "APPROVED" | "PENDING" | "REJECTED" | "PAUSED";
  category: "MARKETING" | "UTILITY" | "AUTHENTICATION";
  language: string;
  components: Array<{
    type: "HEADER" | "BODY" | "FOOTER" | "BUTTONS";
    format?: "TEXT" | "IMAGE" | "DOCUMENT" | "VIDEO";
    text?: string;
    buttons?: Array<{
      type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER";
      text: string;
      url?: string;
      phone_number?: string;
    }>;
  }>;
}

export const MOCK_META_TEMPLATES: MockTemplateFixture[] = [
  {
    id: "meta_tpl_order_confirm_001",
    name: "order_confirmation",
    status: "APPROVED",
    category: "UTILITY",
    language: "en_US",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "Order Update",
      },
      {
        type: "BODY",
        text: "Hello {{1}}, your acrylic order {{2}} has been confirmed and scheduled for dispatch.",
      },
      {
        type: "FOOTER",
        text: "Classic Concepts Acrylic",
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "QUICK_REPLY",
            text: "Track Order",
          },
          {
            type: "URL",
            text: "View Details",
            url: "https://ccapl.cc/ord101",
          },
        ],
      },
    ],
  },
  {
    id: "meta_tpl_acrylic_promo_002",
    name: "acrylic_sheet_promo",
    status: "APPROVED",
    category: "MARKETING",
    language: "en",
    components: [
      {
        type: "HEADER",
        format: "IMAGE",
      },
      {
        type: "BODY",
        text: "Hi {{1}}, explore our crystal-clear cast acrylic sheets with 92% light transmission and superior laser-cut edges.",
      },
      {
        type: "FOOTER",
        text: "Classic Concepts",
      },
      {
        type: "BUTTONS",
        buttons: [
          {
            type: "URL",
            text: "Browse Catalog",
            url: "https://ccapl.cc/sheets",
          },
        ],
      },
    ],
  },
  {
    id: "meta_tpl_quote_ready_003",
    name: "quote_ready",
    status: "APPROVED",
    category: "UTILITY",
    language: "en",
    components: [
      {
        type: "BODY",
        text: "Hello {{1}}, your quotation for {{2}} is ready. The total estimate is Rs {{3}}.",
      },
      {
        type: "FOOTER",
        text: "Classic Concepts Hyderabad",
      },
    ],
  },
];

export const MOCK_INBOUND_MEDIA_PAYLOADS = {
  image: (params?: { from?: string; mediaId?: string; caption?: string; timestamp?: string }) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+919876543210",
                phone_number_id: "phone_id_test_101",
              },
              contacts: [{ profile: { name: "Rajesh Kumar" }, wa_id: params?.from || "919848011223" }],
              messages: [
                {
                  from: params?.from || "919848011223",
                  id: `wamid.inbound_img_${Date.now()}`,
                  timestamp: params?.timestamp || String(Math.floor(Date.now() / 1000)),
                  type: "image",
                  image: {
                    id: params?.mediaId || "media_img_sample_101",
                    mime_type: "image/jpeg",
                    sha256: "mock_sha256_hash_value_12345",
                    caption: params?.caption || "Clear cast acrylic sheet 3mm photo",
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
  document: (params?: { from?: string; mediaId?: string; filename?: string; caption?: string; timestamp?: string }) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+919876543210",
                phone_number_id: "phone_id_test_101",
              },
              contacts: [{ profile: { name: "Anil Sharma" }, wa_id: params?.from || "919848011224" }],
              messages: [
                {
                  from: params?.from || "919848011224",
                  id: `wamid.inbound_doc_${Date.now()}`,
                  timestamp: params?.timestamp || String(Math.floor(Date.now() / 1000)),
                  type: "document",
                  document: {
                    id: params?.mediaId || "media_doc_sample_202",
                    mime_type: "application/pdf",
                    filename: params?.filename || "Purchase_Order_PO991.pdf",
                    sha256: "mock_sha256_doc_hash_54321",
                    caption: params?.caption || "Official purchase order for acrylic podiums",
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
  video: (params?: { from?: string; mediaId?: string; caption?: string; timestamp?: string }) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+919876543210",
                phone_number_id: "phone_id_test_101",
              },
              contacts: [{ profile: { name: "Sunil Verma" }, wa_id: params?.from || "919848011225" }],
              messages: [
                {
                  from: params?.from || "919848011225",
                  id: `wamid.inbound_vid_${Date.now()}`,
                  timestamp: params?.timestamp || String(Math.floor(Date.now() / 1000)),
                  type: "video",
                  video: {
                    id: params?.mediaId || "media_vid_sample_303",
                    mime_type: "video/mp4",
                    sha256: "mock_sha256_vid_hash",
                    caption: params?.caption || "Laser cutting acrylic edge demo",
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
  audio: (params?: { from?: string; mediaId?: string; voice?: boolean; timestamp?: string }) => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "+919876543210",
                phone_number_id: "phone_id_test_101",
              },
              contacts: [{ profile: { name: "Deepak Rao" }, wa_id: params?.from || "919848011226" }],
              messages: [
                {
                  from: params?.from || "919848011226",
                  id: `wamid.inbound_aud_${Date.now()}`,
                  timestamp: params?.timestamp || String(Math.floor(Date.now() / 1000)),
                  type: "audio",
                  audio: {
                    id: params?.mediaId || "media_aud_sample_404",
                    mime_type: "audio/ogg; codecs=opus",
                    sha256: "mock_sha256_audio_hash",
                    voice: params?.voice ?? true,
                  },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
};

export const MOCK_STATUS_RECEIPTS = {
  delivered: (waMessageId: string, recipientPhone = "919848011223") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+919876543210", phone_number_id: "phone_id_test_101" },
              statuses: [
                {
                  id: waMessageId,
                  status: "delivered",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: recipientPhone,
                  conversation: { id: "conv_meta_123", origin: { type: "service" } },
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
  read: (waMessageId: string, recipientPhone = "919848011223") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+919876543210", phone_number_id: "phone_id_test_101" },
              statuses: [
                {
                  id: waMessageId,
                  status: "read",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: recipientPhone,
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
  failed: (waMessageId: string, errorCode = 131026, errorMessage = "Receiver is incapable of receiving this message") => ({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba_test_123",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "+919876543210", phone_number_id: "phone_id_test_101" },
              statuses: [
                {
                  id: waMessageId,
                  status: "failed",
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  recipient_id: "919848011223",
                  errors: [
                    {
                      code: errorCode,
                      title: errorMessage,
                      message: errorMessage,
                      error_data: { details: errorMessage },
                    },
                  ],
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  }),
};

/**
 * Controller to intercept and mock Meta Graph API and Claude API requests globally.
 */
export class MockMetaController {
  private originalFetch: typeof globalThis.fetch | null = null;
  private isInstalled = false;

  readonly sentMessages: MockSentMessageRecord[] = [];
  readonly templateSyncCalls: Array<{ url: string; headers: Record<string, string> }> = [];
  readonly mediaRequests: Array<{ url: string; headers: Record<string, string> }> = [];
  readonly claudeCalls: MockClaudeCallRecord[] = [];

  customClaudeResponse: string | null = null;
  templatesFixture: MockTemplateFixture[] = [...MOCK_META_TEMPLATES];
  paginatedTemplatePages: Array<Array<Record<string, unknown>>> | null = null;
  nextGraphError: { message: string; type: string; code: number; error_subcode?: number } | null = null;

  install(): this {
    if (this.isInstalled) return this;

    this.originalFetch = globalThis.fetch;
    const self = this;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      // 1. Meta Graph API: Send WhatsApp message
      if (/graph\.facebook\.com\/v\d+\.\d+\/[^/]+\/messages/i.test(urlStr)) {
        const rawHeaders: Record<string, string> = {};
        if (init?.headers) {
          const headersObj = new Headers(init.headers);
          headersObj.forEach((val, key) => {
            rawHeaders[key.toLowerCase()] = val;
          });
        }

        let payload: Record<string, unknown> = {};
        try {
          payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        } catch {
          // ignore parsing error
        }

        self.sentMessages.push({
          timestamp: new Date().toISOString(),
          url: urlStr,
          headers: rawHeaders,
          payload,
        });

        if (self.nextGraphError) {
          const err = self.nextGraphError;
          self.nextGraphError = null;
          return new Response(JSON.stringify({ error: err }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        const toPhone = String(payload.to || "919848011223");
        const waMessageId = `wamid.HBg${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

        return new Response(
          JSON.stringify({
            messaging_product: "whatsapp",
            contacts: [{ input: toPhone, wa_id: toPhone }],
            messages: [{ id: waMessageId }],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // 2. Meta Graph API: Sync Templates
      if (/graph\.facebook\.com\/v\d+\.\d+\/[^/]+\/message_templates/i.test(urlStr)) {
        self.templateSyncCalls.push({
          url: urlStr,
          headers: {},
        });

        if (self.paginatedTemplatePages && self.paginatedTemplatePages.length > 0) {
          const isPage2 = urlStr.includes("after=cur_page_2");
          const pageData = isPage2
            ? self.paginatedTemplatePages[1] || []
            : self.paginatedTemplatePages[0] || [];

          return new Response(
            JSON.stringify({
              data: pageData,
              paging: isPage2
                ? { cursors: { after: "cur_page_end" } }
                : {
                    cursors: { after: "cur_page_2" },
                    next: `https://graph.facebook.com/v21.0/2195463394700930/message_templates?after=cur_page_2`,
                  },
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          );
        }

        return new Response(
          JSON.stringify({
            data: self.templatesFixture,
            paging: {
              cursors: {
                before: "cur_before_123",
                after: "cur_after_456",
              },
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // 3. Meta Graph API: Inbound Media Metadata Query (e.g. GET /v21.0/media_img_101)
      if (/graph\.facebook\.com\/v\d+\.\d+\/(media_[a-z0-9_]+|[0-9]{10,})/i.test(urlStr)) {
        const match = urlStr.match(/graph\.facebook\.com\/v\d+\.\d+\/([^/?]+)/i);
        const mediaId = match ? match[1] : "media_img_101";

        const rawHeaders: Record<string, string> = {};
        if (init?.headers) {
          const headersObj = new Headers(init.headers);
          headersObj.forEach((val, key) => {
            rawHeaders[key.toLowerCase()] = val;
          });
        }

        self.mediaRequests.push({ url: urlStr, headers: rawHeaders });

        if (self.nextGraphError) {
          const err = self.nextGraphError;
          self.nextGraphError = null;
          return new Response(JSON.stringify({ error: err }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({
            messaging_product: "whatsapp",
            url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${mediaId}`,
            mime_type: mediaId.includes("doc") ? "application/pdf" : "image/jpeg",
            sha256: "mocksha256hash1234567890",
            file_size: 4096,
            id: mediaId,
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // 4. Meta Media Download lookaside CDN
      if (/lookaside\.fbsbx\.com/i.test(urlStr)) {
        const rawHeaders: Record<string, string> = {};
        if (init?.headers) {
          const headersObj = new Headers(init.headers);
          headersObj.forEach((val, key) => {
            rawHeaders[key.toLowerCase()] = val;
          });
        }
        self.mediaRequests.push({ url: urlStr, headers: rawHeaders });

        // Deterministic mock binary payload (1x1 transparent PNG / mock PDF header)
        const isPdf = urlStr.includes("doc");
        const mockBinary = isPdf
          ? Buffer.from("%PDF-1.4\n%mock PDF content for testing ccwhatsapp media route\n%%EOF")
          : Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00\xff\xff\xff\x00\x00\x00!\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00\x00\x02\x02D\x01\x00;");

        return new Response(mockBinary, {
          status: 200,
          headers: {
            "content-type": isPdf ? "application/pdf" : "image/jpeg",
            "content-length": String(mockBinary.length),
            "cache-control": "private, max-age=86400",
          },
        });
      }

      // 5. Anthropic Claude API Messages
      if (/api\.anthropic\.com\/v1\/messages/i.test(urlStr)) {
        let payload: Record<string, unknown> = {};
        try {
          payload = typeof init?.body === "string" ? JSON.parse(init.body) : {};
        } catch {
          // ignore
        }

        self.claudeCalls.push({
          timestamp: new Date().toISOString(),
          model: String(payload.model || ""),
          system: typeof payload.system === "string" ? payload.system : undefined,
          messages: Array.isArray(payload.messages) ? (payload.messages as Array<{ role: string; content: string }>) : [],
          max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : undefined,
          temperature: typeof payload.temperature === "number" ? payload.temperature : undefined,
        });

        const replyText =
          self.customClaudeResponse ||
          "Hello! We can help you with acrylic sheets, acrylic podiums, and custom fabrication. How can we assist?";

        return new Response(
          JSON.stringify({
            id: `msg_claude_${Date.now()}`,
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: replyText }],
            model: "claude-haiku-5-5",
            stop_reason: "end_turn",
            usage: { input_tokens: 45, output_tokens: 60 },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        );
      }

      // Pass through or fallback for any other HTTP requests
      if (self.originalFetch) {
        return self.originalFetch(input, init);
      }
      return new Response("Not Found", { status: 404 });
    }) as typeof globalThis.fetch;

    this.isInstalled = true;
    return this;
  }

  restore(): void {
    if (this.isInstalled && this.originalFetch) {
      globalThis.fetch = this.originalFetch;
      this.originalFetch = null;
      this.isInstalled = false;
    }
  }

  reset(): void {
    this.sentMessages.length = 0;
    this.templateSyncCalls.length = 0;
    this.mediaRequests.length = 0;
    this.claudeCalls.length = 0;
    this.customClaudeResponse = null;
    this.templatesFixture = [...MOCK_META_TEMPLATES];
    this.paginatedTemplatePages = null;
    this.nextGraphError = null;
  }

  getLastSentMessage(): MockSentMessageRecord | undefined {
    return this.sentMessages[this.sentMessages.length - 1];
  }

  getLastClaudeCall(): MockClaudeCallRecord | undefined {
    return this.claudeCalls[this.claudeCalls.length - 1];
  }

  setClaudeResponse(text: string): void {
    this.customClaudeResponse = text;
  }

  setTemplates(templates: MockTemplateFixture[]): void {
    this.templatesFixture = [...templates];
  }

  setNextGraphError(err: { message: string; type: string; code: number; error_subcode?: number }): void {
    this.nextGraphError = err;
  }
}

export const mockMeta = new MockMetaController();
