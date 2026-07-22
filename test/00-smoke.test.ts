import { expect } from "chai";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { deployFixture } from "./fixtures";

describe("Smoke test - deployment fixture", function () {
  it("deploys all 3 contracts and wires VaultManager.coreAddress correctly", async function () {
    const { mockUSDC, vaultManager, savingCore } = await loadFixture(deployFixture);
    expect(await vaultManager.coreAddress()).to.equal(await savingCore.getAddress());
    expect(await mockUSDC.decimals()).to.equal(6);
  });
});
