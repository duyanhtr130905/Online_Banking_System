import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployFixture,
  DEFAULT_APR_BPS,
  DEFAULT_PENALTY_BPS,
  DEFAULT_TENOR_DAYS,
} from "./fixtures";

// ==================== FIXTURE MỞ RỘNG ====================
// Deploy + tạo default plan + alice mở 1 deposit 1000 USDC, tiết kiệm lặp setup
async function depositOpenedFixture() {
  const base = await deployFixture();
  const { savingCore, mockUSDC, alice } = base;

  await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

  const depositAmount = ethers.parseUnits("1000", 6); // 1,000,000,000
  await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
  await savingCore.connect(alice).openDeposit(0, depositAmount);

  return { ...base, depositAmount };
}

// ==================== withdrawAtMaturity ====================

describe("withdrawAtMaturity", function () {
  it("1. Happy path: rút đúng hạn, nhận principal + interest", async function () {
    const { savingCore, mockUSDC, vaultManager, alice, depositAmount } =
      await loadFixture(depositOpenedFixture);

    // Fast-forward 90 ngày
    await time.increase(DEFAULT_TENOR_DAYS * 86400);

    const aliceBalanceBefore = await mockUSDC.balanceOf(alice.address);
    const coreBalanceBefore = await mockUSDC.balanceOf(await savingCore.getAddress());
    const vaultBalanceBefore = await mockUSDC.balanceOf(await vaultManager.getAddress());

    const tx = await savingCore.connect(alice).withdrawAtMaturity(0);

    // interest đã verify ở test file 02: 9,863,013
    const interest = 9863013n;

    // Alice nhận đúng principal + interest = 1,009,863,013
    const aliceBalanceAfter = await mockUSDC.balanceOf(alice.address);
    expect(aliceBalanceAfter - aliceBalanceBefore).to.equal(depositAmount + interest);

    // Status đổi thành Withdrawn (== 1)
    const deposit = await savingCore.getDeposit(0);
    expect(deposit.status).to.equal(1);

    // Event Withdrawn: isEarly = false
    await expect(tx)
      .to.emit(savingCore, "Withdrawn")
      .withArgs(0, alice.address, depositAmount, interest, false);

    // SavingCore balance giảm đúng principal
    expect(await mockUSDC.balanceOf(await savingCore.getAddress()))
      .to.equal(coreBalanceBefore - depositAmount);

    // VaultManager balance giảm đúng interest
    expect(await mockUSDC.balanceOf(await vaultManager.getAddress()))
      .to.equal(vaultBalanceBefore - interest);
  });

  it("2. Revert nếu không phải owner", async function () {
    const { savingCore, bob } = await loadFixture(depositOpenedFixture);
    await time.increase(DEFAULT_TENOR_DAYS * 86400);

    await expect(
      savingCore.connect(bob).withdrawAtMaturity(0)
    ).to.be.revertedWith("not owner");
  });

  it("3. Revert nếu chưa đáo hạn", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);
    // Không fast-forward - rút ngay sau khi mở
    await expect(
      savingCore.connect(alice).withdrawAtMaturity(0)
    ).to.be.revertedWith("not matured yet");
  });

  it("4. BOUNDARY: rút ĐÚNG BẰNG maturityAt - thành công (test >= không phải >)", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);

    const deposit = await savingCore.getDeposit(0);
    const maturityAt = deposit.maturityAt;

    // Set timestamp block tiếp theo CHÍNH XÁC bằng maturityAt (không mine block trung gian)
    await time.setNextBlockTimestamp(maturityAt);

    // withdrawAtMaturity sẽ mine block tại đúng maturityAt
    // Contract: require(block.timestamp >= maturityAt) → maturityAt >= maturityAt → true
    await expect(
      savingCore.connect(alice).withdrawAtMaturity(0)
    ).to.not.be.reverted;
  });

  it("5. Revert double withdraw", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);
    await time.increase(DEFAULT_TENOR_DAYS * 86400);

    await savingCore.connect(alice).withdrawAtMaturity(0);

    // Lần 2: deposit đã Withdrawn, không còn Active
    await expect(
      savingCore.connect(alice).withdrawAtMaturity(0)
    ).to.be.revertedWith("not active");
  });

  it("6. ATOMICITY: vault insufficient → toàn bộ tx revert, principal cũng KHÔNG chuyển", async function () {
    const { savingCore, mockUSDC, vaultManager, alice, deployer } =
      await loadFixture(depositOpenedFixture);

    // Rút hết vault → vault = 0
    const vaultBalance = await vaultManager.getAvailableBalance();
    await vaultManager.connect(deployer).withdrawVault(vaultBalance);
    expect(await vaultManager.getAvailableBalance()).to.equal(0n);

    // Fast-forward đến maturity
    await time.increase(DEFAULT_TENOR_DAYS * 86400);

    const aliceBalanceBefore = await mockUSDC.balanceOf(alice.address);

    // withdrawAtMaturity: dòng safeTransfer principal (TRƯỚC) chạy OK,
    // nhưng vault.payInterest (SAU) revert → atomic rollback toàn bộ
    await expect(
      savingCore.connect(alice).withdrawAtMaturity(0)
    ).to.be.revertedWith("vault: insufficient funds for interest");

    // Verify atomicity: alice balance KHÔNG đổi - principal cũng không được chuyển
    // dù dòng safeTransfer(principal) nằm TRƯỚC dòng vault.payInterest trong code
    expect(await mockUSDC.balanceOf(alice.address)).to.equal(aliceBalanceBefore);
  });

  it("7. Revert nếu paused", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);
    await time.increase(DEFAULT_TENOR_DAYS * 86400);
    await savingCore.pause();

    await expect(
      savingCore.connect(alice).withdrawAtMaturity(0)
    ).to.be.reverted; // Pausable: EnforcedPause
  });
});

