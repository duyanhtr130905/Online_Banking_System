# Báo cáo Ngày 2 — Coding Phase 1/2.5

**Trạng thái:** ✅ 3 file đã viết xong, compile sạch (không lỗi, không cảnh báo — verify bằng `solc` trực tiếp).

**Phạm vi đã code:** `MockUSDC.sol` (toàn bộ) · `VaultManager.sol` (toàn bộ) · `SavingCore.sol` (khung + Plan management — **chưa** có logic Deposit, để dành Ngày 3-4).

---

## Cách đọc báo cáo này

Với mỗi phần, mình giải thích **3 lớp**: (1) nó làm gì, (2) tại sao viết như vậy chứ không viết cách khác, (3) nó nối lại với quyết định nào ở Ngày 1/2. Đọc xong phần nào, mở file `.sol` tương ứng đọc lại comment trong code — 2 tài liệu này bổ sung cho nhau, không trùng lặp hoàn toàn.

---

## 1. MockUSDC.sol — điểm cần hiểu

```solidity
function decimals() public pure override returns (uint8) {
    return 6;
}
```

**Tại sao phải override:** ERC20 gốc của OpenZeppelin mặc định `decimals() = 18` (giống ETH). Nếu không override, MockUSDC sẽ có 18 decimals — khi bạn tính `1,000 USDC`, số thực tế trên chain sẽ là `1000 * 10^18`, không khớp với USDC thật (`1000 * 10^6`). Đây là loại lỗi **âm thầm** — code vẫn chạy, không báo lỗi, nhưng mọi con số trong test/frontend sẽ sai lệch 12 bậc số 0 so với dự định.

**`mint()` không giới hạn quyền gọi — có phải lỗ hổng không?** Không, vì đây là token **test only**, không đại diện giá trị thật. Nhưng lưu ý: nếu sau này bạn deploy contract này lên mainnet thật (dù chỉ để demo), **đừng bao giờ để mint công khai** — đây là kiểu lỗi thực tế đã từng khiến nhiều token bị "in tiền vô hạn" và mất giá trị.

---

## 2. VaultManager.sol — điểm cần hiểu

### 2.1. Vì sao dùng `immutable` cho `token`

```solidity
IERC20 public immutable token;
```

`immutable` nghĩa là biến này chỉ gán được **đúng 1 lần** trong constructor, sau đó không đổi được nữa (khác với biến thường có thể gán lại nhiều lần qua các hàm khác). Lợi ích:
- **Tiết kiệm gas** khi đọc — Solidity nhúng thẳng giá trị vào bytecode, không cần đọc từ storage (đọc storage tốn gas hơn nhiều).
- **An toàn hơn** — không có cách nào (kể cả admin) đổi địa chỉ token giữa chừng, tránh trường hợp admin "đổi token" để rút tiền qua đường vòng.

### 2.2. Modifier `onlyCore` — dòng quan trọng nhất file này

```solidity
modifier onlyCore() {
    require(msg.sender == coreAddress, "VaultManager: caller is not SavingCore");
    _;
}
```

Đây chính là dòng code bạn sẽ **trích dẫn** khi trả lời câu hỏi mở #7 (Attack thinking) và khi giải thích Business Rule #5. Tự kiểm tra hiểu bằng cách tự hỏi: *"Nếu tôi xóa dòng `require` này đi, điều gì tệ nhất có thể xảy ra?"* — Trả lời: bất kỳ ai gọi trực tiếp `payInterest(hackerAddress, toàn_bộ_số_dư_vault)` sẽ rút sạch quỹ lãi ngay lập tức, không cần mở deposit, không cần chờ đáo hạn.

### 2.3. Vì sao `payInterest` có cả `onlyCore` VÀ `whenNotPaused`

```solidity
function payInterest(address to, uint256 amount) external onlyCore whenNotPaused {
```

Hai modifier giải quyết 2 vấn đề khác nhau:
- `onlyCore` → chặn **sai đối tượng gọi** (chỉ SavingCore được gọi).
- `whenNotPaused` → chặn **sai thời điểm gọi** (không cho trả lãi khi hệ thống đang tạm dừng vì lý do khẩn cấp).

