// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Kế thừa từ chuẩn ERC20 chuẩn của OpenZeppelin (đã audit, không tự viết lại).
// ERC20 = "tiền tệ" - mọi đơn vị giống hệt nhau, chia nhỏ được, khác với ERC721 (NFT).
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDC
 * @notice Token ERC20 giả lập USDC, chỉ dùng để TEST hệ thống Term Deposit.
 *         Không phải USDC thật - ai cũng mint được thoải mái, không có giá trị thực.
 * @dev 6 decimals giống USDC thật (khác với ETH dùng 18 decimals).
 *      Điều này quan trọng khi tính toán: 1 USDC = 1,000,000 đơn vị nhỏ nhất (giống "wei" của ETH).
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {
        // Không mint sẵn token nào lúc deploy.
        // Người dùng/test script sẽ tự gọi mint() để lấy token khi cần.
    }

    /**
     * @notice Ghi đè hàm decimals() mặc định của ERC20 (mặc định là 18).
     * @dev USDC thật dùng 6 decimals, nên mock lại đúng như vậy để công thức tính lãi
     *      trong SavingCore khớp với thực tế khi các bạn đổi sang dùng USDC thật sau này.
     *      "override" nghĩa là ghi đè lại hàm gốc trong contract cha (ERC20).
     */
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @notice Mint (tạo ra) token mới, gửi vào địa chỉ bất kỳ.
     * @dev KHÔNG có giới hạn quyền gọi (public) - vì đây CHỈ là token test.
     *      Không bao giờ làm như vậy với token thật, sẽ mất kiểm soát nguồn cung.
     *      external = chỉ gọi được từ bên ngoài contract (không gọi nội bộ), tiết kiệm gas hơn "public".
     * @param to Địa chỉ nhận token
     * @param amount Số lượng token, tính theo đơn vị nhỏ nhất (nhớ nhân 10^6 nếu muốn "1 USDC")
     */
    function mint(address to, uint256 amount) external {
        _mint(to, amount); // _mint là hàm nội bộ có sẵn từ ERC20 của OpenZeppelin
    }
}
