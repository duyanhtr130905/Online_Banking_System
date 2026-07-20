// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// SafeERC20: "găng tay an toàn" khi cầm tiền người khác - bọc quanh transfer/transferFrom
// để tránh lỗi với các token ERC20 không tuân thủ chuẩn 100% (một số token không revert khi fail,
// chỉ trả về false - nếu không dùng SafeERC20, contract có thể tưởng chuyển tiền thành công nhưng thực ra không).
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title VaultManager
 * @notice "Kho bạc" của hệ thống - CHỈ giữ tiền dùng để trả LÃI cho user.
 *         KHÔNG giữ tiền gốc (principal) - tiền gốc nằm trong SavingCore.
 * @dev Đây chính là kiến trúc hiện thực hóa Business Rule #5 (Mục 6 đề bài):
 *      "Lãi luôn được trả từ vault, tách biệt khỏi principal".
 *      VaultManager KHÔNG hề biết gì về Plan, Deposit, APR - nó chỉ biết giữ tiền và
 *      chuyển tiền theo lệnh của SavingCore.
 */
contract VaultManager is AccessControl, Pausable {
    using SafeERC20 for IERC20;

    // Role dùng cho AccessControl - thay vì chỉ có 1 "owner" duy nhất (Ownable),
    // AccessControl cho phép định nghĩa nhiều vai trò khác nhau, rõ ràng hơn khi hệ thống
    // có nhiều loại quyền (ở đây chỉ có ADMIN_ROLE, nhưng thiết kế mở để dễ mở rộng).
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // Token dùng để trả lãi (MockUSDC). "immutable" = chỉ set được 1 lần lúc deploy,
    // sau đó không đổi được nữa -> tiết kiệm gas khi đọc, và tránh admin đổi token giữa chừng.
    IERC20 public immutable token;

    // Địa chỉ contract SavingCore - CHỈ địa chỉ này được phép gọi payInterest().
    // Đây là "chuỗi ủy quyền 1 chiều" đã thiết kế ở Ngày 2: User -> SavingCore (kiểm tra đầy đủ)
    // -> VaultManager (chỉ tin SavingCore).
    address public coreAddress;

    // ==================== EVENTS ====================
    // Ghi lại lịch sử nạp/rút vault - không bắt buộc theo Mục 5 (5 event bắt buộc nằm ở
    // SavingCore), nhưng nên có để dễ theo dõi hoạt động vault qua block explorer.
    event VaultFunded(address indexed from, uint256 amount);
    event VaultWithdrawn(address indexed to, uint256 amount);
    event InterestPaid(address indexed to, uint256 amount);
    event CoreAddressSet(address indexed core);

    /**
     * @param _token Địa chỉ MockUSDC (hoặc USDC thật sau này)
     */
    constructor(address _token) {
        require(_token != address(0), "token address is zero");
        token = IERC20(_token);

        // Người deploy contract tự động có ADMIN_ROLE.
        // DEFAULT_ADMIN_ROLE (có sẵn từ AccessControl) cho phép người này CẤP/THU HỒI
        // role cho người khác sau này - đây là "quyền cao nhất".
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    /**
     * @dev Modifier tùy chỉnh (không có sẵn từ OpenZeppelin) - đây chính là dòng code
     *      QUAN TRỌNG NHẤT của cả file này. Nó đảm bảo payInterest() chỉ có thể được
     *      gọi bởi đúng 1 địa chỉ: contract SavingCore.
     *      Nếu thiếu modifier này, BẤT KỲ AI cũng gọi được payInterest() và rút sạch vault
     *      mà không cần mở deposit gì cả - đây là lỗ hổng "attack thinking" điển hình
     *      (câu hỏi mở #7 trong đề).
     */
    modifier onlyCore() {
        require(msg.sender == coreAddress, "VaultManager: caller is not SavingCore");
        _;
    }

    // ==================== ADMIN FUNCTIONS ====================

    /**
     * @notice Gắn địa chỉ contract SavingCore vào vault - chỉ gọi 1 lần sau khi deploy cả 2 contract.
     * @dev Đây là bước "nối dây" giữa 2 contract, làm thủ công sau khi deploy (không thể tự động
     *      vì lúc deploy VaultManager, SavingCore chưa tồn tại - và ngược lại nếu deploy
     *      SavingCore trước thì cũng chưa có địa chỉ VaultManager).
     */
    function setCoreAddress(address core) external onlyRole(ADMIN_ROLE) {
        require(core != address(0), "core address is zero");
        coreAddress = core;
        emit CoreAddressSet(core);
    }

    /**
     * @notice Admin nạp thêm tiền vào vault để đảm bảo đủ thanh khoản trả lãi cho user.
     * @dev CHỈ ADMIN gọi được (không mở public) - đối xứng với withdrawVault(), và khớp với
     *      Mục 4 đề bài liệt kê fundVault nằm trong nhóm "Admin Functions".
     *      Admin phải approve() cho VaultManager trước khi gọi hàm này (chuẩn ERC20).
     */
    function fundVault(uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(amount > 0, "amount must be > 0");
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(msg.sender, amount);
    }

    /**
     * @notice Admin rút bớt tiền khỏi vault (ví dụ khi vault dư thừa quá nhiều).
     * @dev Đây là hàm NHẠY CẢM NHẤT trong contract - chỉ admin, và về sau (Creative Challenge C2)
     *      nên thêm "solvency guard" để chặn admin rút vượt quá số tiền đã cam kết trả cho
     *      các deposit đang active. Ở Ngày 3 này CHƯA làm C2, chỉ có bản cơ bản.
     */
    function withdrawVault(uint256 amount) external onlyRole(ADMIN_ROLE) {
        require(amount > 0, "amount must be > 0");
        require(amount <= token.balanceOf(address(this)), "insufficient vault balance");
        token.safeTransfer(msg.sender, amount);
        emit VaultWithdrawn(msg.sender, amount);
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ==================== CORE-ONLY FUNCTION ====================

    /**
     * @notice Trả lãi cho user - ĐÂY LÀ HÀM DUY NHẤT khiến tiền rời khỏi vault để trả lãi.
     * @dev onlyCore + whenNotPaused: chỉ SavingCore gọi được, và bị chặn khi hệ thống pause
     *      (khớp Business Rule #6 - pause chặn withdraw/renew, mà withdraw/renew đều cần gọi
     *      hàm này để lấy lãi).
     *      Business Rule #5 (Mục 6): nếu vault không đủ tiền, giao dịch PHẢI revert (thất bại)
     *      - dòng require() bên dưới chính là chỗ hiện thực hóa quy tắc này.
     * @param to Địa chỉ user nhận lãi
     * @param amount Số tiền lãi cần trả
     */
    function payInterest(address to, uint256 amount) external onlyCore whenNotPaused {
        require(amount <= token.balanceOf(address(this)), "vault: insufficient funds for interest");
        token.safeTransfer(to, amount);
        emit InterestPaid(to, amount);
    }

    // ==================== VIEW FUNCTIONS ====================

    /**
     * @notice Xem vault hiện đang giữ bao nhiêu tiền - dùng để kiểm tra trước khi rút/trả lãi,
     *         hoặc để frontend hiển thị tình trạng thanh khoản.
     * @dev "view" = chỉ đọc dữ liệu, không tốn gas thật khi gọi từ bên ngoài (off-chain).
     */
    function getAvailableBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }
}