Nếu thiếu `whenNotPaused`, khi admin phát hiện bug và gọi `pause()`, tiền lãi vẫn có thể tiếp tục chảy ra ngoài qua `withdrawAtMaturity`/`earlyWithdraw` (vì các hàm đó cũng có `whenNotPaused` riêng ở SavingCore, nhưng phòng thủ 2 lớp — cả ở SavingCore lẫn VaultManager — là thói quen tốt, tránh trường hợp quên chặn ở 1 trong 2 lớp).

### 2.4. Vì sao `require(amount <= token.balanceOf(address(this)))` trong `payInterest`

Đây chính là dòng hiện thực Business Rule #5 ("vault không đủ tiền → phải revert"). Không có logic "trả một phần rồi thôi" — Solidity mặc định: nếu 1 dòng trong hàm fail, **toàn bộ giao dịch bị hủy** (revert), tiền không đi đâu cả, giống như giao dịch chưa từng xảy ra. Đây là điểm bạn sẽ dùng để trả lời câu hỏi mở #2 (Empty vault).

---

## 3. SavingCore.sol — điểm cần hiểu

### 3.1. Vì sao dùng `uint16` cho `tenorDays`, `aprBps`, `earlyWithdrawPenaltyBps`

`uint16` chứa được tối đa 65,535 — thừa đủ cho tenor (tối đa vài nghìn ngày) và bps (tối đa 10,000 = 100%). Dùng kiểu số nhỏ hơn `uint256` mặc định giúp Solidity **gộp nhiều biến vào chung 1 storage slot** (packing), tiết kiệm gas khi ghi dữ liệu — không bắt buộc phải tối ưu ở mức bài tập, nhưng thể hiện bạn hiểu rõ cách EVM lưu trữ dữ liệu (có thể được hỏi ở phần "code quality" khi vấn đáp).

### 3.2. `_nextPlanId` và `_nextDepositId` — vì sao không cho admin/user tự chọn ID

```solidity
planId = _nextPlanId++;
```

Nếu để admin tự chọn `planId` khi tạo, có nguy cơ **ghi đè nhầm** plan đã tồn tại (2 lần gọi `createPlan` cùng 1 ID sẽ mất dữ liệu plan cũ). Dùng bộ đếm tự tăng đảm bảo **mỗi ID chỉ được cấp phát đúng 1 lần, không bao giờ trùng**.

### 3.3. Vì sao `Deposit` struct có `aprBpsAtOpen` riêng thay vì đọc lại từ `Plan`

Đây chính là điểm quan trọng nhất — **nơi snapshot thực sự xảy ra** (sẽ code ở `openDeposit()` Ngày 3, nhưng struct đã chuẩn bị sẵn chỗ chứa ở đây). Tự kiểm tra hiểu bằng câu hỏi: *"Nếu Deposit struct KHÔNG có 2 trường này, mà chỉ lưu `planId` rồi lúc tính lãi mới đi tra `plans[planId].aprBps` — điều gì xảy ra khi admin gọi `updatePlan` đổi APR?"* — Trả lời: TẤT CẢ deposit cũ đang active (kể cả đã mở từ rất lâu) sẽ bị đổi lãi suất theo giá trị mới ngay lập tức — vi phạm nghiêm trọng Business Rule #1.

### 3.4. Vì sao `createPlan` có `require(aprBps > 0 && aprBps < 10000, ...)`

Đây là 1 dạng "sanity check" (kiểm tra hợp lý) không nằm trong 7 business rule bắt buộc, nhưng là thói quen phòng thủ tốt: chặn admin lỡ tay nhập sai đơn vị. Ví dụ nếu admin muốn nhập "4%" nhưng gõ nhầm `40000` (tưởng đơn vị là %×100 thay vì bps), dòng `require` này sẽ chặn lại ngay lập tức thay vì tạo ra 1 plan với APR 400%/năm.

### 3.5. Vì sao `disablePlan` không đụng đến deposit đang active

```solidity
function disablePlan(uint256 planId) external onlyRole(ADMIN_ROLE) {
    require(planId < _nextPlanId, "plan does not exist");
    plans[planId].enabled = false;
}
```

