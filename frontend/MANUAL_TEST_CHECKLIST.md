# Manual test checklist

## A. Wallet

- [ ] Connect MetaMask trên Sepolia.
- [ ] Disconnect account trong MetaMask: UI quay về trạng thái chưa kết nối.
- [ ] Đổi account: địa chỉ, số dư, plans/deposits được tải theo account mới mà không yêu cầu connect lại.
- [ ] Đổi network: provider, signer và chainId được cập nhật.
- [ ] Ở mạng không hỗ trợ hoặc Hardhat Local chưa có đủ address, bấm **Chuyển sang Sepolia**.

## B. User

- [ ] Xem danh sách plan và giới hạn min/max chính xác.
- [ ] Xem số dư và allowance MockUSDC.
- [ ] Approve khi allowance thiếu, sau đó mở deposit; số dư và danh sách deposit tự refresh.
- [ ] Rút sớm: xác nhận gốc, phạt, payout và cảnh báo không nhận lãi.
- [ ] Rút đúng hạn.
- [ ] Manual renew sang plan enabled.
- [ ] Sau grace period, gọi **Kích hoạt auto-renew** thủ công.
- [ ] Kiểm tra hai tab **Đang hoạt động** và **Lịch sử**, bao gồm liên kết Renewed cũ → mới khi event có dữ liệu.

## C. Admin

- [ ] Create plan và refresh danh sách.
- [ ] Update APR; deposit cũ vẫn hiển thị APR snapshot.
- [ ] Disable/enable plan; disable có hộp xác nhận.
- [ ] Pause/unpause SavingCore.
- [ ] Update fee receiver với địa chỉ hợp lệ, không phải zero address.
- [ ] Update grace period theo ngày/giờ/giây.
- [ ] Fund/withdraw VaultManager và kiểm tra balance.
- [ ] Pause/unpause VaultManager, xác nhận trạng thái độc lập SavingCore.

## D. Error cases

- [ ] Từ chối transaction trong MetaMask.
- [ ] Không đủ USDC hoặc allowance.
- [ ] Vault không đủ tiền trả lãi.
- [ ] SavingCore hoặc VaultManager bị pause.
- [ ] RPC lỗi khi tải plans/deposits/balance: dữ liệu cũ còn hiển thị cùng cảnh báo.
- [ ] Mạng sai hoặc Hardhat Local chưa được cấu hình address.
