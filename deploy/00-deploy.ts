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
};

export default deployFn;
deployFn.tags = ["all"];
