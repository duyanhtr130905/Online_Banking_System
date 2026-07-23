# Báo cáo Ngày 6 — Sepolia Deploy + Frontend Integration Review

**Trạng thái:** Đã rà soát commit mới nhất `eea2a41` (`Update deploy Testnet and Frontend`) trên branch `main`. Commit bổ sung phần deploy Sepolia, deployment artifacts, frontend React/Vite hoàn chỉnh hơn, script mint token demo và checklist test thủ công.

> Ghi chú tiến độ: theo `PLAN.md` ban đầu, Ngày 6 dự kiến dành cho Design Answers. Tuy nhiên tiến độ thực tế đã được điều chỉnh: sau khi hoàn thành Testing ở Ngày 5, công việc chuyển sang deploy Sepolia và hoàn thiện frontend. Báo cáo này ghi nhận **trạng thái thực tế của project**, không cố ép nội dung vào kế hoạch ban đầu.

---

## 1. Phạm vi thay đổi đã kiểm tra

Commit mới nhất thay đổi **48 file**, với phần lớn nội dung mới thuộc các nhóm:

- `deployments/sepolia/`: deployment artifacts của 3 contract.
- `deploy/00-deploy.ts`: bổ sung tạo default plan sau deploy.
- `frontend/`: ứng dụng React + Vite + TypeScript sử dụng `ethers` v6.
- `scripts/mint-demo.ts`: mint MockUSDC phục vụ demo.
- `.env.example`: bổ sung `ETHERSCAN_API_KEY`.
- `hardhat.config.ts`: cấu hình Sepolia và verify.
- `frontend/MANUAL_TEST_CHECKLIST.md`: checklist test UI thủ công.

Không có thay đổi mới vào business logic của `SavingCore.sol`, `VaultManager.sol` hoặc `MockUSDC.sol` trong commit frontend/deploy này. Smart contract vẫn giữ phiên bản đã được test ở Ngày 5.

---

## 2. Kết quả rà soát deploy Sepolia

### 2.1. Contract address

| Contract | Sepolia address |
|---|---|
| `MockUSDC` | `0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8` |
| `VaultManager` | `0x0F084FE741cD520031a51F862edAec13C7d46D79` |
| `SavingCore` | `0xB1becB075dE06FAed11319390B4bBEc24C296dF8` |

Ba địa chỉ trong `frontend/src/contracts.ts` khớp với deployment artifacts được commit trong `deployments/sepolia/`.

### 2.2. Deployment blocks

| Contract | Block |
|---|---:|
| `MockUSDC` | `11330638` |
| `VaultManager` | `11330639` |
| `SavingCore` | `11330640` |

Frontend dùng:

```ts
DEPLOY_BLOCK[11155111] = 11330640;
```

Giá trị này đúng với block deploy `SavingCore` và phù hợp để bắt đầu quét các event `Transfer`/`Renewed` của NFT deposit mà không phải scan toàn bộ Sepolia.

### 2.3. Constructor wiring

Deployment artifacts thể hiện:

- `VaultManager` được khởi tạo với địa chỉ `MockUSDC`.
- `SavingCore` được khởi tạo với:
  - địa chỉ `MockUSDC`;
  - địa chỉ `VaultManager`;
  - fee receiver/deployer;
  - grace period theo Personal Variant.
- Script deploy gọi `VaultManager.setCoreAddress(SavingCore)`.
- Script tạo default plan:
  - tenor: `90 ngày`;
  - APR: `400 bps`;
  - penalty: `400 bps`;
  - min deposit: `0`;
  - max deposit: `0`.

Script có kiểm tra `getPlan(0)` trước khi tạo, giúp tránh tạo trùng default plan nếu deployment script được chạy lại trên cùng network và dùng lại deployment cũ.

### 2.4. Deployment artifacts

Các artifact Sepolia có:

- address;
- ABI;
- constructor arguments;
- transaction hash;
- receipt;
- block number;
- compiler metadata;
- `solcInputs`.

