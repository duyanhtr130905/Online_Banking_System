// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../SavingCore.sol";

/**
 * @title MaliciousReceiver
 * @notice Contract giả lập tấn công reentrancy qua _safeMint callback.
 * @dev Khi nhận NFT từ openDeposit (qua onERC721Received), lập tức gọi ngược
 *      savingCore.earlyWithdraw(tokenId) để cố rút tiền trong khi openDeposit chưa xong.
 *      Kỳ vọng: nonReentrant modifier trên SavingCore sẽ chặn cuộc gọi lồng nhau,
 *      khiến TOÀN BỘ giao dịch revert - regression test cho lỗ hổng đã fix ở Ngày 2.
 */
contract MaliciousReceiver is IERC721Receiver {
    SavingCore public immutable savingCore;
    IERC20 public immutable token;
    bool public attackEnabled;

    constructor(address _savingCore, address _token) {
        savingCore = SavingCore(_savingCore);
        token = IERC20(_token);
    }

    /// @notice Bắt đầu tấn công: approve token rồi gọi openDeposit từ contract này
    function attack(uint256 planId, uint256 amount) external {
        attackEnabled = true;
        token.approve(address(savingCore), amount);
        savingCore.openDeposit(planId, amount);
    }

    /// @notice Callback từ _safeMint — đây là điểm tấn công reentrancy
    function onERC721Received(
        address,
        address,
        uint256 tokenId,
        bytes calldata
    ) external override returns (bytes4) {
        if (attackEnabled) {
            attackEnabled = false;
            // Tấn công: gọi earlyWithdraw trong khi openDeposit đang chạy.
            // nonReentrant trên earlyWithdraw sẽ phát hiện lock đang held bởi openDeposit
            // và revert toàn bộ giao dịch.
            savingCore.earlyWithdraw(tokenId);
        }
        return this.onERC721Received.selector;
    }
}