// ==================== earlyWithdraw ====================

describe("earlyWithdraw", function () {
  it("8. Happy path: rút sớm, nhận principal - penalty, feeReceiver nhận penalty, interest = 0", async function () {
    const { savingCore, mockUSDC, alice, feeReceiver, depositAmount } =
      await loadFixture(depositOpenedFixture);

    const aliceBalanceBefore = await mockUSDC.balanceOf(alice.address);
    const feeReceiverBalanceBefore = await mockUSDC.balanceOf(feeReceiver.address);

    // Rút sớm ngay - không fast-forward
    const tx = await savingCore.connect(alice).earlyWithdraw(0);

    const penalty = 40000000n;    // 1000e6 * 400 / 10000
    const payout = depositAmount - penalty; // 960,000,000

    // Alice nhận principal - penalty = 960,000,000
    expect(await mockUSDC.balanceOf(alice.address))
      .to.equal(aliceBalanceBefore + payout);

    // feeReceiver nhận penalty = 40,000,000
    expect(await mockUSDC.balanceOf(feeReceiver.address))
      .to.equal(feeReceiverBalanceBefore + penalty);

    // Status = Withdrawn (1)
    expect((await savingCore.getDeposit(0)).status).to.equal(1);

    // Event: interest = 0 TUYỆT ĐỐI, isEarly = true
    // Lưu ý: event emit payout (không phải principal) ở vị trí thứ 3
    await expect(tx)
      .to.emit(savingCore, "Withdrawn")
      .withArgs(0, alice.address, payout, 0, true);
  });

  it("9. Revert nếu không phải owner", async function () {
    const { savingCore, bob } = await loadFixture(depositOpenedFixture);
    await expect(
      savingCore.connect(bob).earlyWithdraw(0)
    ).to.be.revertedWith("not owner");
  });

  it("10. Revert double withdraw qua earlyWithdraw", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);
    await savingCore.connect(alice).earlyWithdraw(0);

    await expect(
      savingCore.connect(alice).earlyWithdraw(0)
    ).to.be.revertedWith("not active");
  });

  it("11. BOUNDARY: tại ĐÚNG maturityAt, earlyWithdraw PHẢI revert", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);

    const deposit = await savingCore.getDeposit(0);
    const maturityAt = deposit.maturityAt;

    // Set timestamp block tiếp theo CHÍNH XÁC bằng maturityAt
    await time.setNextBlockTimestamp(maturityAt);

    // earlyWithdraw checks: block.timestamp < maturityAt
    // Tại đúng maturityAt: maturityAt < maturityAt → false → revert
    // Ranh giới rõ ràng: >= thuộc về withdrawAtMaturity, < thuộc về earlyWithdraw
    await expect(
      savingCore.connect(alice).earlyWithdraw(0)
    ).to.be.revertedWith("already matured, use withdrawAtMaturity");
  });

  it("12. Revert nếu paused", async function () {
    const { savingCore, alice } = await loadFixture(depositOpenedFixture);
    await savingCore.pause();

    await expect(
      savingCore.connect(alice).earlyWithdraw(0)
    ).to.be.reverted; // Pausable: EnforcedPause
  });

  it("13. Edge case: penalty = 0 → alice nhận 100% principal, feeReceiver nhận 0", async function () {
    const { savingCore, mockUSDC, alice, feeReceiver } = await loadFixture(deployFixture);

    // Tạo plan đặc biệt: penaltyBps = 0 (hợp lệ vì check chỉ là < 10000)
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, 0, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    const aliceBalanceBefore = await mockUSDC.balanceOf(alice.address);
    const feeReceiverBalanceBefore = await mockUSDC.balanceOf(feeReceiver.address);

    await savingCore.connect(alice).earlyWithdraw(0);

    // Alice nhận 100% principal (không bị trừ gì)
    expect(await mockUSDC.balanceOf(alice.address))
      .to.equal(aliceBalanceBefore + depositAmount);

    // feeReceiver balance KHÔNG đổi - contract skip if(penalty > 0) block
    expect(await mockUSDC.balanceOf(feeReceiver.address))
      .to.equal(feeReceiverBalanceBefore);
  });
});
