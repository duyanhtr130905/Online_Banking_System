# Term Deposit System — Blockchain Programming Final Project

Hệ thống gửi tiết kiệm có kỳ hạn (term deposit) trên blockchain, mô phỏng nghiệp vụ ngân hàng bằng smart contract Solidity.

## Personal Variant

Tính theo 2 số cuối Student ID (28) — A = 8 (số cuối), B = 2 (số áp chót):

| Tham số | Giá trị |
|---|---|
| Grace period (auto-renew) | 4 ngày |
| Default plan APR | 4.00% (400 bps) |
| Early withdraw penalty | 4.00% (400 bps) |
| Default plan tenor | 90 ngày |

## Kiến trúc (tóm tắt)

- **`SavingCore.sol`** — business logic chính + NFT chứng chỉ deposit (ERC721)
- **`VaultManager.sol`** — quỹ trả lãi, tách biệt hoàn toàn khỏi tiền gốc
- **`MockUSDC.sol`** — token ERC20 test (6 decimals)

Chi tiết đầy đủ về thiết kế, lý do lựa chọn kiến trúc: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)

## Cài đặt & Chạy

```bash
git clone https://github.com/duyanhtr130905/Online_Banking_System.git
cd Online_Banking_System
npm install
npx hardhat compile
npx hardhat test
npx hardhat coverage
```

> Sẽ bổ sung hướng dẫn deploy testnet và chạy frontend khi hoàn thiện các giai đoạn tương ứng.

## Design Answers

Trả lời 7 câu hỏi thiết kế mở (Section 8.2 đề bài), dựa trực tiếp trên code trong repo này:

> Sẽ hoàn thiện ở giai đoạn viết Design Answers — xem tiến độ chi tiết tại [`docs/PLAN.md`](docs/PLAN.md).

## Cấu trúc thư mục

```
contracts/     Smart contracts (Solidity)
test/          Test suite (Hardhat)
scripts/       Script deploy / helper
docs/          Tài liệu thiết kế, kế hoạch, design answers
```
