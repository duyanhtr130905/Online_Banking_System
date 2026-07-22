import { expect } from "chai";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployFixture,
  DEFAULT_APR_BPS,
  DEFAULT_PENALTY_BPS,
  DEFAULT_TENOR_DAYS,
  GRACE_PERIOD_SECONDS,
} from "./fixtures";

// =============================================================================
// GHI CHÚ VỀ NHÁNH nonReentrant KHÔNG ĐƯỢC COVER CHỦ ĐỘNG
// =============================================================================
// 4 nhánh false-branch của nonReentrant tại openDeposit, withdrawAtMaturity,
// renewDeposit, autoRenewDeposit (dòng 291, 401, 502, 599) CHỦ ĐỘNG không viết
// test riêng. Lý do: nonReentrant dùng 1 biến _status DUY NHẤT dùng chung cho
// toàn contract (ReentrancyGuard của OpenZeppelin), không phải 5 khóa độc lập.
// Test #8 (MaliciousReceiver) đã chứng minh cơ chế khóa này hoạt động đúng
// trong 1 tình huống thực tế (reenter từ openDeposit vào earlyWithdraw) - đủ
// bằng chứng cho toàn bộ cơ chế dùng chung, vì bản chất kỹ thuật giống hệt
// nhau ở cả 5 điểm dùng. Viết thêm 4 kịch bản tấn công riêng cho từng hàm
// chỉ lặp lại cùng 1 bằng chứng, không phát hiện thêm rủi ro mới.
// =============================================================================

