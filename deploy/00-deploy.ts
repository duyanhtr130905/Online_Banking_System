import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const deployFn: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  // Personal Variant: grace period 4 ngày = 4 * 86400 giây
  const GRACE_PERIOD_SECONDS = 4 * 24 * 60 * 60;

  const mockUSDC = await deploy("MockUSDC", {
    from: deployer,
    args: [],
    log: true,
  });

  const vaultManager = await deploy("VaultManager", {
    from: deployer,
    args: [mockUSDC.address],
    log: true,
  });

  const savingCore = await deploy("SavingCore", {
    from: deployer,
    args: [mockUSDC.address, vaultManager.address, deployer, GRACE_PERIOD_SECONDS],
    log: true,
  });

  // Nối dây: cho phép SavingCore gọi payInterest trên VaultManager
  const vaultManagerContract = await hre.ethers.getContractAt("VaultManager", vaultManager.address);
  const tx = await vaultManagerContract.setCoreAddress(savingCore.address);
  await tx.wait();

  console.log("Deployed MockUSDC:", mockUSDC.address);
  console.log("Deployed VaultManager:", vaultManager.address);
  console.log("Deployed SavingCore:", savingCore.address);
  console.log("VaultManager.coreAddress set to SavingCore");

  // 5. Tạo Default Plan theo Personal Variant (90 ngày / 400 bps APR / 400 bps penalty)
  const savingCoreContract = await hre.ethers.getContractAt("SavingCore", savingCore.address);

  // Kiểm tra plan 0 đã tồn tại chưa (tránh tạo trùng nếu script chạy lại lần 2 trên cùng network)
  let planExists = false;
  try {
    await savingCoreContract.getPlan(0);
    planExists = true;
  } catch {
    planExists = false;
  }

  if (!planExists) {
    const tenorDays = 90;
    const aprBps = 400;
    const penaltyBps = 400;
    const minDeposit = 0;
    const maxDeposit = 0;
    const txPlan = await savingCoreContract.createPlan(tenorDays, aprBps, penaltyBps, minDeposit, maxDeposit);
    await txPlan.wait();
    console.log("Default Plan created: 90 days / 400bps APR / 400bps penalty");
  } else {
    console.log("Default Plan already exists, skip creating");
  }
};

export default deployFn;
deployFn.tags = ["all"];
