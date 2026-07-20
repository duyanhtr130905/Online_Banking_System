// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultManager.sol";

/**
 * @title SavingCore
 * @notice "Phòng giao dịch" chính của hệ thống - toàn bộ nghiệp vụ Term Deposit nằm ở đây:
 *         quản lý Plan, mở deposit, rút tiền, gia hạn, và mint NFT chứng chỉ cho mỗi deposit.
 * @dev PHẠM VI NGÀY 3: struct + khung contract (ERC721, AccessControl, Pausable, ReentrancyGuard)
 *      + toàn bộ nhóm hàm quản lý Plan (createPlan/updatePlan/enable/disablePlan).
 *      CHƯA làm: openDeposit, withdrawAtMaturity, earlyWithdraw, renewDeposit, autoRenewDeposit
 *      -> những hàm này thuộc phạm vi Ngày 4 và Ngày 5, sẽ nối tiếp vào file này.
 */
contract SavingCore is ERC721, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== STATE: TOKEN & VAULT ====================

    // Token dùng làm tiền gốc (principal) - chính là MockUSDC.
    IERC20 public immutable depositToken;

    // Contract giữ tiền lãi - tách biệt hoàn toàn khỏi principal (Business Rule #5).
    VaultManager public immutable vault;

    // Địa chỉ nhận tiền phạt khi user rút sớm.
    address public feeReceiver;

    // ==================== STATE: PLAN ====================

    /**
     * @dev struct Plan = "tờ rơi quảng cáo" 1 gói tiết kiệm do admin tạo ra (Mục 2.1 đề bài).
     *      Dùng uint16 cho các trường nhỏ (tenor tính bằng ngày, APR/penalty tính bằng bps)
     *      để tiết kiệm gas storage (Solidity gộp nhiều biến nhỏ vào chung 1 "storage slot"
     *      nếu tổng kích thước <= 32 byte - đây gọi là "storage packing", không bắt buộc
     *      phải tối ưu ở mức bài tập, nhưng là thói quen tốt).
     */
    struct Plan {
        uint16 tenorDays;
        uint16 aprBps;
        uint16 earlyWithdrawPenaltyBps;
        uint256 minDeposit;
        uint256 maxDeposit; // 0 = không giới hạn tối đa
        bool enabled;
    }

    mapping(uint256 => Plan) public plans;
    uint256 private _nextPlanId; // bộ đếm tự tăng cho planId, bắt đầu từ 0

    // ==================== STATE: DEPOSIT ====================

    /**
     * @dev Trạng thái vòng đời của 1 deposit - khớp với 4 trạng thái mô tả ở Mục 2.2 đề bài.
     */
    enum Status {
        Active,
        Withdrawn,
        ManualRenewed,
        AutoRenewed
    }

    /**
     * @dev struct Deposit = "biên lai" ghi lại 1 lần user gửi tiền (Mục 2.2 đề bài).
     *      QUAN TRỌNG NHẤT: aprBpsAtOpen và penaltyBpsAtOpen là 2 trường SNAPSHOT -
     *      chúng COPY giá trị từ Plan tại thời điểm mở deposit, không phải tham chiếu
     *      ngược lại Plan. Nhờ vậy, dù sau này admin gọi updatePlan() đổi aprBps của Plan,
     *      các deposit ĐÃ MỞ trước đó vẫn giữ nguyên con số cũ - đây chính là cách hiện thực
     *      Business Rule #1 (Mục 6: "APR và penalty snapshot, không đổi theo plan sau này").
     *      depositId TRÙNG với tokenId của NFT - không cần mapping riêng để tra owner,
     *      tận dụng luôn ownerOf() có sẵn từ ERC721.
     */
    struct Deposit {
        uint256 planId;
        uint256 principal;
        uint256 maturityAt;
        uint16 aprBpsAtOpen;
        uint16 penaltyBpsAtOpen;
        Status status;
    }

    mapping(uint256 => Deposit) public deposits;
    uint256 private _nextDepositId; // bộ đếm tự tăng cho depositId (= tokenId NFT)

    // ==================== EVENTS (bắt buộc theo Mục 5 đề bài) ====================

    event PlanCreated(uint256 indexed planId, uint16 tenorDays, uint16 aprBps);
    event PlanUpdated(uint256 indexed planId, uint16 newAprBps);
    event DepositOpened(
        uint256 indexed depositId,
        address indexed owner,
        uint256 indexed planId,
        uint256 principal,
        uint256 maturityAt,
        uint16 aprBpsAtOpen
    );
    event Withdrawn(uint256 indexed depositId, address indexed owner, uint256 principal, uint256 interest, bool isEarly);
    event Renewed(uint256 indexed oldDepositId, uint256 indexed newDepositId, uint256 newPrincipal, uint256 indexed newPlanId);

    /**
     * @param _depositToken Địa chỉ MockUSDC dùng làm tiền gốc
     * @param _vault Địa chỉ VaultManager đã deploy trước đó
     * @param _feeReceiver Địa chỉ nhận phạt rút sớm ban đầu
     */
    constructor(address _depositToken, address _vault, address _feeReceiver)
        ERC721("Term Deposit Certificate", "TDC")
    {
        require(_depositToken != address(0), "token address is zero");
        require(_vault != address(0), "vault address is zero");
        require(_feeReceiver != address(0), "fee receiver is zero");

        depositToken = IERC20(_depositToken);
        vault = VaultManager(_vault);
        feeReceiver = _feeReceiver;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ==================== ADMIN: PLAN MANAGEMENT ====================
    // Phạm vi chính của Ngày 3. Đây là các hàm cho phép "Bank Admin" (Mục 1 đề bài)
    // thiết lập những gói tiết kiệm mà user sẽ chọn để mở deposit.

    /**
     * @notice Tạo 1 gói tiết kiệm mới.
     * @dev Chỉ ADMIN_ROLE gọi được. planId tự tăng dần từ 0, không cho admin tự chọn số
     *      (tránh trùng lặp hoặc ghi đè nhầm plan cũ).
     *      Validate cơ bản: aprBps và penaltyBps phải hợp lý (< 10000 bps = dưới 100%,
     *      tránh admin lỡ tay nhập sai đơn vị, ví dụ nhập "400" tưởng là 4% nhưng thực ra
     *      cần nhập đúng bps).
     */
    function createPlan(
        uint16 tenorDays,
        uint16 aprBps,
        uint16 earlyWithdrawPenaltyBps,
        uint256 minDeposit,
        uint256 maxDeposit
    ) external onlyRole(ADMIN_ROLE) returns (uint256 planId) {
        require(tenorDays > 0, "tenor must be > 0");
        require(aprBps > 0 && aprBps < 10000, "apr out of range");
        require(earlyWithdrawPenaltyBps < 10000, "penalty out of range");
        require(maxDeposit == 0 || maxDeposit >= minDeposit, "maxDeposit < minDeposit");

        planId = _nextPlanId++;
        plans[planId] = Plan({
            tenorDays: tenorDays,
            aprBps: aprBps,
            earlyWithdrawPenaltyBps: earlyWithdrawPenaltyBps,
            minDeposit: minDeposit,
            maxDeposit: maxDeposit,
            enabled: true // plan mới tạo mặc định bật luôn, admin có thể disable sau nếu cần
        });

        emit PlanCreated(planId, tenorDays, aprBps);
    }

    /**
     * @notice Đổi APR của 1 plan đã tồn tại.
     * @dev CHỈ ảnh hưởng đến các deposit MỞ MỚI sau thời điểm này. Các deposit đã mở trước đó
     *      không hề bị ảnh hưởng, vì chúng đọc aprBpsAtOpen (đã snapshot) chứ không đọc
     *      plans[planId].aprBps trực tiếp mỗi lần tính lãi. Đây chính là điểm mà câu hỏi mở
     *      thường xoáy vào để kiểm tra bạn có thực sự hiểu snapshot hay không.
     */
    function updatePlan(uint256 planId, uint16 newAprBps) external onlyRole(ADMIN_ROLE) {
        require(planId < _nextPlanId, "plan does not exist");
        require(newAprBps > 0 && newAprBps < 10000, "apr out of range");

        plans[planId].aprBps = newAprBps;
        emit PlanUpdated(planId, newAprBps);
    }

    /**
     * @notice Bật plan - cho phép mở deposit mới theo plan này.
     */
    function enablePlan(uint256 planId) external onlyRole(ADMIN_ROLE) {
        require(planId < _nextPlanId, "plan does not exist");
        plans[planId].enabled = true;
    }

    /**
     * @notice Tắt plan - KHÔNG cho mở deposit mới, nhưng KHÔNG ảnh hưởng deposit đang active
     *         theo plan này (chúng vẫn tiếp tục chạy đến khi đáo hạn bình thường).
     * @dev Đây liên quan trực tiếp đến câu hỏi mở #6 (Disabled plan với deposit đang active) -
     *      cần quyết định rõ: user có được RENEW vào 1 plan đã bị disable hay không?
     *      (Sẽ trả lời chi tiết ở Ngày 7 khi viết renewDeposit.)
     */
    function disablePlan(uint256 planId) external onlyRole(ADMIN_ROLE) {
        require(planId < _nextPlanId, "plan does not exist");
        plans[planId].enabled = false;
    }

    /**
     * @notice Đổi địa chỉ nhận phí phạt rút sớm.
     */
    function setFeeReceiver(address receiver) external onlyRole(ADMIN_ROLE) {
        require(receiver != address(0), "fee receiver is zero");
        feeReceiver = receiver;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ==================== VIEW HELPERS ====================

    function getPlan(uint256 planId) external view returns (Plan memory) {
        require(planId < _nextPlanId, "plan does not exist");
        return plans[planId];
    }

    function getDeposit(uint256 depositId) external view returns (Deposit memory) {
        require(depositId < _nextDepositId, "deposit does not exist");
        return deposits[depositId];
    }

    // ==================== BẮT BUỘC KHI KẾ THỪA NHIỀU CONTRACT ====================

    /**
     * @dev ERC721 và AccessControl đều định nghĩa hàm supportsInterface() (chuẩn ERC165
     *      để "khai báo" contract này tuân thủ những interface nào). Vì SavingCore kế thừa
     *      CẢ HAI, Solidity bắt buộc phải override lại và tự merge kết quả 2 bên - nếu không
     *      code sẽ không compile được. Đây không phải logic nghiệp vụ, chỉ là yêu cầu kỹ
     *      thuật của Solidity khi kế thừa nhiều (multiple inheritance).
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ==================== NGÀY 4-5 SẼ BỔ SUNG TẠI ĐÂY ====================
    // function openDeposit(...)
    // function withdrawAtMaturity(...)
    // function earlyWithdraw(...)
    // function renewDeposit(...)
    // function autoRenewDeposit(...)
    // function calculateInterest(...)
    // function calculatePenalty(...)
}
