import { ethers } from "hardhat";

async function main() {
  const MOCK_USDC_ADDRESS = "0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8";
  // TODO: Điền địa chỉ ví MetaMask dùng để quay video demo frontend
  const DEMO_WALLET = "0xBdE29b2fe1B0CD9b0d134D2690D14f787Fc8A985";

  const mockUSDC = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDRESS);
  const amount = ethers.parseUnits("10000", 6);

  const tx = await mockUSDC.mint(DEMO_WALLET, amount);
  await tx.wait();

  console.log(`Minted 10,000 mUSDC to ${DEMO_WALLET}`);
  console.log(`Tx hash: ${tx.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
