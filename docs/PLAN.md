# PLAN.md — Kế hoạch làm việc

---

## Ngày 1 — Requirement Analysis + Architecture Design

1. Đọc kỹ đề, làm rõ thuật ngữ, tính Personal Variant theo Student ID
2. Tóm tắt 5 user flow + checklist 7 business rules
3. Thiết kế storage layout (struct `Plan`, `Deposit`) + chốt kiến trúc 3 contract tách biệt
4. Chọn thư viện OpenZeppelin, thiết kế access control, viết chữ ký hàm từng contract
5. Vẽ sơ đồ kiến trúc tổng thể, nháp sớm câu hỏi mở #1 và #7

**Output:** `docs/requirements-notes.md`, `docs/ARCHITECTURE.md`

---

## Ngày 2 — Coding Phase 1: MockUSDC + VaultManager + Plan logic

1. Code `MockUSDC.sol` (ERC20, 6 decimals, mint tự do)
2. Code `VaultManager.sol` đầy đủ (fundVault, withdrawVault, `payInterest` chỉ SavingCore gọi được, pause)
3. Code khung `SavingCore.sol` (ERC721 + AccessControl + Pausable + ReentrancyGuard) + Plan management (createPlan/updatePlan/enable/disablePlan)
4. Compile kiểm tra cú pháp, đối chiếu checklist 7 invariant xem cái nào đã có nền tảng

**Output:** `contracts/MockUSDC.sol`, `contracts/VaultManager.sol`, `contracts/SavingCore.sol` (khung), `docs/day2-report.md`

---

##  Ngày 3 — Coding Phase 2: Deposit logic

1. Code `openDeposit` (mint NFT, snapshot APR/penalty)
2. Code `withdrawAtMaturity` — công thức simple interest
3. Code `earlyWithdraw` — công thức penalty
4. Viết `math-verification.md` đối chiếu số liệu tính tay với output contract, dùng đúng Personal Variant
5. Compile + chạy thử 1 kịch bản happy path

**Output:** `SavingCore.sol` cập nhật, `docs/math-verification.md`

---

##  Ngày 4 — Coding Phase 2.5: Renew logic + chuyển sang tư duy audit

1. Code `renewDeposit` (manual) + `autoRenewDeposit`
2. Test nhanh: gọi trước/sau grace period, APR khóa đúng giá trị gốc
3. Rà lại toàn bộ 3 contract, đối chiếu checklist 7 invariant lần cuối
4. Đọc lại code theo góc nhìn "hacker" — ghi chú rủi ro tiềm ẩn từng hàm
5. Chọn 2 Creative Challenge sẽ làm (khuyến nghị C1, C2)

**Output:** `SavingCore.sol` hoàn chỉnh 5 user flow, ghi chú threat-modeling nháp

---

##  Ngày 5 — Testing + Self-Audit

1. Quyết định cách setup Hardhat (sau khi hỏi mentor), viết test suite đầy đủ theo checklist tối thiểu Mục 7.2
2. Chạy coverage, đảm bảo >90%
3. Threat modeling có hệ thống (reentrancy, double withdraw, access control...) + test chứng minh đã chặn
4. Code + test riêng cho 2 Creative Challenge đã chọn

**Output:** `test/*.test.js`, coverage report >90%, contracts cập nhật Creative Challenges

---

##  Ngày 6 — Design Answers (7 câu hỏi mở)

1. Trả lời từng câu: trả lời trực tiếp + trích code + ưu/nhược + đề xuất cải tiến
2. Đối chiếu câu 2 (Empty vault) và câu 3 (Dead bot) với Creative Challenge đã code
3. Tự đặt câu hỏi ngược kiểu vấn đáp (đổi số liệu) để luyện phản xạ
4. Viết note Creative Challenge: vấn đề – giải pháp – trade-off

**Output:** README phần "Design Answers" hoàn chỉnh

---

## Ngày 7 — Frontend + Testnet Deploy

1. Deploy 3 contract lên testnet, verify trên block explorer
2. Dựng React frontend: connect MetaMask, view plan, open/withdraw/renew deposit
3. Test thủ công toàn bộ luồng qua UI thật
4. Hoàn thiện hướng dẫn chạy trong README

**Output:** Contract address đã verify, frontend chạy được, README setup hoàn chỉnh

---

## Ngày 8 — Review toàn diện + Video Demo

1. Review chéo README theo checklist Mục 11 đề bài
2. Chạy lại test suite + coverage lần cuối
3. Quay video demo 3–5 phút
4. Đối chiếu số liệu video/test/README khớp 100% Personal Variant
5. Push code final lên GitHub

**Output:** Video demo, repo hoàn chỉnh sẵn sàng nộp

---

## Ngày 9 — Buffer / Dự phòng

1. Dùng bù tiến độ nếu có ngày nào bị trễ
2. Nếu đúng tiến độ: làm thêm Creative Challenge thứ 3, hoặc polish code quality/frontend
3. Đọc lại toàn bộ code + README 1 lượt cuối, chuẩn bị tinh thần cho Ngày 10

**Output:** Tùy tình hình thực tế — không có deliverable bắt buộc

---

##  Ngày 10 — Báo cáo & Vấn đáp

1. Đọc lại code 1 lượt cuối, đặc biệt các hàm liên quan 7 câu hỏi mở
2. Tự mô phỏng vấn đáp với số liệu bị đổi (giáo viên có thể hỏi lại theo hướng khác)
3. Chuẩn bị sẵn tab/màn hình code để mở nhanh khi được hỏi
4. Trình bày: Tổng quan → Kiến trúc → Demo → Design Answers → Creative Challenges → Q&A

**Output:** Buổi báo cáo hoàn tất

---

