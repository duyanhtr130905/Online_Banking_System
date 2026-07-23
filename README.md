# Online Banking System — Term Deposit on Blockchain

Hệ thống gửi tiết kiệm có kỳ hạn chạy trên blockchain. Người dùng gửi MockUSDC theo một saving plan, nhận NFT ERC721 đại diện cho chứng chỉ tiền gửi, sau đó có thể rút sớm, rút khi đáo hạn, gia hạn thủ công, gia hạn tự động hoặc chuyển nhượng chứng chỉ NFT.

> **Trạng thái sau Ngày 6:** smart contract đã hoàn thành, test `93/93` pass, coverage vượt 90%, ba contract đã deploy lên Sepolia và frontend React đã tích hợp MetaMask. Frontend đang tiếp tục được kiểm thử thủ công và tinh chỉnh UI/UX.

---

## 1. Personal Variant

Student ID kết thúc bằng **28**:

- `A = 8` — chữ số cuối.
- `B = 2` — chữ số áp chót.

| Tham số | Công thức | Giá trị |
|---|---|---:|
| Grace period | `(A mod 3) + 2` ngày | **4 ngày** |
| Default plan APR | `200 + A × 25` bps | **400 bps = 4.00%/năm** |
| Early-withdraw penalty | `300 + B × 50` bps | **400 bps = 4.00%** |
| Default tenor | `B` chẵn → 90 ngày | **90 ngày** |

Bốn giá trị trên được dùng thống nhất trong deploy script, contract configuration, test suite, frontend và demo.

---

## 2. Tính năng chính

### Depositor

- Kết nối MetaMask và chuyển sang Sepolia.
- Xem saving plans đang mở.
- Xem số dư và allowance MockUSDC.
- Approve token và mở deposit.
- Nhận NFT ERC721 chứng nhận deposit.
- Xem principal, APR/penalty snapshot, ngày đáo hạn, lãi/phạt dự kiến.
- Rút sớm: không nhận lãi và chịu penalty.
- Rút đúng hạn: nhận principal và interest.
- Manual renew sang một plan đang enabled.
- Kích hoạt auto-renew sau grace period.
- Chuyển NFT deposit cho địa chỉ khác; owner mới có quyền rút/renew.
- Xem deposit đang hoạt động và lịch sử Withdrawn/ManualRenewed/AutoRenewed.

### Bank Admin

- Tạo saving plan.
- Cập nhật APR cho các deposit mở mới.
- Enable/disable plan.
- Cập nhật `feeReceiver`.
- Cập nhật grace period.
- Pause/unpause `SavingCore`.
- Fund/withdraw interest vault.
- Pause/unpause `VaultManager` độc lập.

---

## 3. Kiến trúc hệ thống

Hệ thống tách thành ba contract:

```text
User / Admin
     │
     ▼
┌──────────────────────────────────┐
│ SavingCore                       │
│ - Saving plans                   │
│ - Deposit lifecycle              │
│ - Interest/penalty calculations  │
│ - ERC721 deposit certificate     │
└──────────────┬───────────────────┘
               │ payInterest()
               ▼
┌──────────────────────────────────┐
│ VaultManager                     │
│ - Giữ quỹ trả lãi                │
│ - Chỉ tin SavingCore             │
└──────────────┬───────────────────┘
               │
               ▼
┌──────────────────────────────────┐
│ MockUSDC                         │
│ - ERC20 test token               │
│ - 6 decimals                     │
└──────────────────────────────────┘
```

### `MockUSDC.sol`

- ERC20 test token.
- `decimals() = 6`, giống USDC.
- `mint()` public để phục vụ testnet/demo.
- Không được xem là token production.

### `VaultManager.sol`

- Chỉ giữ tiền dùng để trả **interest**.
- Admin có thể fund, withdraw và pause.
- `payInterest()` chỉ được gọi bởi địa chỉ `SavingCore` đã wiring:

```solidity
modifier onlyCore() {
    require(msg.sender == coreAddress, "VaultManager: caller is not SavingCore");
    _;
}
```

### `SavingCore.sol`

- Quản lý Plan và Deposit.
- Giữ principal của người dùng.
- Mint ERC721 `Term Deposit Certificate (TDC)`.
- Snapshot APR và penalty khi mở deposit.
- Thực hiện open, withdraw, manual renew và auto renew.
- Dùng `AccessControl`, `Pausable`, `ReentrancyGuard` và `SafeERC20`.

Tài liệu kiến trúc chi tiết: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 4. Data model

### Plan

