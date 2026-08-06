# Online Banking System — Term Deposit on Blockchain

Hệ thống gửi tiết kiệm có kỳ hạn chạy trên blockchain. Người dùng gửi `MockUSDC` vào một saving plan và nhận NFT ERC721 đại diện cho chứng chỉ tiền gửi. NFT này có thể được chuyển nhượng; owner hiện tại có quyền rút tiền hoặc gia hạn deposit.

## Trạng thái hiện tại

- Hoàn thiện 3 smart contract: `MockUSDC`, `VaultManager`, `SavingCore`.
- Deploy thành công trên Sepolia.
- Frontend React tích hợp MetaMask, hỗ trợ Hardhat Local và Sepolia.
- Có bot off-chain tự động kích hoạt auto-renew sau grace period.
- `98 passing` trong test suite hiện tại.
- Solidity branch coverage vượt 90%.

> Đây là project học tập. `MockUSDC` không phải tài sản thật và các contract chưa được audit độc lập.

---

## 1. Personal Variant

Student ID kết thúc bằng **28**:

- `A = 8` — chữ số cuối.
- `B = 2` — chữ số áp chót.

| Tham số | Công thức | Giá trị |
|---|---|---:|
| Grace period | `(A mod 3) + 2` ngày | **4 ngày** |
| Default APR | `200 + A × 25` bps | **400 bps = 4.00%/năm** |
| Early-withdraw penalty | `300 + B × 50` bps | **400 bps = 4.00%** |
| Default tenor | `B` chẵn → 90 ngày | **90 ngày** |

Các giá trị này được dùng trong deploy script, contract configuration, test suite và frontend.

---

## 2. Tính năng đã triển khai

### Depositor

- Kết nối MetaMask và chuyển giữa Hardhat Local/Sepolia.
- Xem các saving plan đang mở.
- Xem số dư và allowance `MockUSDC`.
- Approve token và mở deposit.
- Nhận NFT ERC721 đại diện cho deposit.
- Xem principal, APR/penalty snapshot, maturity, lãi và phạt dự kiến.
- Rút sớm: không nhận lãi và chịu penalty.
- Rút đúng hạn: nhận principal và interest.
- Manual renew sang plan đang enabled.
- Dropdown manual renew mặc định giữ plan hiện tại nếu plan còn enabled.
- Auto-renew sau grace period bằng bot off-chain hoặc caller công khai.
- Chuyển NFT deposit cho địa chỉ khác.
- Xem deposit đang hoạt động và lịch sử `Withdrawn`, `ManualRenewed`, `AutoRenewed`.

### Bank Admin

- Tạo saving plan.
- Cập nhật APR áp dụng cho deposit mở mới.
- Enable/disable plan.
- Cập nhật `feeReceiver`.
- Cập nhật grace period.
- Pause/unpause `SavingCore`.
- Fund/withdraw interest vault.
- Pause/unpause `VaultManager` độc lập.

---

## 3. Kiến trúc

```text
User / Admin / Auto-renew Bot
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
│ - Chỉ chấp nhận SavingCore       │
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

- ERC20 test token, `decimals() = 6`.
- `mint()` public để phục vụ test/demo.
- Không phù hợp cho production.

### `VaultManager.sol`

- Giữ quỹ dùng để trả interest.
- Admin có thể fund, withdraw và pause.
- `payInterest()` chỉ được gọi bởi `SavingCore` đã wiring.

### `SavingCore.sol`

- Quản lý saving plans và deposit lifecycle.
- Giữ principal của người dùng.
- Mint ERC721 `Term Deposit Certificate (TDC)`.
- Snapshot APR và penalty tại thời điểm mở deposit.
- Hỗ trợ open, withdraw, manual renew và auto renew.
- Dùng `AccessControl`, `Pausable`, `ReentrancyGuard` và `SafeERC20`.

Chi tiết: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## 4. Quy tắc nghiệp vụ chính

### Lãi đơn

```text
interest =
    principal × aprBpsAtOpen × tenorSeconds
    ─────────────────────────────────────────
             365 days × 10,000
