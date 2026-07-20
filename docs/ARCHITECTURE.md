# ARCHITECTURE.md — Ngày 1 (Phần B): System Architecture Design

> Term Deposit System — Blockchain Programming Final Project
> Personal Variant: Grace period 4 ngày · Default APR 4.00% · Penalty 4.00% · Tenor mặc định 90 ngày

---

## 1. Quyết định kiến trúc tổng thể

Giữ nguyên **3 contract tách biệt** như đề bài gợi ý, không gộp chung, vì:

- **Tách trách nhiệm rõ ràng**, giống 3 "phòng ban" của một ngân hàng thật:
  - `SavingCore` = phòng giao dịch (toàn bộ nghiệp vụ, logic, NFT)
  - `VaultManager` = kho bạc (chỉ giữ và chuyển tiền lãi)
  - `MockUSDC` = đơn vị phát hành tiền tệ (không liên quan nghiệp vụ)
- Tách biệt giúp **audit/kiểm tra bảo mật từng phần độc lập** dễ hơn — đặc biệt phần giữ tiền (`VaultManager`) có thể review riêng mà không cần đọc toàn bộ logic nghiệp vụ.
- Cho phép **thực thi Business Rule #5** ("lãi luôn từ vault") bằng kiến trúc (access control), không chỉ bằng quy ước lỏng lẻo trong code.

---

## 2. Storage Layout

### Struct `Plan` (SavingCore)
```solidity
struct Plan {
    uint16 tenorDays;
    uint16 aprBps;
    uint16 earlyWithdrawPenaltyBps;
    uint256 minDeposit;
    uint256 maxDeposit;   // 0 = không giới hạn
    bool enabled;
}
mapping(uint256 => Plan) public plans;
```

### Struct `Deposit` (SavingCore)
```solidity
struct Deposit {
    uint256 planId;
    uint256 principal;
    uint256 maturityAt;
    uint16 aprBpsAtOpen;        // SNAPSHOT tại thời điểm mở
    uint16 penaltyBpsAtOpen;    // SNAPSHOT tại thời điểm mở
    Status status;              // Active / Withdrawn / ManualRenewed / AutoRenewed
}
mapping(uint256 => Deposit) public deposits;
```
`depositId` chính là `tokenId` của NFT — tận dụng luôn cơ chế `ownerOf()` có sẵn của ERC721 để xác định quyền sở hữu, không cần thêm mapping riêng.

---

## 3. Thư viện OpenZeppelin sử dụng

| Thư viện | Mục đích | Ghi chú |
|---|---|---|
| `ERC721` | NFT chứng chỉ deposit | `depositId == tokenId` |
| `AccessControl` | Phân quyền theo vai trò | 2 role: `ADMIN_ROLE`, để `autoRenewDeposit` mở public thay vì role riêng cho bot |
| `Pausable` | Phanh khẩn cấp | Modifier `whenNotPaused` cho các hàm rút/renew |
| `ReentrancyGuard` | Chặn tấn công gọi lại (reentrancy) | Modifier `nonReentrant` cho mọi hàm chuyển tiền |
| `SafeERC20` | Bọc an toàn quanh lệnh transfer | Dùng khi `SavingCore` và `VaultManager` chuyển `MockUSDC` |

**Vì sao AccessControl thay vì Ownable:** hệ thống có nhiều hơn 1 vai trò cần phân biệt rõ (admin quản trị vs. luồng auto-renew công khai), nên `AccessControl` mô tả đúng bản chất hơn `Ownable` (vốn chỉ có đúng 1 chủ sở hữu).

---

## 4. Chữ ký hàm từng contract

### 4.1 MockUSDC.sol
```solidity
constructor() ERC20("Mock USDC", "mUSDC")
function decimals() public pure override returns (uint8)   // = 6
function mint(address to, uint256 amount) external
```

### 4.2 VaultManager.sol

| Hàm | Quyền gọi | Vai trò |
|---|---|---|
| `constructor(address token)` | deploy | Gắn địa chỉ MockUSDC |
| `setCoreAddress(address core)` | admin | Chỉ định contract SavingCore được phép gọi `payInterest` |
| `fundVault(uint256 amount)` | **admin** | Nạp tiền lãi vào vault (đối xứng với withdrawVault, khớp với Mục 4 đề bài) |
| `withdrawVault(uint256 amount)` | admin | Rút tiền khỏi vault |
| `payInterest(address to, uint256 amount)` | **chỉ SavingCore** (`onlyCore`) | Trả lãi — điểm hiện thực hóa Business Rule #5 |
| `getAvailableBalance()` | ai cũng xem được (`view`) | Kiểm tra vault còn bao nhiêu |

```solidity
modifier onlyCore() {
    require(msg.sender == coreAddress, "only SavingCore can call");
    _;
}
```

**Vì sao `payInterest` chỉ SavingCore gọi được:**
- Nếu để **public** → bất kỳ ai cũng rút sạch vault mà không cần mở deposit gì. Đây là ví dụ cho câu hỏi mở #7 (Attack thinking).
- Nếu để **admin gọi trực tiếp** → vẫn sai, vì mọi kiểm tra nghiệp vụ (đúng owner, đúng maturity, đúng công thức lãi) nằm ở `SavingCore`. Cho phép admin "đi vòng" qua `SavingCore` sẽ vô hiệu hóa toàn bộ 7 invariant ở Mục 6.
- Chuỗi ủy quyền 1 chiều: `User → SavingCore (kiểm tra đầy đủ) → VaultManager.payInterest (chỉ tin SavingCore)` là cách duy nhất đảm bảo tiền lãi luôn đi qua đúng logic kiểm tra.