Receipt của các deployment được lưu với `status = 1`, cho thấy giao dịch deploy trong artifact đã thành công.

### 2.5. Giới hạn xác minh

Repo đã chứa đầy đủ dữ liệu cần thiết để đối chiếu địa chỉ, constructor và deployment transaction. Việc contract đã được verify trên Etherscan được ghi nhận theo trạng thái dự án, nhưng trong vòng review này chưa xác minh độc lập trực tiếp trạng thái “Contract Source Code Verified” trên giao diện Etherscan.

---

## 3. Kiến trúc frontend sau cập nhật

Frontend giữ cấu trúc phân lớp tương đối rõ:

```text
WalletProvider
└── PlansProvider
    └── AccountDataProvider
        └── App
```

### 3.1. Context

- `WalletContext`
  - account;
  - chainId;
  - provider;
  - signer;
  - connect;
  - switch Sepolia;
  - xử lý `accountsChanged` và `chainChanged`.

- `PlansContext`
  - tải danh sách plan;
  - giữ trạng thái loading/error;
  - refresh dùng chung cho `PlanList`, `AdminPanel`, `OpenDepositForm`.

- `AccountDataContext`
  - balance MockUSDC;
  - active deposits;
  - historical deposits;
  - refresh balance/deposits dùng chung sau transaction.

Cách thêm `AccountDataContext` là hợp lý: tránh dồn dữ liệu account vào `App.tsx`, đồng thời cho phép `OpenDepositForm`, `MyDeposits` và `DepositCard` refresh đồng bộ sau thao tác.

### 3.2. Hook

- `useWallet`: quản lý MetaMask và network.
- `useContracts`: tạo instance của 3 contract bằng signer.
- `useRole`: kiểm tra `ADMIN_ROLE`.
- `useMyDeposits`: tìm deposit qua event ERC721 `Transfer`, sau đó đọc lại trạng thái on-chain.

### 3.3. Component

- `ConnectButton`
- `AdminPanel`
- `VaultAdminPanel`
- `PlanList`
- `OpenDepositForm`
- `MyDeposits`
- `DepositCard`

Các component được tách theo nghiệp vụ, chưa có dấu hiệu dồn toàn bộ logic vào một file trung tâm.

---

## 4. Đối chiếu chức năng frontend với smart contract

### 4.1. Wallet và network

| Chức năng | Trạng thái |
|---|---|
| Connect MetaMask | Có |
| Hiển thị account rút gọn | Có |
| Hiển thị network | Có |
| Xử lý đổi account | Có |
| Xử lý disconnect (`accountsChanged([])`) | Có |
| Xử lý đổi chain không tự bật connect prompt | Có |
| Switch sang Sepolia | Có |
| Chặn dashboard khi network chưa cấu hình đủ address | Có |

Hardhat Local vẫn được khai báo trong constants nhưng ba address để trống. `isNetworkConfigured()` yêu cầu đủ ba địa chỉ hợp lệ, nên frontend không còn quảng cáo local là sẵn sàng khi cấu hình chưa đầy đủ.

### 4.2. Plan management

| Contract function | Frontend |
|---|---|
| `getPlan` | Có |
| `createPlan` | Có |
| `updatePlan` | Có |
| `enablePlan` | Có |
| `disablePlan` | Có |
| `deletePlan` | Không có — đúng vì contract không hỗ trợ |

Frontend chỉ cho cập nhật APR của plan cũ. Tenor, penalty, min và max không có UI sửa vì contract không cung cấp hàm tương ứng.

Quy ước hiển thị đã được sửa đúng:

- `minDeposit = 0` → “Không có mức tối thiểu”.
- `maxDeposit = 0` → “Không giới hạn”.

### 4.3. SavingCore admin

| Contract function/state | Frontend |
|---|---|
| `paused()` | Có |
| `pause()` / `unpause()` | Có |
| `feeReceiver()` | Có |
| `setFeeReceiver()` | Có |
| `gracePeriodSeconds()` | Có |
| `setGracePeriod()` | Có |

