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

// ==================== FIXTURE CỤC BỘ ====================
// Deploy + plan 0 + alice mở 1000 USDC deposit + fast-forward đến maturityAt
// (đã qua đáo hạn nhưng CHƯA qua grace period → dùng cho renewDeposit tests)
async function depositMaturedFixture() {
  const base = await deployFixture();
  const { savingCore, mockUSDC, alice } = base;

  await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

  const depositAmount = ethers.parseUnits("1000", 6); // 1,000,000,000
  await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
  await savingCore.connect(alice).openDeposit(0, depositAmount);

  const deposit = await savingCore.getDeposit(0);
  const maturityAt = deposit.maturityAt;

  // Fast-forward ĐẾN maturityAt (đã qua đáo hạn, chưa qua grace)
  await time.increaseTo(maturityAt);

  return { ...base, depositAmount, maturityAt };
}

// ==================== renewDeposit (manual) ====================

describe("renewDeposit (manual)", function () {
  it("1. Happy path: alice renew sang plan mới, verify toàn bộ", async function () {
    const { savingCore, mockUSDC, alice, depositAmount } =
      await loadFixture(depositMaturedFixture);

    // Tạo plan mới (planId=1): tenorDays=180, aprBps=500, penaltyBps=300
    await savingCore.createPlan(180, 500, 300, 0, 0);

    const coreBalanceBefore = await mockUSDC.balanceOf(await savingCore.getAddress());

    const tx = await savingCore.connect(alice).renewDeposit(0, 1);

    const interest = 9863013n;
    const newPrincipal = depositAmount + interest; // 1,009,863,013

    // Deposit MỚI (id=1): aprBpsAtOpen theo plan MỚI (500), không phải plan cũ (400)
    const newDeposit = await savingCore.getDeposit(1);
    expect(newDeposit.principal).to.equal(newPrincipal);
    expect(newDeposit.planId).to.equal(1);
    expect(newDeposit.aprBpsAtOpen).to.equal(500);
    expect(newDeposit.penaltyBpsAtOpen).to.equal(300);
    expect(newDeposit.status).to.equal(0); // Active

    // Deposit CŨ (id=0): status = ManualRenewed (2)
    expect((await savingCore.getDeposit(0)).status).to.equal(2);

    // NFT ownership
    expect(await savingCore.ownerOf(1)).to.equal(alice.address);

    // Event Renewed(oldDepositId, newDepositId, newPrincipal, newPlanId)
    await expect(tx)
      .to.emit(savingCore, "Renewed")
      .withArgs(0, 1, newPrincipal, 1);

    // SavingCore balance tăng đúng phần interest kéo từ vault về
    expect(await mockUSDC.balanceOf(await savingCore.getAddress()))
      .to.equal(coreBalanceBefore + interest);
  });

  it("2. Revert nếu không phải owner", async function () {
    const { savingCore, bob } = await loadFixture(depositMaturedFixture);
    await savingCore.createPlan(180, 500, 300, 0, 0);

    await expect(
      savingCore.connect(bob).renewDeposit(0, 1)
    ).to.be.revertedWith("not owner");
  });

  it("3. Revert nếu chưa đáo hạn", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);

    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
    await savingCore.createPlan(180, 500, 300, 0, 0); // plan 1

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    // Không fast-forward → chưa đáo hạn
    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.revertedWith("not matured yet");
  });

  it("4. Revert nếu newPlan disabled", async function () {
    const { savingCore, alice } = await loadFixture(depositMaturedFixture);
    await savingCore.createPlan(180, 500, 300, 0, 0); // plan 1
    await savingCore.disablePlan(1);

    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.revertedWith("new plan is not enabled");
  });

  it("5. Revert nếu newPrincipal < newPlan.minDeposit", async function () {
    const { savingCore, alice } = await loadFixture(depositMaturedFixture);

    // newPrincipal = ~1,009,863,013. Set minDeposit = 2000 USDC → vượt quá
    await savingCore.createPlan(180, 500, 300, ethers.parseUnits("2000", 6), 0);

    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.revertedWith("newPrincipal below minDeposit");
  });

  it("6. Revert nếu newPrincipal > newPlan.maxDeposit", async function () {
    const { savingCore, alice } = await loadFixture(depositMaturedFixture);

    // newPrincipal = ~1,009,863,013. Set maxDeposit = 1000 USDC = 1,000,000,000 < newPrincipal
    await savingCore.createPlan(180, 500, 300, 0, ethers.parseUnits("1000", 6));

    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.revertedWith("newPrincipal above maxDeposit");
  });

  it("7. Revert double renew", async function () {
    const { savingCore, alice } = await loadFixture(depositMaturedFixture);
    await savingCore.createPlan(180, 500, 300, 0, 0);

    await savingCore.connect(alice).renewDeposit(0, 1);

    // Lần 2: deposit 0 đã ManualRenewed, không còn Active
    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.revertedWith("not active");
  });

  it("8. ATOMICITY: vault insufficient → revert, deposit cũ VẪN Active (effects rollback)", async function () {
    const { savingCore, vaultManager, alice, deployer } =
      await loadFixture(depositMaturedFixture);
    await savingCore.createPlan(180, 500, 300, 0, 0);

    // Drain vault → 0
    const vaultBalance = await vaultManager.getAvailableBalance();
    await vaultManager.connect(deployer).withdrawVault(vaultBalance);
    expect(await vaultManager.getAvailableBalance()).to.equal(0n);

    // renewDeposit: code đổi status thành ManualRenewed TRƯỚC vault.payInterest,
    // nhưng vault.payInterest revert → toàn bộ effects (kể cả status change) rollback
    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.revertedWith("vault: insufficient funds for interest");

    // Verify: deposit vẫn Active, không bị kẹt ở ManualRenewed
    expect((await savingCore.getDeposit(0)).status).to.equal(0); // Active
  });

  it("9. Revert nếu paused", async function () {
    const { savingCore, alice } = await loadFixture(depositMaturedFixture);
    await savingCore.createPlan(180, 500, 300, 0, 0);
    await savingCore.pause();

    await expect(
      savingCore.connect(alice).renewDeposit(0, 1)
    ).to.be.reverted; // Pausable: EnforcedPause
  });
});