### 4.3 SavingCore.sol (kế thừa ERC721 + AccessControl + Pausable + ReentrancyGuard)

**Nhóm Admin** (`onlyRole(ADMIN_ROLE)`):
```solidity
function createPlan(uint16 tenorDays, uint16 aprBps, uint16 penaltyBps, uint256 minDeposit, uint256 maxDeposit) external returns (uint256 planId)
function updatePlan(uint256 planId, uint16 newAprBps) external
function enablePlan(uint256 planId) external
function disablePlan(uint256 planId) external
function setFeeReceiver(address receiver) external
function pause() external
function unpause() external
```

**Nhóm User** (`nonReentrant`, `whenNotPaused` cho hàm rút/renew):
```solidity
function openDeposit(uint256 planId, uint256 amount) external returns (uint256 depositId)
function withdrawAtMaturity(uint256 depositId) external nonReentrant whenNotPaused
function earlyWithdraw(uint256 depositId) external nonReentrant whenNotPaused
function renewDeposit(uint256 depositId, uint256 newPlanId) external nonReentrant whenNotPaused
function autoRenewDeposit(uint256 depositId) external nonReentrant whenNotPaused  // public — ai gọi cũng được, không riêng bot
```

**Nhóm View/Helper** (dùng chung, tránh trùng lặp công thức — khớp Business Rule #2):
```solidity
function getPlan(uint256 planId) external view returns (Plan memory)
function getDeposit(uint256 depositId) external view returns (Deposit memory)
function calculateInterest(uint256 depositId) public view returns (uint256)
function calculatePenalty(uint256 depositId) public view returns (uint256)
```

**Kế thừa sẵn từ ERC721:** `ownerOf()`, `transferFrom()`, `approve()`, `balanceOf()` — nền tảng cho phép chuyển nhượng chứng chỉ deposit (câu hỏi mở #1).

**Vì sao `autoRenewDeposit` để public, không giới hạn riêng cho bot:** nếu khóa cứng chỉ 1 địa chỉ bot được gọi, khi bot ngừng hoạt động (câu hỏi mở #3 — Dead bot), user sẽ vĩnh viễn không renew được. Để public + điều kiện `now >= maturityAt + gracePeriod` giúp bất kỳ ai (kể cả chính user, hoặc 1 bot dự phòng) đều có thể kích hoạt khi đủ điều kiện.

---

## 5. Access Control Summary

| Hàm | Ai gọi được |
|---|---|
| `openDeposit`, `withdrawAtMaturity`, `earlyWithdraw`, `renewDeposit` | Owner của NFT deposit đó |
| `autoRenewDeposit` | Bất kỳ ai, miễn đủ điều kiện thời gian |
| `createPlan`, `updatePlan`, `enable/disablePlan`, `setFeeReceiver`, `pause/unpause` | Chỉ `ADMIN_ROLE` |
| `fundVault`, `withdrawVault` | Chỉ `ADMIN_ROLE` |
| `payInterest` (VaultManager) | Chỉ contract `SavingCore` (`onlyCore`) |

---

## 6. Sơ đồ kiến trúc tổng thể

```
                    ┌───────────────┐
                    │   SavingCore   │
                    │ Business logic │
                    │     + NFT      │
                    └───────┬───────┘
                ┌───────────┴───────────┐
                ▼                       ▼
      ┌──────────────────┐    ┌──────────────────┐
      │   VaultManager     │    │     MockUSDC      │
      │  Vault lãi, tách   │───▶│  ERC20 test token  │
      │      biệt          │    │                    │
      └──────────────────┘    └──────────────────┘
```

`SavingCore` là hub trung tâm: gọi `MockUSDC` để chuyển principal, gọi `VaultManager` để lấy lãi trả user. `VaultManager` và `MockUSDC` liên quan trực tiếp vì cùng thao tác trên cùng một loại token.

---

## 7. Nháp sớm 2 câu hỏi mở liên quan trực tiếp đến kiến trúc

**Câu 1 — Transferable certificate:** Quyền rút tiền gắn với `ownerOf(depositId) == msg.sender`, không gắn với người mở deposit ban đầu. Nếu Alice bán NFT cho Bob, Bob là người rút được tiền.
Dòng code quyết định: `require(ownerOf(depositId) == msg.sender, "not owner");` ở đầu mỗi hàm rút/renew.

**Câu 7 — Attack thinking (reentrancy):** `ReentrancyGuard` chặn kiểu tấn công gọi lại hàm rút trước khi số dư kịp cập nhật.
Dòng code quyết định: `function withdrawAtMaturity(...) external nonReentrant { ... }`.

Một ví dụ tấn công khác đã được chặn bằng thiết kế (không chỉ bằng code phòng thủ): gọi trực tiếp `VaultManager.payInterest()` để rút sạch vault — bị chặn hoàn toàn bởi modifier `onlyCore`, không có cách nào gọi vòng qua được.

---

## ✅ Trạng thái hoàn thành Ngày 1 (Phần B)

- [x] Storage layout (struct Plan, struct Deposit)
- [x] Quyết định kiến trúc: 3 contract tách biệt + lý do
- [x] Thư viện OpenZeppelin + lý do chọn AccessControl thay Ownable
- [x] Access control đầy đủ cho cả 3 contract
- [x] Chữ ký hàm đầy đủ (chưa viết logic)
- [x] Sơ đồ kiến trúc tổng thể
- [x] Nháp câu hỏi mở #1 và #7

**Tiếp theo:** Ngày 2 — Coding Phase 1 (MockUSDC + VaultManager + Plan logic trong SavingCore).
