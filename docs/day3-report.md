# Báo cáo Ngày 3 — Deposit Core Logic

**Trạng thái:** 5 hàm đã thêm vào `SavingCore.sol`, compile sạch. Đã qua 1 vòng review — phát hiện và sửa 1 lỗ hổng reentrancy trong `openDeposit` trước khi chốt.

**Phạm vi đã code:** `openDeposit`, `calculateInterest`, `calculatePenalty`, `withdrawAtMaturity`, `earlyWithdraw`.

---

## 1. `openDeposit` — lỗ hổng reentrancy đã phát hiện và sửa

**Bản đầu tiên** có thứ tự:
```solidity
deposits[depositId] = Deposit({ ... status: Status.Active ... });  // state đã "Active"
_safeMint(msg.sender, depositId);                                   // (1) mint trước
depositToken.safeTransferFrom(msg.sender, address(this), amount);   // (2) tiền vào sau
```

**Vấn đề:** `_safeMint` tự động gọi callback `onERC721Received` nếu `msg.sender` là 1 smart contract (tính năng chuẩn của ERC721, không phải bug OpenZeppelin). Nếu kẻ tấn công dùng 1 contract độc hại gọi `openDeposit`, callback này chạy **trước khi tiền thật sự vào contract** — tại thời điểm đó `deposits[depositId].status` đã là `Active` và `ownerOf(depositId)` đã trả về đúng địa chỉ kẻ tấn công. Kẻ tấn công gọi ngược vào `earlyWithdraw()` ngay trong callback, mọi `require` đều pass, contract chuyển tiền thật (lấy từ số dư của **user khác** đang nằm sẵn trong contract) — trong khi kẻ tấn công **chưa hề nộp một đồng nào**.

**Bản đã sửa** — đảo thứ tự 2 dòng cuối + thêm `nonReentrant`:
```solidity
depositToken.safeTransferFrom(msg.sender, address(this), amount);   // tiền vào TRƯỚC
_safeMint(msg.sender, depositId);                                    // mint SAU
```
Với `nonReentrant`: khóa dùng chung cho toàn contract, "đóng" ngay khi `openDeposit` bắt đầu chạy — nên nếu callback cố gọi ngược vào **bất kỳ hàm nào có `nonReentrant`** khác (`earlyWithdraw`, `withdrawAtMaturity`), cuộc gọi đó **revert ngay lập tức**. Đây là 2 lớp phòng thủ độc lập (defense in depth): mất 1 lớp vẫn còn lớp kia chặn lại — không chỉ đơn thuần "không có tiền ảo để rút" mà là chặn triệt để mọi lời gọi lồng nhau vào hàm có `nonReentrant`.

**Đây là ví dụ thật, không phải lý thuyết, cho câu hỏi mở #7 (Attack thinking)** — bạn có sẵn 1 case study cụ thể: mô tả đúng lỗ hổng này, dòng code nào gây ra nó, dòng nào sửa nó.

---

## 2. `calculateInterest` / `calculatePenalty` — verify công thức bằng số thực

Chạy lại bằng BigInt (chính xác tuyệt đối) với Personal Variant của bạn — gửi 1,000 USDC vào default plan (90 ngày, APR 4.00%, penalty 4.00%):

| | Giá trị (đơn vị nhỏ nhất, 6 decimals) | Quy đổi USDC |
|---|---|---|
| `calculateInterest` | 9,863,013 | 9.863013 USDC |
| Payout `withdrawAtMaturity` | 1,009,863,013 | 1,009.863013 USDC |
| `calculatePenalty` | 40,000,000 | 40.00 USDC |
| Payout `earlyWithdraw` | 960,000,000 | 960.00 USDC |

Khớp công thức nhân trước chia sau đã thiết kế ở Ngày 1. Lưu số này lại làm test case chuẩn (`expect(interest).to.equal(9863013)`) khi viết Hardhat test ở Ngày 5.

**Điểm cần lưu ý (không phải bug, chỉ là giả định ngầm):** `calculateInterest` đọc `tenorDays` trực tiếp từ `plans[dep.planId].tenorDays` tại thời điểm gọi, không snapshot riêng. An toàn với code hiện tại vì không có hàm nào cho phép đổi `tenorDays` sau khi tạo plan — nhưng nếu sau này bạn thêm tính năng đó, đây là chỗ cần snapshot bổ sung.

---

## 3. `withdrawAtMaturity` — vì sao không cần code thêm để enforce Business Rule #5

```solidity
depositToken.safeTransfer(msg.sender, principal);
vault.payInterest(msg.sender, interest);  // có thể revert nếu vault không đủ tiền
```

Vì giao dịch Solidity có tính **atomic**, nếu `vault.payInterest` revert (vault không đủ tiền), **toàn bộ hàm bị rollback** — kể cả `safeTransfer` principal đã chạy trước đó. Business Rule #5 tự động đúng nhờ tính atomic của EVM, không cần thêm logic gì khác.

---

## 4. `earlyWithdraw` — xác nhận đúng Business Rule #3

Không có bất kỳ lời gọi nào đến `calculateInterest` trong toàn bộ hàm — `interest` luôn là `0` trong event `Withdrawn`. Phòng thủ bằng thiết kế: không phải trả về `0` sau khi tính, mà **không hề có đường dẫn code nào tính lãi trong luồng rút sớm**.

---

## 5. Đối chiếu checklist invariant sau Ngày 3

| # | Invariant | Trạng thái |
|---|---|---|
| 1 | APR & penalty snapshot | `openDeposit` copy giá trị vào `aprBpsAtOpen`/`penaltyBpsAtOpen` |
| 2 | Simple interest | `calculateInterest`, verify khớp công thức Ngày 1 |
| 3 | Rút sớm = lãi 0 | `earlyWithdraw` không có đường code nào gọi `calculateInterest` |
| 4 | Auto-renew giữ APR gốc | Chưa code |
| 5 | Lãi luôn từ vault | Tự động đúng nhờ tính atomic của transaction |
| 6 | Pause chặn rút/renew | `openDeposit`, `withdrawAtMaturity`, `earlyWithdraw` đều có `whenNotPaused` |
| 7 | Admin không sửa deposit đã mở | (đã đúng từ Ngày 2, không đổi) |
| — | Double withdraw | Check `status == Active` chặn rút 2 lần |
| — | Reentrancy | Đã phát hiện + sửa (mục 1) |

---

## File thay đổi

- `contracts/SavingCore.sol` (cập nhật — thêm 5 hàm Deposit logic)

**Đã verify compile thành công bằng `solc`, không lỗi không cảnh báo.**