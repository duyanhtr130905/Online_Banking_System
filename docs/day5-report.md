# Báo cáo Ngày 5 — Testing + Self-Audit

**Trạng thái:** 49 test case trong file lớn nhất (3 vòng vá coverage) + 44 test case còn lại + 1 integration test dài = **93/93 test pass toàn project**. Coverage vượt ngưỡng 90% yêu cầu (Mục 7.2 đề bài) ở cả 2 chỉ số Statement lẫn Branch cho 2/2 contract chấm điểm chính (`SavingCore.sol`, `VaultManager.sol`).

**Setup:** Hardhat (`ac-hardhat-template`), config đã tùy biến lại cho project (bỏ mainnet, upgradeable, waffle — chỉ giữ phần cần thiết). Ghi chú: `evmVersion: "cancun"` là bắt buộc, không phải tùy chọn — đã verify thật bằng cách xóa thử, gây lỗi cứng `HH600` do OpenZeppelin 5.6.1 dùng opcode `mcopy`.

---

## 1. Tổng quan 6 file test

| File | Số test | Phạm vi |
|---|---|---|
| `test/00-smoke.test.ts` | 1 | Verify fixture deploy đúng, wiring `coreAddress` đúng |
| `test/01-plan-and-vault-admin.test.ts` | 49 | Plan management, Vault admin, access control, grace period, pause 2 lớp, coverage patch |
| `test/02-open-deposit-and-math.test.ts` | 12 | `openDeposit`, công thức lãi/phạt, reentrancy regression |
| `test/03-withdraw.test.ts` | 13 | `withdrawAtMaturity`, `earlyWithdraw`, boundary chính xác |
| `test/04-renew.test.ts` | 17 | `renewDeposit`, `autoRenewDeposit`, chuỗi snapshot đa vòng |
| `test/05-integration.test.ts` | 1 | Vòng đời đầy đủ, bảo toàn tổng cung |
| **Tổng** | **93** | |

---

## 2. Chi tiết `01-plan-and-vault-admin.test.ts` 

### Đợt 1 — Test 1-36 

| Nhóm | Test # | Nội dung | Kết quả |
|---|---|---|---|
| `createPlan` | 1-8 | Happy path, access control, validate APR/penalty/tenor/maxDeposit, planId tự tăng | 8/8 |
| `updatePlan` | 9-13 | Happy path, access control, validate, invalid planId, **Invariant #1** (snapshot không đổi) | 5/5 |
| `enable/disablePlan` | 14-18 | Chặn mở deposit khi disable, bật lại, access control, **không ảnh hưởng deposit active** | 5/5 |
| `setFeeReceiver` | 19-21 | Happy path, access control, zero address | 3/3 |
| `pause/unpause` (SavingCore) | 22-24 | Access control, chặn openDeposit khi pause | 3/3 |
| `VaultManager.setCoreAddress` | 25-26 | Access control, zero address | 2/2 |
| `fundVault` | 27-29 | Happy path, access control, amount=0 | 3/3 |
| `withdrawVault` | 30-32 | Happy path, access control, vượt balance | 3/3 |
| `payInterest` (ACL) | 33-34 | **onlyCore chặn cả admin lẫn user thường gọi trực tiếp** | 2/2 |
| `VaultManager.pause/unpause` | 36 | Access control | 1/1 |

### Đợt 2 — Test 37-43

| Test # | Nội dung | Vì sao cần |
|---|---|---|
| 37 | `setGracePeriod` happy path | Hàm chưa từng được gọi trong bất kỳ test nào trước đó |
| 38 | Đổi grace period 4→7 ngày, verify **có tác dụng thật** lên `autoRenewDeposit` (không chỉ đổi biến suông) | Phân biệt "test coverage giả" và "test hành vi thật" |
| 39-40 | Access control + validate `setGracePeriod` | Chuẩn hóa cùng pattern các hàm admin khác |
| 41-42 | **`VaultManager.pause()` là cầu dao ĐỘC LẬP với `SavingCore`** — pause riêng Vault vẫn chặn được `withdrawAtMaturity` dù SavingCore không pause | Phát hiện quan trọng: 2 lớp pause riêng biệt, dễ bị bỏ sót nếu chỉ test pause ở SavingCore |
| 43 | `supportsInterface` — ERC165 chuẩn (IERC721 = true, random ID = false) | Yêu cầu kỹ thuật của multiple inheritance, rủi ro thấp nhưng nên có |

**Kết quả sau đợt 2:** 42/42 pass (file này), coverage tổng project 86/86 pass, branch `SavingCore.sol` từ chưa rõ → **90.00%** (đúng ngưỡng, chưa an toàn).

### Đợt 3 — Test 44-50