```solidity
struct Plan {
    uint16 tenorDays;
    uint16 aprBps;
    uint16 earlyWithdrawPenaltyBps;
    uint256 minDeposit;
    uint256 maxDeposit;
    bool enabled;
}
```

Quy ước:

- `minDeposit = 0`: không có mức tối thiểu.
- `maxDeposit = 0`: không giới hạn tối đa.
- Admin chỉ có thể cập nhật APR; tenor, penalty và limits của plan đã tạo không bị sửa.

### Deposit

```solidity
enum Status {
    Active,
    Withdrawn,
    ManualRenewed,
    AutoRenewed
}

struct Deposit {
    uint256 planId;
    uint256 principal;
    uint256 maturityAt;
    uint16 aprBpsAtOpen;
    uint16 penaltyBpsAtOpen;
    Status status;
}
```

`depositId` đồng thời là `tokenId` của NFT. Quyền thao tác được xác định bằng `ownerOf(depositId)`.

---

## 5. User flows

### 5.1 Open Deposit

1. User chọn plan enabled.
2. User approve MockUSDC cho `SavingCore`.
3. Gọi `openDeposit(planId, amount)`.
4. Contract kiểm tra min/max.
5. Principal được chuyển vào `SavingCore`.
6. APR và penalty được snapshot.
7. NFT deposit được mint cho user.

### 5.2 Withdraw at Maturity

Điều kiện:

```solidity
block.timestamp >= maturityAt
```

Công thức lãi đơn:

```text
interest =
    principal × aprBpsAtOpen × tenorSeconds
    ─────────────────────────────────────────
             365 days × 10,000
```

Principal được trả từ `SavingCore`; interest được trả từ `VaultManager`.

Ví dụ Personal Variant với `1,000 USDC`, tenor `90 ngày`, APR `4%`:

```text
interest = 9.863013 USDC
payout   = 1,009.863013 USDC
```

### 5.3 Early Withdrawal

Điều kiện:

```solidity
block.timestamp < maturityAt
```

```text
penalty = principal × penaltyBpsAtOpen / 10,000
payout  = principal - penalty
interest = 0
```

Với `1,000 USDC` và penalty `4%`:

```text
penalty = 40 USDC
payout  = 960 USDC
```

Penalty được chuyển tới `feeReceiver`.

### 5.4 Manual Renew

Sau maturity, owner chọn một plan mới đang enabled:

- Interest của deposit cũ được tính theo APR snapshot cũ.
- `newPrincipal = oldPrincipal + interest`.
- Interest được chuyển từ VaultManager về SavingCore để backing principal mới.
- Deposit cũ chuyển thành `ManualRenewed`.
- NFT deposit mới snapshot APR/penalty của plan mới.

### 5.5 Auto Renew

Sau:

```solidity
block.timestamp >= maturityAt + gracePeriodSeconds
```

bất kỳ địa chỉ nào cũng có thể gọi `autoRenewDeposit()`:

- NFT mới vẫn được mint cho owner của deposit cũ, không phải caller.
- Giữ nguyên plan và tenor.
- Giữ `aprBpsAtOpen` và `penaltyBpsAtOpen` cũ.
- Deposit cũ chuyển thành `AutoRenewed`.

Auto-renew không tự chạy bên trong blockchain; cần bot, user hoặc một bên thứ ba gửi transaction.

### 5.6 Transferable Certificate

NFT deposit có thể được chuyển bằng ERC721 `safeTransferFrom`. Sau transfer, owner mới là người có quyền rút hoặc renew.

---

## 6. Business invariants

| # | Invariant | Cách bảo vệ |
|---:|---|---|
| 1 | APR và penalty không đổi sau khi mở | Lưu `aprBpsAtOpen` và `penaltyBpsAtOpen` trong Deposit |
| 2 | Chỉ dùng simple interest trong một kỳ | Không cộng dồn lãi trong cùng deposit |
| 3 | Rút sớm không có lãi | `earlyWithdraw()` không gọi VaultManager trả lãi |
| 4 | Auto-renew giữ APR gốc | Deposit mới copy snapshot từ deposit cũ |
| 5 | Interest luôn lấy từ vault | Chỉ gọi `vault.payInterest()` |
| 6 | Pause chặn open/withdraw/renew phù hợp | `whenNotPaused` và pause hai lớp |
| 7 | Admin không sửa deposit đã mở | Không có admin function ghi vào `deposits[depositId]` |

Ngoài ra:

- `status == Active` chặn double withdraw/renew.
- `nonReentrant` bảo vệ các hàm chuyển tiền.
- State được cập nhật trước external calls theo CEI.
- Vault thiếu interest làm toàn bộ transaction revert atomically.

