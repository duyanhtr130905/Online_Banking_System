import { expect } from "chai";
import { deployments, ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import {
  BotState,
  getPollIntervalMs,
  loadSavingCoreFromDeployment,
  scanAndRenewOnce,
} from "../scripts/autoRenewBot";
import {
  DEFAULT_APR_BPS,
  DEFAULT_PENALTY_BPS,
  DEFAULT_TENOR_DAYS,
  deployFixture,
  GRACE_PERIOD_SECONDS,
} from "./fixtures";

function silentLog() {
  // Bot log output is tested through state and chain results, keeping Hardhat test output readable.
}

async function openDepositForBot() {
  const base = await deployFixture();
  const { savingCore, mockUSDC, alice } = base;
  const amount = ethers.parseUnits("1000", 6);

  await savingCore.createPlan(DEFAULT_TENOR_DAYS, DEFAULT_APR_BPS, DEFAULT_PENALTY_BPS, 0, 0);
  await mockUSDC.connect(alice).approve(await savingCore.getAddress(), amount);
  await savingCore.connect(alice).openDeposit(0, amount);

  const deploymentReceipt = await savingCore.deploymentTransaction()!.wait();
  const state: BotState = {
    candidateIds: new Set(),
    processingIds: new Set(),
    lastScannedBlock: Number(deploymentReceipt!.blockNumber) - 1,
  };
  return { ...base, state };
}

describe("autoRenewBot", function () {
  it("uses a 10-second polling interval by default", function () {
    expect(getPollIntervalMs("")).to.equal(10_000);
  });

  it("uses the current SavingCore hardhat-deploy deployment", async function () {
    await deployments.fixture(["all"]);
    const [botSigner] = await ethers.getSigners();
    const deployment = await deployments.get("SavingCore");
    const { savingCore } = await loadSavingCoreFromDeployment(botSigner);

    expect(await savingCore.getAddress()).to.equal(deployment.address);
    expect(await ethers.provider.getCode(deployment.address)).to.not.equal("0x");
  });

  it("keeps an Active deposit before grace without sending a transaction", async function () {
    const { savingCore, vaultManager, state } = await openDepositForBot();

    const result = await scanAndRenewOnce({ savingCore, vaultManager, state, log: silentLog });

    expect(result.renewedIds).to.equal(0);
    expect((await savingCore.getDeposit(0)).status).to.equal(0);
    expect(state.candidateIds).to.deep.equal(new Set([0n]));
  });

  it("renews exactly at the grace boundary through a non-owner and tracks the Renewed deposit", async function () {
    const { savingCore, vaultManager, alice, bob, state } = await openDepositForBot();
    const deposit = await savingCore.getDeposit(0);
    await time.increaseTo(deposit.maturityAt + BigInt(GRACE_PERIOD_SECONDS));

    const botCore = savingCore.connect(bob);
    const result = await scanAndRenewOnce({ savingCore: botCore, vaultManager: vaultManager.connect(bob), state, log: silentLog });

    expect(result.renewedIds).to.equal(1);
    expect((await savingCore.getDeposit(0)).status).to.equal(3);
    expect(await savingCore.ownerOf(1)).to.equal(alice.address);
    expect(state.candidateIds.has(0n)).to.equal(false);
    expect(state.candidateIds.has(1n)).to.equal(true);

    // A second poll does not submit the same renewal again; deposit #1 is not mature yet.
    const secondResult = await scanAndRenewOnce({
      savingCore: botCore,
      vaultManager: vaultManager.connect(bob),
      state,
      log: silentLog,
    });
    expect(secondResult.renewedIds).to.equal(0);
    expect((await savingCore.getDeposit(1)).status).to.equal(0);
  });

  it("skips insufficient vault liquidity and retries successfully on a later poll", async function () {
    const { savingCore, vaultManager, mockUSDC, deployer, bob, state } = await openDepositForBot();
    const deposit = await savingCore.getDeposit(0);
    await time.increaseTo(deposit.maturityAt + BigInt(GRACE_PERIOD_SECONDS));

    const vaultBalance = await vaultManager.getAvailableBalance();
    await vaultManager.connect(deployer).withdrawVault(vaultBalance);
    const botCore = savingCore.connect(bob);
    const botVault = vaultManager.connect(bob);

    const skipped = await scanAndRenewOnce({ savingCore: botCore, vaultManager: botVault, state, log: silentLog });
    expect(skipped.renewedIds).to.equal(0);
    expect((await savingCore.getDeposit(0)).status).to.equal(0);
    expect(state.candidateIds.has(0n)).to.equal(true);

    const interest = await savingCore.calculateInterest(0);
    await mockUSDC.connect(deployer).approve(await vaultManager.getAddress(), interest);
    await vaultManager.connect(deployer).fundVault(interest);

    const retried = await scanAndRenewOnce({ savingCore: botCore, vaultManager: botVault, state, log: silentLog });
    expect(retried.renewedIds).to.equal(1);
    expect((await savingCore.getDeposit(0)).status).to.equal(3);
  });

  it("removes a deposit handled manually and discovers its Renewed replacement", async function () {
    const { savingCore, vaultManager, alice, state } = await openDepositForBot();
    const deposit = await savingCore.getDeposit(0);
    await time.increaseTo(deposit.maturityAt);
    await savingCore.connect(alice).renewDeposit(0, 0);

    const result = await scanAndRenewOnce({ savingCore, vaultManager, state, log: silentLog });

    expect(result.renewedIds).to.equal(0);
    expect((await savingCore.getDeposit(0)).status).to.equal(2);
    expect(state.candidateIds.has(0n)).to.equal(false);
    expect(state.candidateIds.has(1n)).to.equal(true);
  });
});