describe("SavingCore — Plan & Admin Management", function () {
  // ==================== createPlan ====================

  describe("createPlan", function () {
    it("1. Happy path: tạo plan, emit PlanCreated, getPlan trả đúng toàn bộ field", async function () {
      const { savingCore } = await loadFixture(deployFixture);

      const tx = await savingCore.createPlan(
        DEFAULT_TENOR_DAYS,
        DEFAULT_APR_BPS,
        DEFAULT_PENALTY_BPS,
        0, // minDeposit
        0  // maxDeposit
      );

      await expect(tx)
        .to.emit(savingCore, "PlanCreated")
        .withArgs(0, DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS);

      const plan = await savingCore.getPlan(0);
      expect(plan.tenorDays).to.equal(DEFAULT_TENOR_DAYS);
      expect(plan.aprBps).to.equal(DEFAULT_APR_BPS);
      expect(plan.earlyWithdrawPenaltyBps).to.equal(DEFAULT_PENALTY_BPS);
      expect(plan.minDeposit).to.equal(0);
      expect(plan.maxDeposit).to.equal(0);
      expect(plan.enabled).to.equal(true);
    });

    it("2. Revert nếu không có ADMIN_ROLE", async function () {
      const { savingCore, alice } = await loadFixture(deployFixture);
      await expect(
        savingCore.connect(alice).createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0)
      ).to.be.reverted;
    });

    it("3. Revert nếu aprBps == 0", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(
        savingCore.createPlan(DEFAULT_TENOR_DAYS, 0, DEFAULT_PENALTY_BPS, 0, 0)
      ).to.be.revertedWith("apr out of range");
    });

    it("4. Revert nếu aprBps >= 10000", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(
        savingCore.createPlan(DEFAULT_TENOR_DAYS, 10000, DEFAULT_PENALTY_BPS, 0, 0)
      ).to.be.revertedWith("apr out of range");
    });

    it("5. Revert nếu earlyWithdrawPenaltyBps >= 10000", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(
        savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, 10000, 0, 0)
      ).to.be.revertedWith("penalty out of range");
    });

    it("6. Revert nếu tenorDays == 0", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(
        savingCore.createPlan(0, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0)
      ).to.be.revertedWith("tenor must be > 0");
    });

    it("7. Revert nếu maxDeposit > 0 và maxDeposit < minDeposit", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      const minDeposit = ethers.parseUnits("100", 6);
      const maxDeposit = ethers.parseUnits("50", 6); // < minDeposit
      await expect(
        savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, minDeposit, maxDeposit)
      ).to.be.revertedWith("maxDeposit < minDeposit");
    });

    it("8. Tạo 2 plan liên tiếp - planId tự tăng 0 rồi 1", async function () {
      const { savingCore } = await loadFixture(deployFixture);

      const tx0 = await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      await expect(tx0).to.emit(savingCore, "PlanCreated").withArgs(0, DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS);

      const tx1 = await savingCore.createPlan(60, 500, 200, 0, 0);
      await expect(tx1).to.emit(savingCore, "PlanCreated").withArgs(1, 60, 500);

      // Verify cả 2 plan tồn tại với dữ liệu đúng
      const plan0 = await savingCore.getPlan(0);
      expect(plan0.aprBps).to.equal(DEFAULT_APR_BPS);

      const plan1 = await savingCore.getPlan(1);
      expect(plan1.aprBps).to.equal(500);
    });
  });

  // ==================== updatePlan ====================

  describe("updatePlan", function () {
    it("9. Happy path: đổi aprBps, verify getPlan và emit PlanUpdated", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

      const tx = await savingCore.updatePlan(0, 800);
      await expect(tx).to.emit(savingCore, "PlanUpdated").withArgs(0, 800);

      const plan = await savingCore.getPlan(0);
      expect(plan.aprBps).to.equal(800);
    });

    it("10. Revert nếu không phải admin", async function () {
      const { savingCore, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

      await expect(savingCore.connect(alice).updatePlan(0, 800)).to.be.reverted;
    });

    it("11. Revert nếu planId không tồn tại", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(savingCore.updatePlan(999, 800)).to.be.revertedWith("plan does not exist");
    });

    it("12. Revert nếu newAprBps == 0 hoặc >= 10000", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

      await expect(savingCore.updatePlan(0, 0)).to.be.revertedWith("apr out of range");
      await expect(savingCore.updatePlan(0, 10000)).to.be.revertedWith("apr out of range");
    });

    it("13. INVARIANT #1: updatePlan không ảnh hưởng aprBpsAtOpen của deposit đã mở", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);

      // Tạo plan với APR = 400 bps
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

      // Alice mở deposit theo plan này
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(alice).openDeposit(0, depositAmount);

      // Admin đổi APR plan xuống 100 bps (khác hẳn giá trị ban đầu)
      await savingCore.updatePlan(0, 100);

      // Verify: plan đã đổi
      const plan = await savingCore.getPlan(0);
      expect(plan.aprBps).to.equal(100);

      // Verify: deposit cũ của alice VẪN GIỮ aprBpsAtOpen = 400 (snapshot không bị vỡ)
      const deposit = await savingCore.getDeposit(0);
      expect(deposit.aprBpsAtOpen).to.equal(DEFAULT_APR_BPS); // 400, KHÔNG phải 100
    });
  });

  // ==================== enablePlan / disablePlan ====================

  describe("enablePlan / disablePlan", function () {
    it("14. disablePlan rồi openDeposit - phải revert", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      await savingCore.disablePlan(0);

      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await expect(
        savingCore.connect(alice).openDeposit(0, depositAmount)
      ).to.be.revertedWith("plan is not enabled");
    });

    it("15. enablePlan lại - openDeposit thành công", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      await savingCore.disablePlan(0);
      await savingCore.enablePlan(0);

      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await expect(savingCore.connect(alice).openDeposit(0, depositAmount)).to.not.be.reverted;
    });

    it("16. Cả 2 hàm revert nếu không phải admin", async function () {
      const { savingCore, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

      await expect(savingCore.connect(alice).disablePlan(0)).to.be.reverted;
      await expect(savingCore.connect(alice).enablePlan(0)).to.be.reverted;
    });

    it("17. Cả 2 hàm revert nếu planId không tồn tại", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(savingCore.disablePlan(999)).to.be.revertedWith("plan does not exist");
      await expect(savingCore.enablePlan(999)).to.be.revertedWith("plan does not exist");
    });

    it("18. disablePlan KHÔNG ảnh hưởng deposit đã active", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

      // Alice mở deposit TRƯỚC khi disable
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(alice).openDeposit(0, depositAmount);

      // Admin disable plan SAU KHI alice đã mở deposit
      await savingCore.disablePlan(0);

      // Verify: deposit cũ vẫn Active bình thường
      const deposit = await savingCore.getDeposit(0);
      expect(deposit.status).to.equal(0); // Status.Active == 0
    });
  });

  // ==================== setFeeReceiver ====================

  describe("setFeeReceiver", function () {
    it("19. Happy path: đổi feeReceiver thành công", async function () {
      const { savingCore, bob } = await loadFixture(deployFixture);
      await savingCore.setFeeReceiver(bob.address);
      expect(await savingCore.feeReceiver()).to.equal(bob.address);
    });

    it("20. Revert nếu không phải admin", async function () {
      const { savingCore, alice, bob } = await loadFixture(deployFixture);
      await expect(savingCore.connect(alice).setFeeReceiver(bob.address)).to.be.reverted;
    });

    it("21. Revert nếu address(0)", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(
        savingCore.setFeeReceiver(ethers.ZeroAddress)
      ).to.be.revertedWith("fee receiver is zero");
    });
  });

  // ==================== SavingCore pause / unpause ====================

  describe("SavingCore pause / unpause", function () {
    it("22. Revert nếu không phải admin", async function () {
      const { savingCore, alice } = await loadFixture(deployFixture);
      await expect(savingCore.connect(alice).pause()).to.be.reverted;
      await expect(savingCore.connect(alice).unpause()).to.be.reverted;
    });

    it("23. Sau khi pause - openDeposit phải revert", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      await savingCore.pause();

      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await expect(
        savingCore.connect(alice).openDeposit(0, depositAmount)
      ).to.be.reverted; // Pausable: EnforcedPause
    });

    it("24. unpause - openDeposit lại thành công", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      await savingCore.pause();
      await savingCore.unpause();

      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await expect(savingCore.connect(alice).openDeposit(0, depositAmount)).to.not.be.reverted;
    });
  });

  // ==================== setGracePeriod (bổ sung) ====================

  describe("setGracePeriod", function () {
    it("37. Happy path: admin gọi setGracePeriod(7 ngày), getter gracePeriodSeconds trả về đúng giá trị mới", async function () {
      const { savingCore } = await loadFixture(deployFixture);

      const newGrace = 7n * 86400n; // 7 ngày tính bằng giây
      await savingCore.setGracePeriod(newGrace);

      // Verify getter trả về giá trị mới
      expect(await savingCore.gracePeriodSeconds()).to.equal(newGrace);
    });

    it("38. QUAN TRỌNG: setGracePeriod thực sự ảnh hưởng logic — tại +4 ngày (grace cũ) autoRenew revert, tại +7 ngày thành công", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
      const { time } = await import("@nomicfoundation/hardhat-network-helpers");

      // Đổi grace period từ 4 ngày sang 7 ngày
      const SEVEN_DAYS = 7 * 24 * 60 * 60;
      await savingCore.setGracePeriod(SEVEN_DAYS);

      // Tạo plan và alice mở deposit
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(alice).openDeposit(0, depositAmount);

      const dep = await savingCore.getDeposit(0);
      const maturityAt = Number(dep.maturityAt);

      // Fast-forward đến maturityAt + 4 ngày (grace period CŨ) — vẫn trong khoảng grace 7 ngày
      await time.increaseTo(maturityAt + 4 * 24 * 60 * 60);

      // PHẢI REVERT vì grace period hiện tại là 7 ngày, chưa đủ
      await expect(
        savingCore.autoRenewDeposit(0)
      ).to.be.revertedWith("grace period not passed yet");

      // Fast-forward thêm vượt qua ngưỡng 7 ngày (thêm 1 giây sau maturityAt + 7 ngày)
      await time.increaseTo(maturityAt + SEVEN_DAYS + 1);

      // PHẢI THÀNH CÔNG — chứng minh setGracePeriod ảnh hưởng đúng logic
      await expect(savingCore.autoRenewDeposit(0)).to.not.be.reverted;
    });

    it("39. Revert nếu không phải admin gọi setGracePeriod", async function () {
      const { savingCore, alice } = await loadFixture(deployFixture);
      await expect(
        savingCore.connect(alice).setGracePeriod(7 * 86400)
      ).to.be.reverted;
    });

    it("40. Revert nếu newGracePeriodSeconds == 0", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      await expect(
        savingCore.setGracePeriod(0)
      ).to.be.revertedWith("grace period must be > 0");
    });
  });

  // ==================== supportsInterface (bổ sung) ====================

  describe("supportsInterface", function () {
    it("43. Trả về true với IERC721 interface ID (0x80ac58cd), false với ID không hợp lệ (0xffffffff)", async function () {
      const { savingCore } = await loadFixture(deployFixture);

      // IERC721 interface ID chuẩn ERC165
      const ERC721_INTERFACE_ID = "0x80ac58cd";
      expect(await savingCore.supportsInterface(ERC721_INTERFACE_ID)).to.equal(true);

      // ID ngẫu nhiên không thuộc bất kỳ interface nào
      const INVALID_INTERFACE_ID = "0xffffffff";
      expect(await savingCore.supportsInterface(INVALID_INTERFACE_ID)).to.equal(false);
    });
  });

  // ==================== Constructor validation (Group A — dòng 127-130) ====================

  describe("SavingCore constructor validation", function () {
    it("44. Revert nếu _depositToken = address(0)", async function () {
      const { vaultManager, feeReceiver } = await loadFixture(deployFixture);
      const SavingCore = await ethers.getContractFactory("SavingCore");
      await expect(
        SavingCore.deploy(
          ethers.ZeroAddress,           // _depositToken = zero
          await vaultManager.getAddress(),
          feeReceiver.address,
          GRACE_PERIOD_SECONDS
        )
      ).to.be.revertedWith("token address is zero");
    });

    it("45. Revert nếu _vault = address(0)", async function () {
      const { mockUSDC, feeReceiver } = await loadFixture(deployFixture);
      const SavingCore = await ethers.getContractFactory("SavingCore");
      await expect(
        SavingCore.deploy(
          await mockUSDC.getAddress(),
          ethers.ZeroAddress,           // _vault = zero
          feeReceiver.address,
          GRACE_PERIOD_SECONDS
        )
      ).to.be.revertedWith("vault address is zero");
    });

    it("46. Revert nếu _feeReceiver = address(0)", async function () {
      const { mockUSDC, vaultManager } = await loadFixture(deployFixture);
      const SavingCore = await ethers.getContractFactory("SavingCore");
      await expect(
        SavingCore.deploy(
          await mockUSDC.getAddress(),
          await vaultManager.getAddress(),
          ethers.ZeroAddress,           // _feeReceiver = zero
          GRACE_PERIOD_SECONDS
        )
      ).to.be.revertedWith("fee receiver is zero");
    });

    it("47. Revert nếu _gracePeriodSeconds = 0", async function () {
      const { mockUSDC, vaultManager, feeReceiver } = await loadFixture(deployFixture);
      const SavingCore = await ethers.getContractFactory("SavingCore");
      await expect(
        SavingCore.deploy(
          await mockUSDC.getAddress(),
          await vaultManager.getAddress(),
          feeReceiver.address,
          0                             // _gracePeriodSeconds = 0
        )
      ).to.be.revertedWith("grace period must be > 0");
    });
  });

  // ==================== getPlan invalid ID (Group B — dòng 243) ====================

  describe("getPlan — invalid planId", function () {
    it("48. getPlan(999) revert 'plan does not exist' (planId chưa từng tạo)", async function () {
      const { savingCore } = await loadFixture(deployFixture);
      // Không tạo plan nào cả — gọi thẳng với planId = 999
      await expect(
        savingCore.getPlan(999)
      ).to.be.revertedWith("plan does not exist");
    });
  });

  // ==================== maxDeposit boundary PASS path (Group D — dòng 304, 537) ====================

  describe("maxDeposit boundary — pass path (dòng 304 & 537)", function () {
    it("49. openDeposit với amount == maxDeposit (boundary <=) phải THÀNH CÔNG — cover cond-expr dòng 304", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);

      // Tạo plan có maxDeposit = 2000 USDC (maxDeposit != 0 → bắt buộc evaluate operand phải của ||)
      const MAX_DEPOSIT = ethers.parseUnits("2000", 6);
      await savingCore.createPlan(
        DEFAULT_TENOR_DAYS,
        DEFAULT_APR_BPS,
        DEFAULT_PENALTY_BPS,
        0,           // minDeposit
        MAX_DEPOSIT  // maxDeposit = 2000e6
      );

      // Deposit ĐÚNG BẰNG maxDeposit — test toán tử <= (không phải <)
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), MAX_DEPOSIT);
      await expect(
        savingCore.connect(alice).openDeposit(0, MAX_DEPOSIT)
      ).to.not.be.reverted;

      // Verify deposit đã ghi đúng
      const dep = await savingCore.getDeposit(0);
      expect(dep.principal).to.equal(MAX_DEPOSIT);
    });

    it("50. renewDeposit vào plan có maxDeposit > 0 với newPrincipal == maxDeposit phải THÀNH CÔNG — cover cond-expr dòng 537", async function () {
      const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);

      // Plan 0: không giới hạn, alice mở deposit ban đầu
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      const principal = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), principal);
      await savingCore.connect(alice).openDeposit(0, principal);

      // Tính trước interest sẽ nhận được khi renew (dùng công thức simple interest)
      // interest = principal * aprBps * tenorSeconds / (365 days * 10000)
      const tenorSeconds = BigInt(DEFAULT_TENOR_DAYS) * 86400n;
      const interest = (principal * BigInt(DEFAULT_APR_BPS) * tenorSeconds) / (365n * 86400n * 10000n);
      const newPrincipal = principal + interest; // vốn mới sau khi gộp lãi

      // Plan 1: maxDeposit = ĐÚNG BẰNG newPrincipal → test boundary <= trong renewDeposit (dòng 537)
      await savingCore.createPlan(
        DEFAULT_TENOR_DAYS,
        DEFAULT_APR_BPS,
        DEFAULT_PENALTY_BPS,
        0,            // minDeposit
        newPrincipal  // maxDeposit == newPrincipal (boundary exact)
      );

      // Fast-forward đến sau khi đáo hạn
      const dep = await savingCore.getDeposit(0);
      await time.increaseTo(Number(dep.maturityAt) + 1);

      // renewDeposit vào plan 1 với newPrincipal == maxDeposit — PHẢI THÀNH CÔNG
      await expect(
        savingCore.connect(alice).renewDeposit(0, 1)
      ).to.not.be.reverted;

      // Verify deposit mới có đúng principal
      const newDep = await savingCore.getDeposit(1);
      expect(newDep.principal).to.equal(newPrincipal);
    });
  });
});