Grace period được nhập theo ngày/giờ/giây và chuyển về seconds trước khi gửi transaction. Frontend không còn hard-code 4 ngày trong `DepositCard`.

### 4.4. VaultManager admin

| Contract function/state | Frontend |
|---|---|
| Token balance | Có |
| `paused()` | Có |
| `fundVault()` | Có |
| `withdrawVault()` | Có |
| `pause()` / `unpause()` | Có |
| ERC20 allowance trước fund | Có |
| `payInterest()` | Không có UI — đúng, chỉ `SavingCore` được gọi |
| `setCoreAddress()` | Không có UI — chấp nhận được vì đây là deployment wiring |

SavingCore pause và VaultManager pause được hiển thị, điều khiển độc lập, đúng với architecture và test Ngày 5.

### 4.5. User deposit flows

| User flow | Frontend |
|---|---|
| Xem plan enabled | Có |
| Xem MockUSDC balance | Có |
| Approve SavingCore | Có |
| `openDeposit` | Có |
| Xem active deposit | Có |
| Lãi dự kiến từ `calculateInterest` | Có |
| Phạt dự kiến từ `calculatePenalty` | Có |
| `earlyWithdraw` | Có, kèm confirm payout/phạt |
| `withdrawAtMaturity` | Có |
| `renewDeposit` | Có |
| `autoRenewDeposit` sau grace | Có |
| Lịch sử Withdrawn/ManualRenewed/AutoRenewed | Có |
| Liên kết old deposit → new deposit qua `Renewed` event | Có |

Frontend không tự gọi auto-renew khi render. Nút auto-renew chỉ xuất hiện khi thời gian on-chain đã vượt maturity + grace period và deposit vẫn Active.

---

## 5. Cách frontend lấy dữ liệu deposit

`SavingCore` không kế thừa `ERC721Enumerable`, vì vậy frontend không thể gọi một hàm dạng `tokensOfOwner()`.

Giải pháp hiện tại:

1. Quét event `Transfer(null, account)` từ block deploy SavingCore.
2. Thu thập các tokenId mà account từng nhận.
3. Đọc lại `getDeposit(tokenId)`.
4. Kiểm tra `ownerOf(tokenId)` để xác định owner hiện tại.
5. Phân loại:
   - Active và account đang sở hữu → tab “Đang hoạt động”.
   - Status khác Active → tab “Lịch sử”.
6. Quét `Renewed` event để liên kết deposit cũ với deposit mới.

Giải pháp này tương thích với contract hiện tại và hỗ trợ trường hợp NFT được chuyển nhượng.

---

## 6. Các điểm đã làm tốt

### 6.1. Không giả lập business logic ở frontend

Các giá trị quan trọng được đọc từ contract:

- APR/penalty snapshot;
- maturity;
- grace period;
- expected interest;
- expected penalty;
- deposit status;
- owner hiện tại;
- pause state;
- vault balance.

Frontend chỉ làm validation sớm để cải thiện UX; smart contract vẫn là nguồn quyết định cuối cùng.

### 6.2. Transaction flow thống nhất hơn

Các write action đều có xu hướng:

1. khóa nút khi pending;
2. hiển thị trạng thái chờ MetaMask;
3. chờ `tx.wait()`;
4. hiển thị success/error;
5. refresh dữ liệu liên quan.

Điều này giảm nguy cơ double-submit và dữ liệu UI không cập nhật sau giao dịch.

### 6.3. Xử lý RPC error tốt hơn bản cũ

`PlansContext`, `useMyDeposits` và `AccountDataContext` có error state. Khi refresh lỗi, frontend giữ dữ liệu cũ và cảnh báo rằng dữ liệu mới chưa được cập nhật, thay vì âm thầm coi lỗi RPC là dữ liệu rỗng.

### 6.4. Timeline đã sửa lỗi chồng chữ

Marker “Hôm nay” được chia thành ba vùng:

- gần đầu;
- giữa;
- gần cuối.

Nhãn không còn chồng lên “Ngày mở” khi deposit vừa được tạo.