Hàm này **chỉ đổi 1 field duy nhất** (`enabled`), không hề chạm vào bất kỳ `Deposit` nào. Đây chính là cách hiện thực Business Rule #7 ("admin không sửa được deposit đã mở") — về mặt kiến trúc, không có hàm admin nào trong toàn bộ contract nhận `depositId` làm tham số để ghi đè dữ liệu deposit. Bạn có thể tự grep lại toàn bộ file để xác nhận: không hàm nào trong nhóm Admin động đến `deposits[...]`.

### 3.6. Vì sao phải override `supportsInterface`

Đây là phần **kỹ thuật thuần túy** của Solidity, không phải quyết định nghiệp vụ — khi 1 contract kế thừa từ 2 nguồn cùng định nghĩa 1 hàm giống nhau (`ERC721` và `AccessControl` đều có `supportsInterface`), trình biên dịch **bắt buộc** bạn phải tự viết lại hàm đó và chỉ định rõ lấy theo thứ tự nào (`super.supportsInterface`). Nếu thiếu, code sẽ báo lỗi compile — bạn không cần hiểu sâu bên trong, chỉ cần biết đây là yêu cầu chuẩn khi dùng "multiple inheritance" trong Solidity.

---

## 4. Đối chiếu với Checklist Ngày 1 — invariant nào đã có nền tảng, invariant nào chưa

| # | Invariant | Trạng thái sau Ngày 2 |
|---|---|---|
| 1 | APR & penalty snapshot | ⚙️ Đã có **chỗ chứa** (`aprBpsAtOpen`, `penaltyBpsAtOpen` trong struct), nhưng **chưa có logic gán giá trị** — sẽ code ở `openDeposit()` Ngày 3 |
| 2 | Simple interest | ⏳ Chưa code — thuộc Ngày 3 |
| 3 | Rút sớm = lãi 0 | ⏳ Chưa code — thuộc Ngày 3 |
| 4 | Auto-renew giữ APR gốc | ⏳ Chưa code — thuộc Ngày 4 |
| 5 | Lãi luôn từ vault | ✅ **Đã hoàn thành** — `payInterest` với `onlyCore` + kiểm tra số dư |
| 6 | Pause chặn rút/renew | ⚙️ Đã có modifier `whenNotPaused` sẵn sàng, sẽ gắn vào các hàm rút/renew ở Ngày 3-4 |
| 7 | Admin không sửa deposit đã mở | ✅ **Đã hoàn thành** — không hàm admin nào trong Ngày 2 động đến `deposits[...]` |

---

## 5. Câu hỏi tự kiểm tra trước khi qua Ngày 3

Thử tự trả lời (không nhìn code) — nếu trả lời được hết, bạn đã thật sự hiểu Ngày 2, không chỉ "code chạy được":

1. Nếu bạn xóa dòng `require(msg.sender == coreAddress, ...)` trong `VaultManager`, hậu quả cụ thể là gì?
2. Vì sao `Deposit` struct cần 2 trường `aprBpsAtOpen`/`penaltyBpsAtOpen` riêng, thay vì chỉ lưu `planId` rồi tra cứu lại?
3. `immutable` khác gì với biến thường? Vì sao `token` và `vault` được khai báo `immutable`?
4. Modifier `onlyCore` và `onlyRole(ADMIN_ROLE)` khác nhau ở điểm nào về **đối tượng** được phép gọi?

---

## File đính kèm

- `contracts/MockUSDC.sol`
- `contracts/VaultManager.sol`
- `contracts/SavingCore.sol` (khung + Plan management)

**Đã verify compile thành công bằng `solc`, không lỗi không cảnh báo.** (Lưu ý: khi bạn setup Hardhat ở máy của mình để chạy test sau này ở Ngày 5, cần chạy `npm install --save-dev hardhat @openzeppelin/contracts` và `npx hardhat compile` lại — môi trường ở đây dùng `solc` trực tiếp chỉ để nhanh chóng kiểm tra cú pháp, không thay thế hoàn toàn cho Hardhat.)

**Tiếp theo:** Ngày 3 — code `openDeposit`, `withdrawAtMaturity`, `earlyWithdraw` (phần math-heavy nhất, chiếm 20 điểm riêng).
