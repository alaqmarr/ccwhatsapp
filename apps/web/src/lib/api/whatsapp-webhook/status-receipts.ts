import { applyWhatsAppMessageReceipt } from "@cc/workers";

const RECEIPT_BATCH_SIZE = 15;
const VALID_RECEIPT_STATUSES = new Set(["SENT", "DELIVERED", "READ", "FAILED"]);

export async function handleStatusReceipts(statuses: any[]): Promise<void> {
  if (!Array.isArray(statuses) || statuses.length === 0) return;

  const validItems = statuses.filter((st) => {
    const waId = String(st?.id || "");
    const rawStatus = String(st?.status || "").toUpperCase();
    return Boolean(waId && VALID_RECEIPT_STATUSES.has(rawStatus));
  });

  for (let i = 0; i < validItems.length; i += RECEIPT_BATCH_SIZE) {
    const batch = validItems.slice(i, i + RECEIPT_BATCH_SIZE);
    await Promise.all(
      batch.map((st) => {
        const waId = String(st?.id || "");
        const rawStatus = String(st?.status || "").toUpperCase() as
          | "SENT"
          | "DELIVERED"
          | "READ"
          | "FAILED";
        const firstErr =
          Array.isArray(st?.errors) && st.errors.length > 0 ? st.errors[0] : null;
        const errorCode = firstErr?.code != null ? String(firstErr.code) : null;
        const errorMessage =
          firstErr?.message ||
          firstErr?.title ||
          firstErr?.error_data?.details ||
          null;
        const errorDetails = firstErr?.error_data?.details || null;

        let stTimestampIso: string | undefined;
        if (st?.timestamp) {
          const epochSec = Number(st.timestamp);
          if (!Number.isNaN(epochSec) && epochSec > 0) {
            stTimestampIso = new Date(epochSec * 1000).toISOString();
          }
        }

        return applyWhatsAppMessageReceipt({
          waMessageId: waId,
          status: rawStatus,
          errorCode,
          errorMessage,
          errorDetails,
          timestampIso: stTimestampIso,
        });
      })
    );
  }
}