// ==================== autoRenewDeposit ====================

describe("autoRenewDeposit", function () {
  it("10. Happy path: bob (non-owner) gọi autoRenew, NFT mint cho alice, giữ plan+APR cũ", async function () {
    const { savingCore, alice, bob } = await loadFixture(depositMaturedFixture);

    // Fast-forward thêm grace period
    await time.increase(GRACE_PERIOD_SECONDS);

    const tx = await savingCore.connect(bob).autoRenewDeposit(0);

    // Giao dịch THÀNH CÔNG dù bob không phải owner
    await expect(tx).to.not.be.reverted;

    // NFT mới mint cho ALICE (owner gốc), không phải bob
    expect(await savingCore.ownerOf(1)).to.equal(alice.address);

    // planId GIỮ NGUYÊN plan cũ (0)
    const newDeposit = await savingCore.getDeposit(1);
    expect(newDeposit.planId).to.equal(0);

    // aprBpsAtOpen GIỮ NGUYÊN = 400 (đọc từ deposit cũ, KHÔNG đọc plan hiện tại)
    expect(newDeposit.aprBpsAtOpen).to.equal(DEFAULT_APR_BPS);
    expect(newDeposit.penaltyBpsAtOpen).to.equal(DEFAULT_PENALTY_BPS);

    // Deposit cũ: status = AutoRenewed (3)
    expect((await savingCore.getDeposit(0)).status).to.equal(3);
  });

  it("11. Revert nếu chưa qua grace period", async function () {
    const { savingCore, bob } = await loadFixture(depositMaturedFixture);

    // Không fast-forward thêm — mới qua maturityAt, chưa qua grace
    await expect(
      savingCore.connect(bob).autoRenewDeposit(0)
    ).to.be.revertedWith("grace period not passed yet");
  });

  it("12. BOUNDARY: ĐÚNG maturityAt + gracePeriodSeconds → thành công (test >=)", async function () {
    const { savingCore, bob, maturityAt } = await loadFixture(depositMaturedFixture);

    // Set timestamp CHÍNH XÁC tại ranh giới (không hơn không kém)
    await time.setNextBlockTimestamp(maturityAt + BigInt(GRACE_PERIOD_SECONDS));

    // Contract: block.timestamp >= maturityAt + gracePeriodSeconds
    // → (maturityAt + grace) >= (maturityAt + grace) → true
    await expect(
      savingCore.connect(bob).autoRenewDeposit(0)
    ).to.not.be.reverted;
  });

  it("13. BUSINESS RULE #4: APR gốc bảo toàn qua 2 vòng auto-renew dù admin đổi APR plan", async function () {
    const { savingCore, mockUSDC, alice, bob } = await loadFixture(deployFixture);

    // a. Admin tạo plan có APR=400
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    // b. Alice mở deposit theo plan đó
    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    // Verify ban đầu: deposit 0 có aprBpsAtOpen = 400
    expect((await savingCore.getDeposit(0)).aprBpsAtOpen).to.equal(400);

    // c. Fast-forward qua maturity + grace, auto-renew lần 1 → deposit 1
    const dep0 = await savingCore.getDeposit(0);
    await time.increaseTo(dep0.maturityAt + BigInt(GRACE_PERIOD_SECONDS));
    await savingCore.connect(bob).autoRenewDeposit(0);

    // Verify: deposit 1 vẫn giữ aprBpsAtOpen = 400 (từ deposit 0)
    const dep1 = await savingCore.getDeposit(1);
    expect(dep1.aprBpsAtOpen).to.equal(400);
    expect(dep1.planId).to.equal(0);

    // d. Admin đổi APR plan lên RẤT CAO: 999 bps
    await savingCore.updatePlan(0, 999);
    // Verify plan đã đổi
    expect((await savingCore.getPlan(0)).aprBps).to.equal(999);

    // e. Fast-forward qua deposit 1 maturity + grace, auto-renew lần 2 → deposit 2
    await time.increaseTo(dep1.maturityAt + BigInt(GRACE_PERIOD_SECONDS));
    await savingCore.connect(bob).autoRenewDeposit(1);

    // f. VERIFY QUAN TRỌNG NHẤT: deposit 2 aprBpsAtOpen VẪN LÀ 400
    //    Dù plan hiện tại có aprBps = 999, auto-renew đọc deposits[1].aprBpsAtOpen
    //    (bản thân deposits[1] đã copy từ deposits[0]) → chuỗi snapshot được bảo toàn
    //    xuyên suốt 2 vòng renew.
    const dep2 = await savingCore.getDeposit(2);
    expect(dep2.aprBpsAtOpen).to.equal(400);  // GIỮ NGUYÊN 400, KHÔNG phải 999
    expect(dep2.planId).to.equal(0);
    expect(dep2.status).to.equal(0); // Active
  });

  it("14. Disabled plan KHÔNG chặn auto-renew (khác hẳn renewDeposit)", async function () {
    const { savingCore, mockUSDC, alice, bob } = await loadFixture(deployFixture);

    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    // Admin disable plan SAU khi alice đã mở deposit
    await savingCore.disablePlan(0);

    // Fast-forward qua maturity + grace
    const dep = await savingCore.getDeposit(0);
    await time.increaseTo(dep.maturityAt + BigInt(GRACE_PERIOD_SECONDS));

    // Auto-renew PHẢI THÀNH CÔNG dù plan bị disabled
    // (autoRenewDeposit KHÔNG check plans[planId].enabled — thiết kế có chủ đích,
    //  vì auto-renew là tiếp tục thụ động, không phải cam kết mới)
    await expect(
      savingCore.connect(bob).autoRenewDeposit(0)
    ).to.not.be.reverted;

    // Verify deposit mới tạo thành công
    const newDep = await savingCore.getDeposit(1);
    expect(newDep.planId).to.equal(0);
    expect(newDep.status).to.equal(0); // Active
    expect(await savingCore.ownerOf(1)).to.equal(alice.address);
  });

  it("15. Revert double auto-renew", async function () {
    const { savingCore, bob } = await loadFixture(depositMaturedFixture);

    await time.increase(GRACE_PERIOD_SECONDS);
    await savingCore.connect(bob).autoRenewDeposit(0);

    // Deposit 0 đã AutoRenewed, không còn Active
    await expect(
      savingCore.connect(bob).autoRenewDeposit(0)
    ).to.be.revertedWith("not active");
  });

  it("16. Revert nếu paused", async function () {
    const { savingCore, bob } = await loadFixture(depositMaturedFixture);

    await time.increase(GRACE_PERIOD_SECONDS);
    await savingCore.pause();

    await expect(
      savingCore.connect(bob).autoRenewDeposit(0)
    ).to.be.reverted; // Pausable: EnforcedPause
  });

  it("17. ATOMICITY: vault insufficient → revert, deposit cũ vẫn Active", async function () {
    const { savingCore, vaultManager, bob, deployer } =
      await loadFixture(depositMaturedFixture);

    // Drain vault
    const vaultBalance = await vaultManager.getAvailableBalance();
    await vaultManager.connect(deployer).withdrawVault(vaultBalance);

    // Fast-forward qua grace
    await time.increase(GRACE_PERIOD_SECONDS);

    // autoRenewDeposit: code đổi status thành AutoRenewed TRƯỚC vault.payInterest,
    // nhưng vault.payInterest revert → toàn bộ effects rollback
    await expect(
      savingCore.connect(bob).autoRenewDeposit(0)
    ).to.be.revertedWith("vault: insufficient funds for interest");

    // Verify: deposit vẫn Active (effects rolled back bởi EVM atomic tx)
    expect((await savingCore.getDeposit(0)).status).to.equal(0); // Active
  });
});