---

## 7. Các điểm cần lưu ý trước khi test frontend

Các điểm dưới đây chưa đủ để kết luận là bug contract; chúng là mục cần test hoặc polish tiếp.

### 7.1. Vault Sepolia đang có thể chưa đủ lãi

Ảnh giao diện gần nhất cho thấy VaultManager có số dư `0 USDC`, trong khi deposit đang active có lãi dự kiến.

Khi vault không đủ lãi:

- `withdrawAtMaturity`;
- `renewDeposit`;
- `autoRenewDeposit`

sẽ revert toàn bộ transaction. Đây là hành vi đúng theo Business Rule #5.

Trước khi test các flow đáo hạn/renew trên môi trường có deposit phù hợp, cần fund vault đủ tiền.

### 7.2. Active/history khi đổi account cần test kỹ

Các context chủ động giữ dữ liệu cũ khi RPC refresh lỗi. Đây là lựa chọn hợp lý cho lỗi mạng, nhưng khi **đổi account**, cần xác nhận UI không hiển thị tạm dữ liệu của account trước quá lâu hoặc giữ dữ liệu cũ nếu RPC account mới thất bại.

Đây là test ưu tiên cao vì liên quan tính đúng đắn của dữ liệu theo account.

### 7.3. Ý nghĩa tab “Lịch sử”

Danh sách candidate dựa trên mọi NFT mà account **từng nhận**. Vì vậy, nếu account chuyển NFT active cho người khác và owner mới xử lý deposit sau đó, account cũ có thể vẫn thấy record đó trong lịch sử nghiệp vụ.

Điều này không làm sai tiền hoặc quyền thao tác, nhưng cần thống nhất ý nghĩa UX:

- “Lịch sử deposit từng liên quan đến ví”, hoặc
- chỉ “lịch sử do ví kết thúc”.

Hiện implementation gần với nghĩa thứ nhất.

### 7.4. Comment “NFT cũ bị burn” không khớp contract

Trong `useMyDeposits.ts` có comment nói withdraw/renew có thể burn NFT cũ. `SavingCore.sol` hiện **không gọi `_burn()`** trong withdraw hoặc renew; NFT cũ vẫn tồn tại nhưng Deposit status không còn Active.

Đây là lỗi comment/tài liệu, không phải lỗi nghiệp vụ runtime. Nên sửa comment để tránh gây hiểu sai khi báo cáo hoặc vấn đáp.

### 7.5. Query event có thể nặng dần

Frontend quét:

- `Transfer` theo account;
- toàn bộ `Renewed` event từ deploy block.

Với quy mô bài tập/Sepolia hiện tại, giải pháp này chấp nhận được. Nếu dữ liệu tăng lớn, cần indexer hoặc filter event theo ID/account tốt hơn.

### 7.6. Plan loading phụ thuộc revert “plan does not exist”

Contract không expose `_nextPlanId`, nên frontend gọi `getPlan(0..n)` cho tới khi gặp revert. Bản mới đã:

- phân biệt message `plan does not exist`;
- có giới hạn quét 1.000 plan;
- không coi mọi lỗi RPC là hết danh sách.

Đây là phương án tương thích tốt nhất với ABI hiện tại, nhưng cần test trên RPC thực tế vì error message từ provider có thể khác định dạng.

### 7.7. Bảng plan còn overflow ngang

Ảnh giao diện cho thấy bảng plan có thanh cuộn ngang và cột action khá rộng. Không ảnh hưởng business logic, nhưng cần kiểm tra:

- desktop;
- 768px;
- 320px;
- nút không bị cắt chữ;
- input APR dễ thao tác.

### 7.8. Chưa có frontend automated test

Frontend hiện có:

- TypeScript/Vite build thành công theo báo cáo triển khai;
- manual test checklist.

Chưa thấy test runner/component test/E2E test trong `frontend/package.json`. Vì vậy giai đoạn tiếp theo cần test thủ công có hệ thống; sau đó mới quyết định có cần thêm Vitest/React Testing Library hay không.