| Nhóm | Test # | Dòng |
|---|---|---|
| A — Constructor validation | 44-47 | 127-130 | 
| B — `getPlan` invalid ID | 48 | 243 |
| D — `maxDeposit` boundary PASS path | 49-50 | 304, 537-539 | 
| C — `nonReentrant` false-branch (4 hàm còn lại) | — | 291, 401, 502, 599 | 

**Kết quả sau đợt 3:** 93/93 pass toàn project.

| Metric | Trước đợt 3 | Sau đợt 3 | Delta |
|---|---|---|---|
| `SavingCore.sol` Branch % | 90.00% | **96.36%** | +6.36% |
| `VaultManager.sol` Branch % | 92.86% | 92.86% | — (không đụng tới ở đợt này) |
| `MockUSDC.sol` | 100% | 100% | — |
| All files Branch % | 90.00% | **95.00%** | +5.00% |


---

## 3. Các test "then chốt" — không chỉ đếm số lượng, mà xét chất lượng verify

Đây là những test **khó viết sai mà vẫn pass giả**, được review kỹ trước khi chấp nhận:

| Test | File | Vì sao đáng tin cậy |
|---|---|---|
| #13 | 01-... | So sánh với hằng số độc lập, đổi APR **khác hẳn** (400→100) chứ không no-op |
| #8 (reentrancy) | 02-... | Verify rollback triệt để (`getDeposit` revert "not exist"), không chỉ "tx fail" |
| #9-10 (math) | 02-... | So khớp **số chính xác tuyệt đối** (9863013, 40000000), không dùng khoảng dung sai |
| #12 (nhân trước/chia trước) | 02-... | Chứng minh bằng phản chứng — so sánh với công thức SAI để thấy 2 kết quả khác nhau |
| #4 + #11 (boundary pair) | 03-... | Dùng `time.setNextBlockTimestamp` — hit **đúng 1 giây**, không phải "khoảng gần đó" |
| #6, #17 (atomicity) | 03-, 04-... | Verify **cả 2 phía** của giao dịch bị rollback (không chỉ 1 dòng), chứng minh tính atomic thật |
| #13 (multi-round APR) | 04-... | Đổi APR **giữa chuỗi 2 vòng renew** (400→999), verify chuỗi vẫn giữ 400 xuyên suốt — bài test khó viết đúng nhất toàn bộ suite |
| #14 (disabled plan) | 04-... | Đối lập trực tiếp với test tương ứng ở `renewDeposit`, làm rõ ranh giới thiết kế |
| Integration (bảo toàn tổng cung) | 05-... | Loại test khó "pass giả" nhất — kiểm tra tính nhất quán **toàn hệ thống**, không phải 1 hàm riêng lẻ. Kết quả: `4,000,000.000000 = 4,000,000.000000` sau chuỗi open→manual renew→auto renew→early withdraw |

---

## 5. Checklist invariant cuối cùng — xác nhận qua test, không chỉ qua đọc code

| # | Invariant | Test xác nhận |
|---|---|---|
| 1 | APR & penalty snapshot | 01-#13, 04-#13 (đa vòng) |
| 2 | Simple interest, nhân trước chia sau | 02-#9, #10, #12 |
| 3 | Rút sớm = lãi 0 | 03-#8 |
| 4 | Auto-renew giữ APR gốc | 04-#10, #13 (đa vòng, xuyên qua updatePlan) |
| 5 | Lãi luôn từ vault, atomic khi thiếu | 03-#6, 04-#8, #17 |
| 6 | Pause chặn rút/renew (2 lớp độc lập) | 01-#23, #41-42 |
| 7 | Admin không sửa deposit đã mở | 01-#18, 04-#14 |
| — | Reentrancy | 02-#8 |
| — | Double withdraw/renew | 03-#5,#10; 04-#7,#15 |
| — | Boundary chính xác từng giây | 03-#4,#11; 01-#38 |
| — | Bảo toàn tổng cung toàn hệ thống | 05-integration |

---

## File thay đổi

- `test/00-smoke.test.ts`, `test/01-plan-and-vault-admin.test.ts` (50 test), `test/02-open-deposit-and-math.test.ts`, `test/03-withdraw.test.ts`, `test/04-renew.test.ts`, `test/05-integration.test.ts`
- `test/fixtures.ts`, `deploy/00-deploy.ts`
- `contracts/mocks/MaliciousReceiver.sol` (mock phục vụ test, không tính vào contract chấm điểm)
- `hardhat.config.ts`, `tsconfig.json`, `.env.example`, `package.json` (setup theo template mentor)

**Tiếp theo:** Creative Challenges C1 (vault-empty-safe) + C2 (solvency guard), sau đó Ngày 6 — Design Answers.