---

## 7. Required events

`SavingCore` phát các event:

```solidity
PlanCreated(planId, tenorDays, aprBps)
PlanUpdated(planId, newAprBps)
DepositOpened(depositId, owner, planId, principal, maturityAt, aprBpsAtOpen)
Withdrawn(depositId, owner, principal, interest, isEarly)
Renewed(oldDepositId, newDepositId, newPrincipal, newPlanId)
```

`VaultManager` bổ sung:

```solidity
VaultFunded(from, amount)
VaultWithdrawn(to, amount)
InterestPaid(to, amount)
CoreAddressSet(core)
```

Frontend dùng ERC721 `Transfer` và `Renewed` events để dựng danh sách deposit và liên kết deposit cũ → mới.

---

## 8. Tech stack

### Smart contracts

- Solidity `^0.8.24`
- Hardhat `2.x`
- ethers.js `6.x`
- OpenZeppelin Contracts `5.6.1`
- TypeScript
- hardhat-deploy
- TypeChain
- Solidity Coverage

### Frontend

- React `19`
- Vite `8`
- TypeScript `6`
- ethers.js `6`
- MetaMask

---

## 9. Cấu trúc thư mục

```text
Online_Banking_System/
├── contracts/
│   ├── MockUSDC.sol
│   ├── VaultManager.sol
│   ├── SavingCore.sol
│   └── mocks/
│       └── MaliciousReceiver.sol
├── deploy/
│   └── 00-deploy.ts
├── deployments/
│   └── sepolia/
├── scripts/
│   └── mint-demo.ts
├── test/
│   ├── 00-smoke.test.ts
│   ├── 01-plan-and-vault-admin.test.ts
│   ├── 02-open-deposit-and-math.test.ts
│   ├── 03-withdraw.test.ts
│   ├── 04-renew.test.ts
│   ├── 05-integration.test.ts
│   └── fixtures.ts
├── frontend/
│   ├── src/
│   │   ├── abis/
│   │   ├── components/
│   │   ├── contexts/
│   │   ├── hooks/
│   │   └── utils/
│   ├── MANUAL_TEST_CHECKLIST.md
│   └── package.json
├── docs/
│   ├── requirements-notes.md
│   ├── ARCHITECTURE.md
│   ├── PLAN.md
│   ├── day2-report.md
│   ├── day3-report.md
│   ├── day4-report.md
│   ├── day5-report.md
│   └── day6-report.md
├── hardhat.config.ts
├── package.json
└── README.md
```

---

## 10. Cài đặt

### Yêu cầu

- Node.js và npm.
- MetaMask nếu chạy frontend/Sepolia.
- Sepolia ETH cho ví gửi transaction.

Clone repo:

```bash
git clone https://github.com/duyanhtr130905/Online_Banking_System.git
cd Online_Banking_System
npm install
```

Tạo `.env` từ `.env.example`:

```env
TESTNET_PRIVATE_KEY=
ETHERSCAN_API_KEY=
REPORT_GAS=0
```

> Không commit `.env`, private key hoặc seed phrase lên Git.

Compile:

```bash
npm run compile
```

---

## 11. Chạy test và coverage

Chạy toàn bộ test:

```bash
npm test
```

Chạy coverage:

```bash
npx hardhat coverage
```

Kết quả gần nhất:

- **93/93 test pass**
- `SavingCore.sol` branch coverage: **96.36%**
- `VaultManager.sol` branch coverage: **92.86%**
- Toàn project branch coverage: **95.00%**
- `MockUSDC.sol`: **100%**

Test suite bao phủ:

- Plan management và access control.
- Vault funding/withdrawal.
- APR/penalty snapshot.
- Interest/penalty math.
- Exact timestamp boundaries.
- Early/maturity withdrawal.
- Manual/auto renew.
- Disabled plan behavior.
- Empty vault atomic rollback.
- Double withdraw/renew.
- Reentrancy regression.
- Hai pause layer độc lập.
- Full-lifecycle integration và bảo toàn tổng cung.

Báo cáo chi tiết: [`docs/day5-report.md`](docs/day5-report.md).

---

## 12. Deploy

### Local Hardhat

Terminal 1:

```bash
npm run node
```

Terminal 2:

```bash
npx hardhat deploy --network localhost --tags all
```

Deploy script thực hiện:

1. Deploy `MockUSDC`.
2. Deploy `VaultManager(MockUSDC)`.
3. Deploy `SavingCore(MockUSDC, VaultManager, feeReceiver, 4 days)`.
4. Gọi `VaultManager.setCoreAddress(SavingCore)`.
5. Tạo default plan `90 ngày / 400 bps / 400 bps`.