// ==================== VaultManager Tests ====================

describe("VaultManager — Admin & Access Control", function () {
  // ==================== setCoreAddress ====================

  describe("setCoreAddress", function () {
    it("25. Revert nếu không phải admin", async function () {
      const { vaultManager, alice, savingCore } = await loadFixture(deployFixture);
      await expect(
        vaultManager.connect(alice).setCoreAddress(await savingCore.getAddress())
      ).to.be.reverted;
    });

    it("26. Revert nếu address(0)", async function () {
      const { vaultManager } = await loadFixture(deployFixture);
      await expect(
        vaultManager.setCoreAddress(ethers.ZeroAddress)
      ).to.be.revertedWith("core address is zero");
    });
  });

  // ==================== fundVault ====================

  describe("fundVault", function () {
    it("27. Happy path: fundVault tăng balance, emit VaultFunded", async function () {
      const { vaultManager, mockUSDC, deployer } = await loadFixture(deployFixture);

      const fundAmount = ethers.parseUnits("500000", 6);
      // deployer đã có token từ fixture, và fixture đã fund 1M - giờ fund thêm
      await mockUSDC.mint(deployer.address, fundAmount);
      await mockUSDC.connect(deployer).approve(await vaultManager.getAddress(), fundAmount);

      const balanceBefore = await vaultManager.getAvailableBalance();
      const tx = await vaultManager.connect(deployer).fundVault(fundAmount);

      await expect(tx).to.emit(vaultManager, "VaultFunded").withArgs(deployer.address, fundAmount);
      expect(await vaultManager.getAvailableBalance()).to.equal(balanceBefore + fundAmount);
    });

    it("28. Revert nếu không phải admin (dù alice có token và đã approve)", async function () {
      const { vaultManager, mockUSDC, alice } = await loadFixture(deployFixture);

      const fundAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await vaultManager.getAddress(), fundAmount);

      await expect(vaultManager.connect(alice).fundVault(fundAmount)).to.be.reverted;
    });

    it("29. Revert nếu amount == 0", async function () {
      const { vaultManager } = await loadFixture(deployFixture);
      await expect(vaultManager.fundVault(0)).to.be.revertedWith("amount must be > 0");
    });
  });

  // ==================== withdrawVault ====================

  describe("withdrawVault", function () {
    it("30. Happy path: admin rút, balance giảm, emit VaultWithdrawn", async function () {
      const { vaultManager, deployer } = await loadFixture(deployFixture);

      const withdrawAmount = ethers.parseUnits("100000", 6);
      const balanceBefore = await vaultManager.getAvailableBalance();

      const tx = await vaultManager.connect(deployer).withdrawVault(withdrawAmount);

      await expect(tx).to.emit(vaultManager, "VaultWithdrawn").withArgs(deployer.address, withdrawAmount);
      expect(await vaultManager.getAvailableBalance()).to.equal(balanceBefore - withdrawAmount);
    });

    it("31. Revert nếu không phải admin", async function () {
      const { vaultManager, alice } = await loadFixture(deployFixture);
      await expect(
        vaultManager.connect(alice).withdrawVault(ethers.parseUnits("100", 6))
      ).to.be.reverted;
    });

    it("32. Revert nếu amount > balance hiện có", async function () {
      const { vaultManager } = await loadFixture(deployFixture);
      const balance = await vaultManager.getAvailableBalance();
      await expect(
        vaultManager.withdrawVault(balance + 1n)
      ).to.be.revertedWith("insufficient vault balance");
    });
  });

  // ==================== payInterest (access control) ====================

  describe("payInterest — access control", function () {
    it("33. Revert khi admin (deployer) gọi trực tiếp - onlyCore chặn", async function () {
      const { vaultManager, deployer, alice } = await loadFixture(deployFixture);
      await expect(
        vaultManager.connect(deployer).payInterest(alice.address, 100)
      ).to.be.revertedWith("VaultManager: caller is not SavingCore");
    });

    it("34. Revert khi user thường (alice) gọi trực tiếp", async function () {
      const { vaultManager, alice } = await loadFixture(deployFixture);
      await expect(
        vaultManager.connect(alice).payInterest(alice.address, 100)
      ).to.be.revertedWith("VaultManager: caller is not SavingCore");
    });
  });

  // ==================== VaultManager pause / unpause ====================

  describe("VaultManager pause / unpause", function () {
    it("36. Revert nếu không phải admin", async function () {
      const { vaultManager, alice } = await loadFixture(deployFixture);
      await expect(vaultManager.connect(alice).pause()).to.be.reverted;
      await expect(vaultManager.connect(alice).unpause()).to.be.reverted;
    });

    it("41. Happy path pause: VaultManager paused → withdrawAtMaturity trên SavingCore revert dù SavingCore KHÔNG bị pause (cầu dao độc lập)", async function () {
      const { savingCore, vaultManager, mockUSDC, alice } = await loadFixture(deployFixture);
      const { time } = await import("@nomicfoundation/hardhat-network-helpers");

      // Setup: tạo plan và alice mở deposit
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(alice).openDeposit(0, depositAmount);

      // Fast-forward đến sau khi đáo hạn
      const dep = await savingCore.getDeposit(0);
      await time.increaseTo(Number(dep.maturityAt) + 1);

      // Pause CHỈ VaultManager — SavingCore KHÔNG bị pause
      await vaultManager.pause();

      // Verify SavingCore không bị pause: đọc state thành công bình thường
      expect(await savingCore.gracePeriodSeconds()).to.be.gt(0);

      // withdrawAtMaturity PHẢI REVERT vì vault.payInterest() bị chặn bởi whenNotPaused của VaultManager
      // Chứng minh đây là cầu dao ĐỘC LẬP — chỉ pause vault là đủ để block toàn bộ thanh toán lãi
      await expect(
        savingCore.connect(alice).withdrawAtMaturity(0)
      ).to.be.reverted; // EnforcedPause từ VaultManager
    });

    it("42. Happy path unpause: sau khi unpause VaultManager, withdrawAtMaturity thành công bình thường", async function () {
      const { savingCore, vaultManager, mockUSDC, alice } = await loadFixture(deployFixture);
      const { time } = await import("@nomicfoundation/hardhat-network-helpers");

      // Setup: tạo plan và alice mở deposit
      await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
      const depositAmount = ethers.parseUnits("1000", 6);
      await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
      await savingCore.connect(alice).openDeposit(0, depositAmount);

      // Fast-forward đến sau khi đáo hạn
      const dep = await savingCore.getDeposit(0);
      await time.increaseTo(Number(dep.maturityAt) + 1);

      // Pause rồi unpause VaultManager
      await vaultManager.pause();
      await vaultManager.unpause();

      // Sau khi unpause, withdrawAtMaturity PHẢI THÀNH CÔNG
      await expect(savingCore.connect(alice).withdrawAtMaturity(0)).to.not.be.reverted;
    });
  });
});
