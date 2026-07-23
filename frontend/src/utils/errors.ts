/** Trích và chuẩn hóa lỗi ethers v6 để UI không hiển thị raw RPC dài hoặc custom error mơ hồ. */
export function extractError(err: unknown): string {
  const fallback = "Giao dịch thất bại. Vui lòng thử lại.";
  if (typeof err !== "object" || err === null) return fallback;

  const error = err as Record<string, unknown>;
  const info = error.info as Record<string, unknown> | undefined;
  const nestedError = info?.error as Record<string, unknown> | undefined;
  const messages = [error.shortMessage, error.reason, nestedError?.message, error.message]
    .filter((message): message is string => typeof message === "string" && message.trim().length > 0);
  const combined = messages.join(" ").toLowerCase();

  if (error.code === "ACTION_REJECTED" || error.code === 4001 || /user rejected|user denied|rejected the request/.test(combined)) {
    return "Bạn đã từ chối giao dịch trong MetaMask";
  }
  if (error.code === "INSUFFICIENT_FUNDS" || /insufficient funds/.test(combined)) {
    return "Không đủ ETH để trả phí gas hoặc số dư cho giao dịch";
  }
  if (/erc20insufficientbalance|erc20: transfer amount exceeds balance|insufficient balance/.test(combined)) {
    return "Số dư MockUSDC không đủ";
  }
  if (/erc20insufficientallowance|insufficient allowance|transfer amount exceeds allowance/.test(combined)) {
    return "Allowance MockUSDC không đủ";
  }
  if (/enforcedpause|paused/.test(combined)) {
    return "Hệ thống đang tạm dừng";
  }
  if (/accesscontrol|unauthorizedaccount|missing role|not admin/.test(combined)) {
    return "Tài khoản không có quyền thực hiện thao tác này";
  }
  if (/erc721incorrectowner|not owner|owner query for nonexistent token|erc721nonexistenttoken/.test(combined)) {
    return "Bạn không còn là chủ sở hữu NFT của deposit này";
  }
  if (/rpc|failed to fetch|network error|timeout|missing response/.test(combined)) {
    return "Không thể kết nối RPC. Vui lòng kiểm tra mạng rồi thử lại.";
  }

  const readable = messages.find((message) => !/unknown custom error|missing revert data/i.test(message));
  if (!readable) return "Giao dịch bị contract từ chối. Vui lòng kiểm tra lại điều kiện thực hiện.";
  const normalized = readable.replace(/\s+/g, " ").trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}