### 7.9. README gốc chưa cập nhật trạng thái mới

`README.md` hiện vẫn ghi sẽ bổ sung hướng dẫn deploy testnet và frontend sau. Cấu trúc thư mục trong README cũng chưa phản ánh:

- `frontend/`;
- `deployments/`;
- địa chỉ Sepolia;
- cách mint MockUSDC demo;
- cách chạy frontend.

Đây là tài liệu cần cập nhật sau khi frontend test ổn định.

### 7.10. Comment theo “Ngày 3/4/5” trong contract đã lỗi thời

Một số comment đầu `SavingCore.sol` vẫn nói các hàm deposit/renew “chưa làm”, dù code đã hoàn thành. Không ảnh hưởng bytecode nhưng có thể gây mất điểm code quality hoặc gây nhầm khi vấn đáp.

Nên làm một vòng cleanup comment sau khi frontend test xong, không thay đổi logic.

---

## 8. Đối chiếu lại 7 invariant với frontend

| # | Invariant | Frontend thể hiện |
|---|---|---|
| 1 | APR & penalty snapshot | Card đọc `aprBpsAtOpen`, `penaltyBpsAtOpen`; update APR cảnh báo deposit cũ không đổi |
| 2 | Simple interest | Lãi dự kiến đọc từ `calculateInterest` |
| 3 | Rút sớm = lãi 0 | Confirm rút sớm hiển thị principal, penalty, payout và cảnh báo không nhận lãi |
| 4 | Auto-renew giữ APR gốc | Frontend gọi đúng `autoRenewDeposit`, không tự tính APR mới |
| 5 | Lãi từ vault, thiếu thì revert | Vault panel riêng; cần fund vault trước test maturity/renew |
| 6 | Pause chặn thao tác | Hiển thị SavingCore pause và VaultManager pause độc lập |
| 7 | Admin không sửa deposit đã mở | Không có UI sửa Deposit; admin chỉ quản lý plan/settings/vault |

Frontend không thay thế hoặc làm suy yếu invariant nào của contract.

---

## 9. Kết luận review

### Đã xác nhận

- Commit frontend/deploy đã được push lên `main`.
- Deployment artifacts Sepolia có đủ 3 contract.
- Address frontend khớp deployment artifacts.
- Deploy block dùng cho event query khớp SavingCore.
- Deploy script tạo default plan đúng Personal Variant.
- Frontend bao phủ đủ 5 user flow bắt buộc.
- Frontend bao phủ các chức năng admin cần thiết của SavingCore và VaultManager.
- Không thêm `deletePlan` trái với contract.
- Grace period, interest và penalty được đọc on-chain.
- Build frontend đã được báo cáo thành công.
- Có checklist manual test để bắt đầu giai đoạn kiểm thử.

### Chưa kết luận cho đến khi test thực tế

- Tất cả transaction có chạy đúng trên MetaMask/Sepolia hay không.
- Refresh Active/History sau từng action có luôn đồng bộ hay không.
- Đổi account/network có để lại dữ liệu stale hay không.
- Error message từ RPC/ethers có được parse rõ trong mọi case hay không.
- UI responsive ở các viewport nhỏ.
- Maturity/manual renew/auto-renew qua UI trong môi trường có thể điều khiển thời gian.
- Trạng thái verify trực tiếp trên Etherscan trong vòng kiểm tra này.

---

## 10. Bước tiếp theo

Chuyển sang **Frontend Manual Test + Bug Fix** theo từng nhóm:

1. Wallet/network.
2. Read-only data.
3. Admin SavingCore.
4. Admin VaultManager.
5. Open deposit.
6. Early withdraw.
7. Active/history refresh.
8. Maturity/manual renew/auto-renew trên Hardhat Local hoặc môi trường test có thể điều khiển thời gian.
9. Error cases và RPC failure.
10. Responsive/polish.

Sau khi test xong mới cập nhật README, làm sạch comment cũ và chốt frontend cho video demo.
