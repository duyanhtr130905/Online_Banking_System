/**
 * Trích revert reason từ error object của ethers v6.
 * Ưu tiên: error.reason → error.shortMessage → fallback message.
 * Dùng chung cho mọi component cần hiển thị lỗi giao dịch.
 */
export function extractError(err: unknown): string {
  const fallback = "Giao dịch thất bại. Vui lòng thử lại.";
  if (typeof err !== "object" || err === null) return fallback;

  const e = err as Record<string, unknown>;
  if (e.code === "ACTION_REJECTED" || e.code === 4001) {
    return "Bạn đã từ chối giao dịch trong ví.";
  }

  const info = e.info as Record<string, unknown> | undefined;
  const nestedError = info?.error as Record<string, unknown> | undefined;
  const candidates = [e.reason, e.shortMessage, nestedError?.message, e.message];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      const message = value.replace(/\s+/g, " ").trim();
      if (/user rejected|user denied|rejected the request/i.test(message)) {
        return "Bạn đã từ chối giao dịch trong ví.";
      }
      return message.length > 220 ? `${message.slice(0, 217)}...` : message;
    }
  }
  return fallback;
}