Khi dùng frontend local, cần cập nhật ba address chain `31337` trong `frontend/src/contracts.ts`.

### Sepolia

```bash
npx hardhat deploy --network sepolia --tags all
```

Cấu hình Sepolia dùng `TESTNET_PRIVATE_KEY` từ `.env`.

---

## 13. Sepolia deployment

| Contract | Address | Deploy block |
|---|---|---:|
| MockUSDC | [`0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8`](https://sepolia.etherscan.io/address/0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8) | `11330638` |
| VaultManager | [`0x0F084FE741cD520031a51F862edAec13C7d46D79`](https://sepolia.etherscan.io/address/0x0F084FE741cD520031a51F862edAec13C7d46D79) | `11330639` |
| SavingCore | [`0xB1becB075dE06FAed11319390B4bBEc24C296dF8`](https://sepolia.etherscan.io/address/0xB1becB075dE06FAed11319390B4bBEc24C296dF8) | `11330640` |

Deployment artifacts nằm trong [`deployments/sepolia/`](deployments/sepolia/).

Frontend bắt đầu query event từ block deploy `SavingCore` để tránh scan toàn bộ lịch sử Sepolia.

---

## 14. Mint MockUSDC demo trên Sepolia

`scripts/mint-demo.ts` mint tuần tự `10,000 mUSDC` cho các test accounts được cấu hình trong script.

```bash
npm run mint:demo:sepolia
```

Script:

- Validate contract/recipient addresses.
- Dùng `parseUnits("10000", 6)`.
- Chờ từng transaction được xác nhận.
- In balance trước/sau và transaction hash.

MockUSDC mint public chỉ phục vụ test/demo. Người nhận token không cần trả gas để nhận, nhưng cần Sepolia ETH khi tự approve/open/withdraw/renew.

---

## 15. Chạy frontend

```bash
cd frontend
npm install
npm run dev
```

Build production:

```bash
npm run build
npm run preview
```

Frontend hiện cấu hình Sepolia trong:

```text
frontend/src/contracts.ts
```

Luồng sử dụng cơ bản:

1. Mở ứng dụng.
2. Kết nối MetaMask.
3. Chuyển sang Sepolia nếu cần.
4. Chọn hoặc đổi account.
5. Mint/import MockUSDC test.
6. Chọn plan và nhập số tiền.
7. Approve rồi mở deposit.
8. Theo dõi deposit trong tab Active/History.

Checklist test thủ công: [`frontend/MANUAL_TEST_CHECKLIST.md`](frontend/MANUAL_TEST_CHECKLIST.md).

---

# 16. Design Answers

## Q1. Transferable certificate

Người có quyền rút hoặc renew là **owner hiện tại của NFT**, không phải người mở deposit ban đầu:

```solidity
require(ownerOf(depositId) == msg.sender, "not owner");
```

Nếu Alice chuyển NFT cho Bob, Bob trở thành người có quyền rút principal và interest. Đây là hành vi phù hợp với ý nghĩa “transferable deposit certificate”, nhưng cũng nguy hiểm nếu user chuyển nhầm hoặc bị lừa ký transaction; vì vậy frontend phải cảnh báo rõ rằng chuyển NFT đồng nghĩa chuyển quyền kiểm soát deposit.

## Q2. Empty vault

Thiết kế hiện tại tuân thủ base specification: nếu vault không đủ interest, `payInterest()` revert:

```solidity
require(
    amount <= token.balanceOf(address(this)),
    "vault: insufficient funds for interest"
);
```

Do transaction atomic, principal đã chuyển trước đó cũng được rollback; user không mất tiền nhưng chưa thể rút cho đến khi vault được fund. Một thiết kế công bằng hơn là trả principal ngay và lưu pending interest để claim sau, nhưng project hiện chọn base rule vì đơn giản, nhất quán với đề và đã được test atomic rollback. Creative Challenge C1 chưa được triển khai.

## Q3. Dead bot

Nếu bot offline một tháng, deposit vẫn ở trạng thái `Active`; blockchain không tự chạy hàm theo thời gian. User không mất APR hay principal và vẫn có thể withdraw/manual renew, còn `autoRenewDeposit()` là public nên user hoặc bot khác có thể kích hoạt sau grace period. Cải tiến phù hợp là dùng nhiều keeper/bot dự phòng hoặc dịch vụ automation phi tập trung thay vì phụ thuộc một bot duy nhất.

## Q4. Rounding dust

Solidity integer division luôn làm tròn xuống, nên phần lẻ nhỏ hơn một đơn vị token bị giữ lại trong vault, không được cộng cho user:

```solidity
return (
    dep.principal *
    uint256(dep.aprBpsAtOpen) *
    tenorSeconds
) / (365 days * 10000);
```

Việc nhân trước rồi chia sau giữ precision tốt nhất. Dust không làm sai accounting và không gây revert; contract chỉ yêu cầu vault có đủ **interest đã làm tròn xuống**. Test math so sánh chính xác `9,863,013` units interest và còn có test phản chứng với công thức chia trước.

## Q5. Boundary times

Tại đúng `maturityAt`, deposit không còn được rút sớm:

```solidity
// maturity withdrawal / manual renew
block.timestamp >= maturityAt

// early withdrawal
block.timestamp < maturityAt
```

Tại đúng `maturityAt + gracePeriodSeconds`, auto-renew đã được phép:

```solidity
block.timestamp >= maturityAt + gracePeriodSeconds
```

Manual renew hiện chỉ yêu cầu `timestamp >= maturityAt`, nên nếu deposit vẫn `Active`, user vẫn có thể manual renew ngay cả sau grace period; đây là race transaction hợp lệ giữa user và bot. Transaction được mine trước đổi status, transaction sau revert vì `not active`.

## Q6. Disabled plan with active deposits

Disable plan chỉ ngăn deposit mới và manual renew **vào** plan đó:

```solidity
require(plan.enabled, "plan is not enabled");
require(newPlan.enabled, "new plan is not enabled");
```

Các deposit đang Active vẫn có thể rút sớm, rút đúng hạn hoặc manual renew sang plan khác đang enabled. Auto-renew vẫn được phép theo plan cũ dù plan đã disabled, vì đây là tiếp tục thụ động cam kết cũ, không phải user chọn một sản phẩm mới.

## Q7. Attack thinking

Một vector thực tế là reentrancy qua `_safeMint()`: nếu caller là smart contract, `onERC721Received()` có thể callback vào các hàm rút trước khi luồng mở deposit hoàn tất. Hệ thống chuyển principal vào SavingCore trước khi mint và dùng `nonReentrant`:

```solidity
depositToken.safeTransferFrom(msg.sender, address(this), amount);
_safeMint(msg.sender, depositId);
```

Các hàm chuyển tiền đều dùng `nonReentrant`, đồng thời cập nhật status trước external calls. Ngoài ra, `VaultManager.payInterest()` có `onlyCore`, nên cả admin lẫn attacker không thể gọi trực tiếp để rút quỹ interest.

---

## 17. Creative Challenges

Project hiện triển khai đầy đủ **base specification**. Các challenge bonus chưa được đánh dấu hoàn thành:

- C1 — Principal always safe: chưa triển khai pending-interest claim.
- C2 — Solvency guard: chưa theo dõi total promised interest.
- C3 — Partial early withdrawal: chưa triển khai.
- C4 — Top-up deposit: chưa triển khai.
- C5 — Custom challenge: chưa chốt.

Không nên tính bonus nếu chưa có cả implementation, test và README trade-off theo yêu cầu đề bài.

---

## 18. Security notes

- Đây là project học tập, chưa được audit độc lập.
- `MockUSDC.mint()` public và không phù hợp production.
- Admin có thể withdraw toàn bộ vault vì chưa có solvency guard.
- Empty vault có thể trì hoãn maturity withdrawal/renew.
- Auto-renew cần một external caller.
- Không chia sẻ `.env`, private key hoặc seed phrase.
- Chỉ dùng contract addresses trên đúng network.

---

## 19. Tài liệu tiến độ

- [Requirements Notes](docs/requirements-notes.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Plan](docs/PLAN.md)
- [Day 2 Report](docs/day2-report.md)
- [Day 3 Report](docs/day3-report.md)
- [Day 4 Report](docs/day4-report.md)
- [Day 5 Report — Testing & Self-Audit](docs/day5-report.md)
- [Day 6 Report — Sepolia & Frontend Review](docs/day6-report.md)

---

## 20. Submission checklist

- [x] `MockUSDC.sol`
- [x] `VaultManager.sol`
- [x] `SavingCore.sol`
- [x] 5 base user flows
- [x] Required events
- [x] Personal Variant 28
- [x] 93 smart-contract tests
- [x] Coverage > 90%
- [x] Sepolia deployment artifacts
- [x] React + MetaMask frontend
- [x] Design Answers
- [ ] Hoàn tất frontend manual regression test
- [ ] Cleanup comment cũ trong contract
- [ ] Video demo 3–5 phút
- [ ] Final review và submission

---

## License

ISC