```

Ví dụ `1,000 USDC`, kỳ hạn `90 ngày`, APR `4%`:

```text
interest = 9.863013 USDC
payout   = 1,009.863013 USDC
```

### Rút sớm

```text
penalty = principal × penaltyBpsAtOpen / 10,000
payout  = principal - penalty
interest = 0
```

Với principal `1,000 USDC` và penalty `4%`, user nhận `960 USDC`; `40 USDC` được chuyển tới `feeReceiver`.

### Manual renew

- Chỉ owner hiện tại của NFT được gia hạn.
- Deposit phải đáo hạn.
- Plan mới phải đang enabled.
- `newPrincipal = oldPrincipal + interest`.
- Deposit cũ chuyển thành `ManualRenewed` và một NFT mới được mint.

### Auto-renew

Điều kiện:

```solidity
block.timestamp >= maturityAt + gracePeriodSeconds
```

- `autoRenewDeposit()` là hàm public; bot hoặc bất kỳ địa chỉ nào cũng có thể kích hoạt.
- NFT mới vẫn được mint cho owner của deposit cũ, không phải caller.
- Giữ plan, tenor, APR snapshot và penalty snapshot cũ.
- Deposit cũ chuyển thành `AutoRenewed`.
- Blockchain không tự chạy hàm theo thời gian; cần bot hoặc caller gửi transaction.

### Transferable certificate

`depositId` đồng thời là `tokenId` của NFT. Sau `safeTransferFrom`, owner mới có quyền rút hoặc renew deposit.

---

## 5. Tech stack

### Smart contracts

- Solidity compiler `0.8.28`
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

## 6. Cấu trúc thư mục

```text
Online_Banking_System/
├── contracts/
│   ├── MockUSDC.sol
│   ├── VaultManager.sol
│   ├── SavingCore.sol
│   └── mocks/
├── deploy/
│   └── 00-deploy.ts
├── deployments/
│   └── sepolia/
├── scripts/
│   ├── autoRenewBot.ts
│   └── mint-demo.ts
├── test/
│   ├── 00-smoke.test.ts
│   ├── 01-plan-and-vault-admin.test.ts
│   ├── 02-open-deposit-and-math.test.ts
│   ├── 03-withdraw.test.ts
│   ├── 04-renew.test.ts
│   ├── 05-integration.test.ts
│   ├── 06-auto-renew-bot.test.ts
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
├── hardhat.config.ts
├── package.json
└── README.md
```

---

## 7. Cài đặt

### Yêu cầu

- Node.js và npm.
- MetaMask để sử dụng frontend.
- Sepolia ETH khi gửi transaction trên Sepolia.

```bash
git clone https://github.com/duyanhtr130905/Online_Banking_System.git
cd Online_Banking_System
npm install
cd frontend && npm install && cd ..
```

Tạo `.env` từ `.env.example`:

```env
REPORT_GAS=0
TESTNET_PRIVATE_KEY=
ETHERSCAN_API_KEY=

# Tùy chọn cho bot; mặc định 10000 ms, tối thiểu 1000 ms
AUTO_RENEW_POLL_MS=5000
```

> Không commit `.env`, private key hoặc seed phrase lên Git.

Compile:

```bash
npm run compile
```

---

## 8. Test và coverage

```bash
npm test
npx hardhat coverage
```

Kết quả gần nhất:

- **99 tests passing**.
- `SavingCore.sol` branch coverage: **96.36%**.
- `VaultManager.sol` branch coverage: **92.86%**.
- Toàn project branch coverage: **95.00%**.
- `MockUSDC.sol`: **100%**.

Test suite bao phủ plan/admin, vault, APR/penalty snapshot, interest math, timestamp boundaries, withdraw, manual/auto renew, disabled plan, empty vault rollback, double-processing, reentrancy, pause layers và bot auto-renew.

---

## 9. Chạy Hardhat Local

### Terminal 1 — node và deployment

```bash
npm run node
```

Giữ terminal này mở. Với cấu hình `hardhat-deploy`, deploy script chạy khi node khởi động và in địa chỉ của `MockUSDC`, `VaultManager`, `SavingCore`.

Nếu node chỉ in account mà chưa deploy contract, mở terminal khác và chạy:

```bash
npx hardhat deploy --network localhost --tags all --reset
```

Địa chỉ chain `31337` trong `frontend/src/contracts.ts` phải khớp với địa chỉ deployment hiện tại.

### Terminal 2 — frontend

```bash
cd frontend
npm run dev
```

Chuyển MetaMask sang:

```text
Network: Hardhat Local
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency: ETH
```

### Terminal 3 — bot auto-renew

```bash
npm run bot:autorenew:local
```

Bot sẽ chạy liên tục và:

- Tự lấy địa chỉ `SavingCore` từ `deployments.get("SavingCore")`.
- Kiểm tra bytecode trước khi chạy.
- Quét `DepositOpened` và `Renewed` theo chunk 5,000 block.
- Chỉ quét block mới ở các vòng tiếp theo.
- Kiểm tra maturity, grace period, pause state và vault liquidity.
- Gọi `staticCall` trước transaction thật.
- Xử lý tuần tự và chống gửi trùng.
- Theo dõi deposit mới sinh ra sau renew.
- Dừng sạch bằng `Ctrl+C` (`SIGINT`/`SIGTERM`).

Poll interval mặc định là `10,000 ms`. Có thể đổi trong `.env`:

```env
AUTO_RENEW_POLL_MS=5000
```

### Terminal 4 — Hardhat console

```bash
npx hardhat console --network localhost
```

Có thể dùng console để mint token, fund vault và tăng timestamp khi demo.

> Khi tắt Hardhat node, toàn bộ state local bị reset. Các account đã import vào MetaMask vẫn còn, nhưng token balance, plans tạo thêm, deposit và NFT local phải tạo lại.

---

## 10. Chạy trên Sepolia

Deploy:

```bash
npx hardhat deploy --network sepolia --tags all
```

Mint MockUSDC demo:

```bash
npm run mint:demo:sepolia
```

Chạy bot:

```bash
npm run bot:autorenew:sepolia
```

Bot Sepolia dùng signer từ `TESTNET_PRIVATE_KEY`. Ví bot cần Sepolia ETH để trả gas.

### Contract addresses

| Contract | Address | Deploy block |
|---|---|---:|
| MockUSDC | [`0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8`](https://sepolia.etherscan.io/address/0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8) | `11330638` |
| VaultManager | [`0x0F084FE741cD520031a51F862edAec13C7d46D79`](https://sepolia.etherscan.io/address/0x0F084FE741cD520031a51F862edAec13C7d46D79) | `11330639` |
| SavingCore | [`0xB1becB075dE06FAed11319390B4bBEc24C296dF8`](https://sepolia.etherscan.io/address/0xB1becB075dE06FAed11319390B4bBEc24C296dF8) | `11330640` |

Deployment artifacts nằm trong [`deployments/sepolia/`](deployments/sepolia/).

---

## 11. Chạy frontend

Development:

```bash
cd frontend
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

