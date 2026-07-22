import { ethers } from "hardhat";

// Personal Variant cố định cho toàn bộ test suite - KHÔNG đổi số này ở bất kỳ đâu khác
export const GRACE_PERIOD_SECONDS = 4 * 24 * 60 * 60; // 4 ngày
export const DEFAULT_APR_BPS = 400;                    // 4.00%
export const DEFAULT_PENALTY_BPS = 400;                // 4.00%
export const DEFAULT_TENOR_DAYS = 90;

export async function deployFixture() {
  const [deployer, feeReceiver, alice, bob, attacker] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();

  const VaultManager = await ethers.getContractFactory("VaultManager");
  const vaultManager = await VaultManager.deploy(await mockUSDC.getAddress());

  const SavingCore = await ethers.getContractFactory("SavingCore");
  const savingCore = await SavingCore.deploy(
    await mockUSDC.getAddress(),
    await vaultManager.getAddress(),
    feeReceiver.address,
    GRACE_PERIOD_SECONDS
  );

  await vaultManager.setCoreAddress(await savingCore.getAddress());

  // Mint sẵn token test cho alice, bob và nạp vào vault để có tiền trả lãi
  const MILLION = ethers.parseUnits("1000000", 6);
  await mockUSDC.mint(alice.address, MILLION);
  await mockUSDC.mint(bob.address, MILLION);
  await mockUSDC.mint(attacker.address, MILLION);
  await mockUSDC.mint(deployer.address, MILLION);

  await mockUSDC.connect(deployer).approve(await vaultManager.getAddress(), MILLION);
  await vaultManager.connect(deployer).fundVault(MILLION);

  return { mockUSDC, vaultManager, savingCore, deployer, feeReceiver, alice, bob, attacker };
}
