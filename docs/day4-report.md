# Báo cáo Ngày 4 — Renew Logic

**Trạng thái:** Đã thêm state variable `gracePeriodSeconds`, hàm `setGracePeriod`, và 2 hàm `renewDeposit`/`autoRenewDeposit`.

---

## 1. Xác nhận Business Rule #4 (auto-renew giữ APR gốc)

Verify bằng kịch bản cụ thể: deposit gốc 1,000 USDC, `aprBpsAtOpen` snapshot = 400 bps. Giả sử **sau đó** admin gọi `updatePlan()` hạ APR của plan xuống 100 bps, rồi bot mới gọi `autoRenewDeposit`.

Code đọc `deposits[depositId].aprBpsAtOpen` (giá trị cũ đã snapshot = 400 bps) để gán cho deposit mới — **không** đọc `plans[planId].aprBps` hiện tại (100 bps). Đây chính xác là hành vi đúng: dù admin đã âm thầm hạ lãi suất, deposit đang tự động gia hạn vẫn được bảo vệ theo đúng cam kết ban đầu.

Ngược lại, `renewDeposit` (manual) đọc `newPlan.aprBps` — **đúng** vì đây là user **chủ động chọn** cam kết mới, không phải tiếp tục thụ động.

Sự phân biệt này — cùng là "renew" nhưng 1 cái snapshot theo plan mới, 1 cái giữ nguyên snapshot cũ — là phần dễ nhầm nhất trong cả bài, và code đã làm đúng.

---

## 2. Xác nhận kế toán vault khi renew — vì sao cần `vault.payInterest(address(this), interest)`

Điểm hay: cả 2 hàm renew đều gọi `vault.payInterest(address(this), interest)` — trả lãi **về chính SavingCore**, không phải cho user. Lý do:

- `newPrincipal = principal cũ + interest`. Phần `principal cũ` vốn đã nằm sẵn trong `SavingCore` (từ lúc mở deposit ban đầu) — không cần chuyển gì thêm.
- Nhưng phần `interest` đang nằm ở `VaultManager`. Để `SavingCore` "backing" đủ cho `newPrincipal` (đảm bảo sau này rút được đủ), nó phải kéo phần `interest` này về chính mình trước.

Đây cũng là chỗ tự động enforce lại Business Rule #5 lần nữa: nếu vault không đủ tiền trả phần `interest` này, `vault.payInterest` revert → toàn bộ `renewDeposit`/`autoRenewDeposit` bị hủy (atomic) — không có deposit "ma" nào được tạo ra mà thiếu tiền backing.

---

## 3. Hai điểm nhỏ (không phải bug)

### 3.1. Comment "lưu owner trước khi đổi status" hơi thừa lý do

Trong `autoRenewDeposit`, comment giải thích *"lưu owner trước khi đổi status vì msg.sender không phải owner"* — nhưng thực ra `ownerOf(depositId)` đọc từ mapping nội bộ của **ERC721** (ai đang giữ NFT), hoàn toàn tách biệt với `deposits[depositId].status` (một field trong struct riêng của bạn). Đổi `status` **không hề ảnh hưởng** đến `ownerOf()`. Nên dù đọc `owner` trước hay sau khi đổi status, kết quả vẫn giống hệt nhau.

Việc đọc 1 lần vào biến local `owner` vẫn là thói quen tốt (đỡ đọc storage 2 lần, tiết kiệm gas, code rõ ràng) — chỉ là **lý do trong comment hơi thổi phồng**, không có rủi ro thật nào bị "phòng tránh" ở đây. Bạn có thể sửa comment lại cho chính xác hơn nếu muốn, không bắt buộc.

### 3.2. Thứ tự check trong `autoRenewDeposit` — dựa vào `ownerOf()` để bắt lỗi "deposit không tồn tại", hơi vòng vo

`autoRenewDeposit` check `status == Active` **trước**, rồi mới gọi `ownerOf(depositId)` sau. Nếu ai đó gọi hàm này với 1 `depositId` **chưa từng tồn tại** (chưa mở bao giờ):

- `deposits[depositId].status` mặc định = `Status.Active` (vì `Active` là giá trị enum thứ 0 — Solidity mặc định mọi struct/enum về giá trị "rỗng" là 0) → check đầu tiên **pass nhầm**.
- `maturityAt` mặc định = 0 → check grace period cũng **pass nhầm** (vì `block.timestamp` luôn lớn hơn 0 rất nhiều).
- Cuối cùng `ownerOf(depositId)` mới thực sự revert (chuẩn ERC721 tự chặn token không tồn tại).

**Kết luận: hàm vẫn an toàn tuyệt đối** (không có cách nào lách qua được, luôn revert đúng lúc) — chỉ là revert xảy ra hơi muộn và với lý do "token không tồn tại" thay vì "deposit không active" ngay từ đầu. Đây là điểm có thể cải thiện cho gọn (thêm `require(depositId < _nextDepositId, "deposit does not exist")` làm bước đầu tiên, giống cách `getDeposit()` đã làm) — nhưng **không bắt buộc sửa**, vì không phải lỗ hổng bảo mật.

---

## 4. Đối chiếu checklist invariant sau Ngày 4

| # | Invariant | Trạng thái |
|---|---|---|
| 1 | APR & penalty snapshot | Cả `openDeposit` lẫn 2 hàm renew đều snapshot đúng |
| 2 | Simple interest | Dùng lại `calculateInterest` nhất quán |
| 3 | Rút sớm = lãi 0 | (không đổi từ Ngày 3) |
| 4 | Auto-renew giữ APR gốc | **Đã hoàn thành** — verify bằng kịch bản số cụ thể ở mục 1 |
| 5 | Lãi luôn từ vault | Áp dụng cả khi renew, không chỉ khi rút |
| 6 | Pause chặn rút/renew | Cả 2 hàm renew đều có `whenNotPaused` |
| 7 | Admin không sửa deposit đã mở | (không đổi) |
| — | Double renew/withdraw cùng 1 deposit | Check `status == Active` chặn mọi thao tác lặp lại |
| — | Reentrancy | `nonReentrant` + mint đặt cuối cùng ở cả 2 hàm |

---

## File thay đổi

- `contracts/SavingCore.sol` (cập nhật — thêm `gracePeriodSeconds`, `setGracePeriod`, `renewDeposit`, `autoRenewDeposit`)