# Requirements Notes — Ngày 1 (Phần A): Requirement Analysis & Personal Variant

> Term Deposit System — Blockchain Programming Final Project
> Student ID (2 số cuối): **28** → A = 8, B = 2

---

## 1. Danh sách thuật ngữ/khái niệm đã làm rõ

| Thuật ngữ | Giải thích ngắn gọn |
|---|---|
| **bps (basis points)** | 1 bps = 0.01%. Luôn tính theo kiểu nhân trước chia sau: `(a*b*c)/10000`, không chia lẻ từng bước để tránh sai số làm tròn. |
| **APR (Annual Percentage Rate)** | Lãi suất quy đổi theo năm, dùng để so sánh công bằng các gói có kỳ hạn khác nhau. Lãi thực nhận = APR × (thời gian gửi thực tế / 1 năm). |
| **Snapshot** | "Chụp ảnh" một giá trị (APR, penalty) tại thời điểm mở deposit và đóng băng nó vào struct Deposit. Giá trị gốc (Plan) có đổi sau đó cũng không ảnh hưởng bản đã snapshot. |
| **Simple interest (lãi đơn)** | Lãi chỉ tính trên principal gốc trong 1 kỳ hạn, không có compounding nội bộ. |
| **Grace period** | Khoảng thời gian đệm sau `maturityAt`, hệ thống chờ user tự hành động trước khi bot auto-renew can thiệp. Không phải thời gian sinh thêm lãi. |
| **tenorDays vs tenorSeconds** | `tenorDays` là con số đề bài cho (dễ đọc). Solidity chỉ hiểu giây (Unix timestamp), nên phải quy đổi: `tenorSeconds = tenorDays * 86400`. Dễ quên nhân — lỗi âm thầm không báo khi compile. |
| **ERC721 vs ERC20** | Deposit certificate dùng ERC721 (NFT) vì mỗi deposit là vật phẩm unique, không thể chia nhỏ/gộp như token ERC20. |
| **Invariant** | Quy tắc bất biến — luôn luôn đúng tại mọi thời điểm, bất kể ai gọi hàm gì theo thứ tự nào. Là nền tảng để tự audit code. |

---

## 2. Personal Variant (Mục 8.1) — Student ID kết thúc bằng 28

**A = 8** (chữ số cuối) · **B = 2** (chữ số áp chót)

| Tham số | Công thức | Tính toán | Kết quả |
|---|---|---|---|
| Grace period (auto-renew) | (A mod 3) + 2 ngày | (8 mod 3) + 2 = 2 + 2 | **4 ngày** |
| Default plan APR | 200 + A×25 bps | 200 + 8×25 = 200+200 | **400 bps = 4.00%/năm** |
| Early withdraw penalty | 300 + B×50 bps | 300 + 2×50 = 300+100 | **400 bps = 4.00%** |
| Default plan tenor | B chẵn → 90 ngày; B lẻ → 180 ngày | B=2 (chẵn) | **90 ngày** |

> 4 số này (4 ngày grace / 4.00% APR / 4.00% penalty / 90 ngày tenor) là số bắt buộc, duy nhất, dùng xuyên suốt toàn bộ code, test, README, và video demo. 


---

## 3. 5 User Flow

### 3.1 Open a Deposit
1. User → approve token cho contract.
2. User gọi `openDeposit(planId, amount)`.
3. Contract kiểm tra: plan `enabled`, amount trong khoảng min/max.
4. Contract `transferFrom` token vào contract (giữ principal).
5. Mint NFT chứng chỉ, `depositId` duy nhất.
6. Status = Active, `maturityAt = now + tenorDays*86400`.
7. **Snapshot** APR & penalty ngay tại bước này.

### 3.2 Withdraw at Maturity
1. User gọi `withdrawAtMaturity(depositId)` sau khi đáo hạn.
2. Contract kiểm tra owner NFT = `msg.sender`, `now >= maturityAt`.
3. Tính `interest = (principal × aprBpsAtOpen × tenorSeconds) / (365×86400×10000)`.
4. Lãi rút từ **VaultManager** (không phải principal).
5. Trả `principal + interest` cho user, status = Withdrawn.

### 3.3 Early Withdrawal
1. User gọi `earlyWithdraw(depositId)` trước khi đáo hạn.
2. Tính `penalty = (principal × penaltyBpsAtOpen) / 10000`.
3. User nhận `principal - penalty`; penalty chuyển vào `feeReceiver`.
4. Không tính lãi (interest = 0).

### 3.4 Manual Renew
1. Từ `maturityAt` trở đi, user gọi `renewDeposit(depositId, newPlanId)`.
2. Tính lãi của deposit cũ (như 3.2).
3. Principal mới = principal cũ + lãi (gộp vào gốc).
4. Mint NFT deposit mới theo rate của `newPlanId`.
5. Deposit cũ → status `ManualRenewed`.

### 3.5 Auto Renew
1. Sau `maturityAt + gracePeriod` mà user không hành động, bot gọi `autoRenewDeposit(depositId)`.
2. Giữ nguyên **tenor cũ**.
3. APR khóa theo `aprBpsAtOpen` **ban đầu** — không theo rate hiện tại của plan.
4. Principal mới = principal cũ + lãi.
5. Deposit cũ → status `AutoRenewed`.

---

## 4. Checklist 7 Business Rules (Mục 6) — dùng để tự audit code

| # | Invariant | Bảo vệ điều gì | Cách tự kiểm tra trong code |
|---|---|---|---|
| 1 | APR & penalty **không đổi** sau khi deposit đã mở | User khỏi việc admin đổi luật giữa chừng | Lúc tính lãi phải đọc `deposit.aprBpsAtOpen`, không đọc `plan.aprBps` |
| 2 | Chỉ **simple interest**, không compounding trong 1 kỳ hạn | Đúng công thức spec, tránh lãi kép sai số | Không có vòng lặp cộng dồn lãi qua nhiều kỳ |
| 3 | Rút sớm → lãi = 0 | "Cái giá" của phá vỡ cam kết kỳ hạn | `earlyWithdraw` không gọi công thức tính interest |
| 4 | Auto-renew giữ **APR gốc** | User bị động (quên rút) không bị thiệt nếu admin giảm lãi | `autoRenewDeposit` đọc APR từ deposit cũ, không từ `plan.aprBps` hiện tại |
| 5 | Lãi luôn từ **vault**; vault không đủ → revert | Tách bạch principal (an toàn tuyệt đối) và lãi (phụ thuộc thanh khoản) | Chuyển lãi phải gọi `VaultManager`, không lấy từ số dư principal |
| 6 | `pause()` → chặn rút & renew | Phanh khẩn cấp khi phát hiện bug/bị hack | Mỗi hàm rút/renew có modifier `whenNotPaused` |
| 7 | Admin **không sửa được** deposit đã mở | User khỏi rủi ro admin lạm quyền sau khi "đã ký" | Không hàm admin nào nhận `depositId` để ghi đè dữ liệu deposit |

---

## Trạng thái hoàn thành Ngày 1

- [x] Danh sách thuật ngữ
- [x] Personal Variant đã tính (4 ngày / 4.00% APR / 4.00% penalty / 90 ngày tenor)
- [x] 5 flow 
- [x] Checklist 7 business rules

**Tiếp theo:** Ngày 1 (Phần B) — System Architecture Design → xem `docs/ARCHITECTURE.md`.