Luồng sử dụng cơ bản:

1. Mở ứng dụng và kết nối MetaMask.
2. Chọn Hardhat Local hoặc Sepolia.
3. Chọn account.
4. Chọn saving plan và nhập số tiền.
5. Approve `MockUSDC` rồi mở deposit.
6. Theo dõi deposit trong tab Active/History.
7. Khi đáo hạn, rút đúng hạn hoặc manual renew.
8. Sau grace period, bot tự kích hoạt auto-renew nếu deposit vẫn Active.

Checklist test thủ công: [`frontend/MANUAL_TEST_CHECKLIST.md`](frontend/MANUAL_TEST_CHECKLIST.md).

---

## 12. Các quyết định thiết kế

### Owner của NFT là người có quyền thao tác

Contract kiểm tra `ownerOf(depositId)`. Chuyển NFT đồng nghĩa chuyển quyền kiểm soát principal và interest của deposit.

### Vault thiếu interest

Nếu vault không đủ tiền, `payInterest()` revert và toàn bộ transaction rollback. Principal không bị mất, nhưng withdraw/renew phải chờ vault được fund.

### Bot offline

Deposit vẫn `Active`. User vẫn có thể withdraw hoặc manual renew; `autoRenewDeposit()` là public nên bot khác hoặc user có thể kích hoạt sau grace period.

### Rounding

Solidity integer division làm tròn xuống. Contract nhân trước rồi chia để giữ precision tốt hơn; dust nhỏ hơn một token unit không được trả cho user.

### Boundary time

- Tại đúng `maturityAt`, maturity withdrawal và manual renew được phép.
- Tại đúng `maturityAt + gracePeriodSeconds`, auto-renew được phép.
- Nếu user và bot cùng xử lý, transaction được mine trước thay đổi status; transaction sau revert vì deposit không còn `Active`.

### Disabled plan

Disable plan ngăn deposit mới và manual renew vào plan đó. Deposit đang Active vẫn có thể withdraw; auto-renew tiếp tục theo snapshot cũ.

---

## 13. Security notes

- Project chưa được audit độc lập.
- `MockUSDC.mint()` public và không phù hợp production.
- Admin có thể withdraw vault; hệ thống chưa có solvency guard.
- Empty vault có thể trì hoãn maturity withdrawal/renew.
- Auto-renew phụ thuộc external bot/caller.
- Không chia sẻ `.env`, private key hoặc seed phrase.
- Luôn kiểm tra đúng network và đúng contract address.

---

## License

ISC
