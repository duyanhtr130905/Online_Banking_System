import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployFixture,
  GRACE_PERIOD_SECONDS,
  DEFAULT_APR_BPS,
  DEFAULT_PENALTY_BPS,
  DEFAULT_TENOR_DAYS,
} from "./fixtures";

// ==================== HELPERS ====================
// Mirror chính xác công thức Solidity, dùng BigInt để kết quả trùng khớp integer division

function computeInterest(principal: bigint, aprBps: number, tenorDays: number): bigint {
  const tenorSeconds = BigInt(tenorDays) * 86400n;
  return (principal * BigInt(aprBps) * tenorSeconds) / (365n * 86400n * 10000n);
}

function computePenalty(principal: bigint, penaltyBps: number): bigint {
  return (principal * BigInt(penaltyBps)) / 10000n;
}

// ==================== INTEGRATION TEST ====================

describe("Integration — full lifecycle", function () {
  it("Full lifecycle: open → manual renew → auto renew → early withdraw new deposit", async function () {
    const { savingCore, mockUSDC, vaultManager, deployer, feeReceiver, alice, bob, attacker } =
      await loadFixture(deployFixture);

    // Ghi nhận tổng đã mint ban đầu (fixture mint 1M cho alice, bob, attacker, deployer)
    const MILLION = ethers.parseUnits("1000000", 6);
    const TOTAL_MINTED = MILLION * 4n; // 4,000,000,000,000

    // ================================================================
    // STEP 1: Admin tạo 2 plan
    // ================================================================
    await savingCore.createPlan(
      DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0
    );
    // plan 0: 90 ngày, APR 400 bps (4%), penalty 400 bps (4%)

    await savingCore.createPlan(180, 500, 300, 0, 0);
    // plan 1: 180 ngày, APR 500 bps (5%), penalty 300 bps (3%)

    // ================================================================
    // STEP 2: Alice mở deposit 1000 USDC theo plan 0 → depositId=0
    // ================================================================
    const depositAmount = ethers.parseUnits("1000", 6); // 1,000,000,000
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    const dep0 = await savingCore.getDeposit(0);
    expect(dep0.aprBpsAtOpen).to.equal(400);
    expect(dep0.penaltyBpsAtOpen).to.equal(400);

    // ================================================================
    // STEP 3: Fast-forward qua maturity, Alice TỰ renew sang plan 1
    // ================================================================
    await time.increaseTo(dep0.maturityAt);

    // Tính interest deposit 0 bằng helper JS (phải khớp contract)
    const interest0 = computeInterest(depositAmount, DEFAULT_APR_BPS, DEFAULT_TENOR_DAYS);
    expect(await savingCore.calculateInterest(0)).to.equal(interest0); // cross-check

    await savingCore.connect(alice).renewDeposit(0, 1); // renew sang plan 1

    // ================================================================
    // STEP 4: Verify deposit 1 (manual renew → lấy APR từ plan MỚI)
    // ================================================================
    const newPrincipal1 = depositAmount + interest0;
    const dep1 = await savingCore.getDeposit(1);

    expect(dep1.principal).to.equal(newPrincipal1);
    expect(dep1.planId).to.equal(1);
    expect(dep1.aprBpsAtOpen).to.equal(500);     // từ plan 1 (MỚI), không phải 400
    expect(dep1.penaltyBpsAtOpen).to.equal(300); // từ plan 1 (MỚI), không phải 400
    expect(dep1.status).to.equal(0); // Active

    // Deposit 0: ManualRenewed (2)
    expect((await savingCore.getDeposit(0)).status).to.equal(2);
    expect(await savingCore.ownerOf(1)).to.equal(alice.address);

    // ================================================================
    // STEP 5a: Admin đổi APR plan 1 lên 999 (rất cao)
    // → Nếu auto-renew đọc plan hiện tại thay vì snapshot, interest sẽ sai
    // ================================================================
    await savingCore.updatePlan(1, 999);
    expect((await savingCore.getPlan(1)).aprBps).to.equal(999);

    // ================================================================
    // STEP 5b: Fast-forward qua maturity + grace, Bob auto-renew deposit 1
    // ================================================================
    // Cross-check interest trước khi auto-renew
    const interest1 = computeInterest(newPrincipal1, 500, 180);
    // aprBps=500 (từ deposit 1 snapshot), KHÔNG phải 999 (plan hiện tại)
    expect(await savingCore.calculateInterest(1)).to.equal(interest1);

    await time.increaseTo(dep1.maturityAt + BigInt(GRACE_PERIOD_SECONDS));
    await savingCore.connect(bob).autoRenewDeposit(1); // bob, không phải alice

    // ================================================================
    // STEP 6: Verify deposit 2 (auto-renew → GIỮ NGUYÊN APR snapshot)
    // ================================================================
    const newPrincipal2 = newPrincipal1 + interest1;
    const dep2 = await savingCore.getDeposit(2);

    expect(dep2.principal).to.equal(newPrincipal2);
    expect(dep2.planId).to.equal(1);
    expect(dep2.aprBpsAtOpen).to.equal(500);     // Business Rule #4: GIỮ NGUYÊN 500
    expect(dep2.penaltyBpsAtOpen).to.equal(300); // GIỮ NGUYÊN 300
    expect(dep2.status).to.equal(0); // Active
    expect(await savingCore.ownerOf(2)).to.equal(alice.address); // NFT cho alice, KHÔNG phải bob

    // Deposit 1: AutoRenewed (3)
    expect((await savingCore.getDeposit(1)).status).to.equal(3);

    // ================================================================
    // STEP 7: Alice earlyWithdraw deposit 2 (trước khi đáo hạn)
    // ================================================================
    const penalty = computePenalty(newPrincipal2, 300);
    // penaltyBps=300 (snapshot từ plan 1 lúc renew), KHÔNG phải 400 (plan 0 ban đầu)
    const payout = newPrincipal2 - penalty;

    const aliceBalanceBefore = await mockUSDC.balanceOf(alice.address);
    const feeReceiverBalanceBefore = await mockUSDC.balanceOf(feeReceiver.address);

    const tx = await savingCore.connect(alice).earlyWithdraw(2);

    // ================================================================
    // STEP 8: Verify alice nhận đúng principal - penalty
    // ================================================================
    expect(await mockUSDC.balanceOf(alice.address))
      .to.equal(aliceBalanceBefore + payout);

    // ================================================================
    // STEP 9: Verify feeReceiver nhận đúng penalty
    // ================================================================
    expect(await mockUSDC.balanceOf(feeReceiver.address))
      .to.equal(feeReceiverBalanceBefore + penalty);

    // Verify event: interest=0 tuyệt đối, isEarly=true
    await expect(tx)
      .to.emit(savingCore, "Withdrawn")
      .withArgs(2, alice.address, payout, 0, true);

    // Deposit 2: Withdrawn (1)
    expect((await savingCore.getDeposit(2)).status).to.equal(1);

    // ================================================================
    // STEP 10: BẢO TOÀN TỔNG CUNG
    // Tổng USDC ở TẤT CẢ địa chỉ phải bằng tổng đã mint ban đầu.
    // Không có token tự sinh ra hay biến mất qua chuỗi 3 lần chuyển đổi.
    // ================================================================
    const balAlice       = await mockUSDC.balanceOf(alice.address);
    const balBob         = await mockUSDC.balanceOf(bob.address);
    const balAttacker    = await mockUSDC.balanceOf(attacker.address);
    const balDeployer    = await mockUSDC.balanceOf(deployer.address);
    const balFeeReceiver = await mockUSDC.balanceOf(feeReceiver.address);
    const balCore        = await mockUSDC.balanceOf(await savingCore.getAddress());
    const balVault       = await mockUSDC.balanceOf(await vaultManager.getAddress());

    const totalAfter = balAlice + balBob + balAttacker + balDeployer
                     + balFeeReceiver + balCore + balVault;

    expect(totalAfter).to.equal(
      TOTAL_MINTED,
      "Bảo toàn tổng cung: không có USDC tự sinh ra hay biến mất qua toàn bộ lifecycle"
    );

    // Log breakdown để dễ kiểm tra thủ công
    console.log("\n    === USDC Balance Breakdown (end of lifecycle) ===");
    console.log(`    Alice:       ${ethers.formatUnits(balAlice, 6)} USDC`);
    console.log(`    Bob:         ${ethers.formatUnits(balBob, 6)} USDC`);
    console.log(`    Attacker:    ${ethers.formatUnits(balAttacker, 6)} USDC`);
    console.log(`    Deployer:    ${ethers.formatUnits(balDeployer, 6)} USDC`);
    console.log(`    FeeReceiver: ${ethers.formatUnits(balFeeReceiver, 6)} USDC`);
    console.log(`    SavingCore:  ${ethers.formatUnits(balCore, 6)} USDC`);
    console.log(`    Vault:       ${ethers.formatUnits(balVault, 6)} USDC`);
    console.log(`    ─────────────────────────────────────`);
    console.log(`    TOTAL:       ${ethers.formatUnits(totalAfter, 6)} USDC`);
    console.log(`    MINTED:      ${ethers.formatUnits(TOTAL_MINTED, 6)} USDC`);
    console.log(`    MATCH:       ${totalAfter === TOTAL_MINTED ? "✓ YES" : "✗ NO"}`);
  });
});
