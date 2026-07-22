import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "hardhat";
import {
  deployFixture,
  DEFAULT_APR_BPS,
  DEFAULT_PENALTY_BPS,
  DEFAULT_TENOR_DAYS,
} from "./fixtures";

describe("openDeposit — happy path & validation", function () {
  it("1. Happy path: approve + openDeposit, verify tất cả fields", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);

    const savingCoreAddr = await savingCore.getAddress();
    const balanceBefore = await mockUSDC.balanceOf(savingCoreAddr);

    const tx = await savingCore.connect(alice).openDeposit(0, depositAmount);
    const receipt = await tx.wait();
    const block = await ethers.provider.getBlock(receipt!.blockNumber);
    const expectedMaturityAt = block!.timestamp + DEFAULT_TENOR_DAYS * 86400;

    // Verify deposit struct
    const deposit = await savingCore.getDeposit(0);
    expect(deposit.planId).to.equal(0);
    expect(deposit.principal).to.equal(depositAmount);
    expect(deposit.status).to.equal(0); // Status.Active
    expect(deposit.aprBpsAtOpen).to.equal(DEFAULT_APR_BPS);
    expect(deposit.penaltyBpsAtOpen).to.equal(DEFAULT_PENALTY_BPS);
    expect(deposit.maturityAt).to.equal(expectedMaturityAt);

    // Verify NFT ownership
    expect(await savingCore.ownerOf(0)).to.equal(alice.address);

    // Verify event
    await expect(tx)
      .to.emit(savingCore, "DepositOpened")
      .withArgs(0, alice.address, 0, depositAmount, expectedMaturityAt, DEFAULT_APR_BPS);

    // Verify USDC transferred to SavingCore
    expect(await mockUSDC.balanceOf(savingCoreAddr)).to.equal(balanceBefore + depositAmount);
  });

  it("2. Revert nếu plan disabled", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
    await savingCore.disablePlan(0);

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await expect(
      savingCore.connect(alice).openDeposit(0, depositAmount)
    ).to.be.revertedWith("plan is not enabled");
  });

  it("3. Revert nếu amount < minDeposit", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    const minDeposit = ethers.parseUnits("100", 6);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, minDeposit, 0);

    const tooSmall = ethers.parseUnits("50", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), tooSmall);
    await expect(
      savingCore.connect(alice).openDeposit(0, tooSmall)
    ).to.be.revertedWith("amount below minDeposit");
  });

  it("4. Revert nếu amount > maxDeposit", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    const maxDeposit = ethers.parseUnits("500", 6);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, maxDeposit);

    const tooBig = ethers.parseUnits("600", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), tooBig);
    await expect(
      savingCore.connect(alice).openDeposit(0, tooBig)
    ).to.be.revertedWith("amount above maxDeposit");
  });

  it("5. Revert nếu chưa approve đủ token", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6);
    // Approve ít hơn amount
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), ethers.parseUnits("500", 6));
    await expect(
      savingCore.connect(alice).openDeposit(0, depositAmount)
    ).to.be.reverted; // SafeERC20 revert
  });

  it("6. Revert nếu paused", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
    await savingCore.pause();

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await expect(
      savingCore.connect(alice).openDeposit(0, depositAmount)
    ).to.be.reverted; // Pausable: EnforcedPause
  });

  it("7. Mở 2 deposit liên tiếp cùng user - depositId tự tăng, NFT đúng owner", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const amount1 = ethers.parseUnits("1000", 6);
    const amount2 = ethers.parseUnits("2000", 6);
    const totalApprove = amount1 + amount2;
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), totalApprove);

    // Deposit 1
    const tx1 = await savingCore.connect(alice).openDeposit(0, amount1);
    await expect(tx1).to.emit(savingCore, "DepositOpened").withArgs(
      0, alice.address, 0, amount1, (await savingCore.getDeposit(0)).maturityAt, DEFAULT_APR_BPS
    );

    // Deposit 2
    const tx2 = await savingCore.connect(alice).openDeposit(0, amount2);
    await expect(tx2).to.emit(savingCore, "DepositOpened").withArgs(
      1, alice.address, 0, amount2, (await savingCore.getDeposit(1)).maturityAt, DEFAULT_APR_BPS
    );

    // Verify cả 2 NFT thuộc alice
    expect(await savingCore.ownerOf(0)).to.equal(alice.address);
    expect(await savingCore.ownerOf(1)).to.equal(alice.address);

    // Verify dữ liệu không bị ghi đè
    expect((await savingCore.getDeposit(0)).principal).to.equal(amount1);
    expect((await savingCore.getDeposit(1)).principal).to.equal(amount2);
  });

  it("8. REENTRANCY: MaliciousReceiver gọi earlyWithdraw trong onERC721Received - phải revert", async function () {
    const { savingCore, mockUSDC, deployer } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    // Deploy MaliciousReceiver
    const MaliciousReceiver = await ethers.getContractFactory("MaliciousReceiver");
    const malicious = await MaliciousReceiver.deploy(
      await savingCore.getAddress(),
      await mockUSDC.getAddress()
    );

    // Cấp token cho malicious contract
    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.mint(await malicious.getAddress(), depositAmount);

    // Thực hiện tấn công: malicious.attack() sẽ gọi openDeposit,
    // _safeMint callback gọi onERC721Received → earlyWithdraw (reentrancy).
    // nonReentrant modifier chặn earlyWithdraw vì openDeposit đang giữ lock,
    // revert lan ngược toàn bộ giao dịch.
    await expect(malicious.attack(0, depositAmount)).to.be.reverted;

    // Verify: không có deposit nào được tạo (giao dịch revert hoàn toàn)
    await expect(savingCore.getDeposit(0)).to.be.revertedWith("deposit does not exist");

    // Verify: tiền vẫn nằm trong malicious contract (không bị mất)
    expect(await mockUSDC.balanceOf(await malicious.getAddress())).to.equal(depositAmount);
  });
});

describe("calculateInterest & calculatePenalty — verify công thức bằng số", function () {
  it("9. calculateInterest: 1000 USDC, default plan → chính xác 9863013", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6); // 1,000,000,000
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    // Tính tay: 1000e6 * 400 * (90*86400) / (365*86400*10000)
    //         = 1,000,000,000 * 400 * 7,776,000 / 315,360,000,000
    //         = 3,110,400,000,000,000,000 / 315,360,000,000
    //         = 9,863,013 (integer division, bỏ phần dư)
    const interest = await savingCore.calculateInterest(0);
    expect(interest).to.equal(9863013n);
  });

  it("10. calculatePenalty: 1000 USDC, penaltyBps=400 → chính xác 40000000", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    // Tính tay: 1,000,000,000 * 400 / 10000 = 40,000,000
    const penalty = await savingCore.calculatePenalty(0);
    expect(penalty).to.equal(40000000n);
  });

  it("11. Precision/rounding: principal cực nhỏ (1 unit), aprBps=1, tenorDays=1 → floor đúng = 0", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);

    // Tạo plan đặc biệt: APR thấp nhất, tenor ngắn nhất
    await savingCore.createPlan(1, 1, 0, 0, 0); // tenorDays=1, aprBps=1, penalty=0

    const tinyAmount = 1n; // 0.000001 USDC - đơn vị nhỏ nhất
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), tinyAmount);
    await savingCore.connect(alice).openDeposit(0, tinyAmount);

    // Tính tay: (1 * 1 * 86400) / (365 * 86400 * 10000)
    //         = 86,400 / 315,360,000,000
    //         = 0.000000273972... → floor = 0
    // Đây là kết quả ĐÚNG (nhân trước chia sau), tử số quá nhỏ so với mẫu số.
    // Không phải bug - là giới hạn tự nhiên của integer arithmetic với số cực nhỏ.
    const interest = await savingCore.calculateInterest(0);
    const expectedJS = Math.floor((1 * 1 * 86400) / (365 * 86400 * 10000));
    expect(interest).to.equal(BigInt(expectedJS));
    expect(interest).to.equal(0n);
  });

  it("12. Nhân trước chia sau vs chia trước nhân sau: chứng minh contract dùng đúng cách", async function () {
    const { savingCore, mockUSDC, alice } = await loadFixture(deployFixture);
    await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);

    const depositAmount = ethers.parseUnits("1000", 6); // 1,000,000,000
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), depositAmount);
    await savingCore.connect(alice).openDeposit(0, depositAmount);

    // Kết quả từ contract (nhân trước chia sau - ĐÚNG)
    const contractResult = await savingCore.calculateInterest(0);

    // Mô phỏng "chia trước nhân sau" bằng JS number thường:
    // (principal / (365*86400*10000)) * aprBps * tenorSeconds
    // Với JS float:  (1000000000 / 315360000000) * 400 * 7776000
    //              = 0.003170979... * 400 * 7776000 = 9863013.698... → floor = 9863013
    // Trông giống nhau vì JS float KHÔNG truncate phép chia (giữ phần thập phân).
    const principal = Number(depositAmount);      // 1000000000
    const aprBps = DEFAULT_APR_BPS;               // 400
    const tenorSeconds = DEFAULT_TENOR_DAYS * 86400; // 7776000
    const denominator = 365 * 86400 * 10000;      // 315360000000

    const divideFirstJS = Math.floor((principal / denominator) * aprBps * tenorSeconds);

    // NHƯNG: nếu viết cùng thứ tự "chia trước nhân sau" bằng SOLIDITY INTEGER (Math.floor
    // ở mỗi bước chia — mô phỏng integer truncation), kết quả khác HOÀN TOÀN:
    //   Math.floor(1000000000 / 315360000000) = 0  (integer truncation!)
    //   0 * 400 * 7776000 = 0
    const divideFirstSoliditySimulated = Math.floor(principal / denominator) * aprBps * tenorSeconds;

    // Contract (nhân trước) = 9,863,013 — đúng
    expect(contractResult).to.equal(9863013n);

    // JS float (chia trước, giữ thập phân) = 9,863,013 — tình cờ giống vì float giữ decimals
    expect(divideFirstJS).to.equal(9863013);

    // Solidity integer (chia trước, truncate) = 0 — SAI HOÀN TOÀN, mất toàn bộ lãi!
    expect(divideFirstSoliditySimulated).to.equal(0);

    // Kết luận: nếu contract viết (principal / denominator) * aprBps * tenorSeconds
    // trong Solidity, user sẽ nhận 0 lãi thay vì ~9.86 USDC. Nhân trước là bắt buộc.
    expect(contractResult).to.not.equal(BigInt(divideFirstSoliditySimulated));
  });
});
