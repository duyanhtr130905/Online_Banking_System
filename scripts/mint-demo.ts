import { ethers } from "hardhat";

const MOCK_USDC_ADDRESS = "0x80ac50FE538D20b0D260f0Fb3DD6733d1ddC65c8";
const TEST_ACCOUNTS = [
  "0xAc3D3fc347B5BA85243730280eE54D19795B7C47",
  "0x966cC6ed4654083c07B2A9D8Eef42cbC117cA7Cc",
];
const MINT_AMOUNT = ethers.parseUnits("10000", 6);

async function main() {
  if (!process.env.TESTNET_PRIVATE_KEY) {
    throw new Error("Thiếu TESTNET_PRIVATE_KEY trong file .env.");
  }
  if (!ethers.isAddress(MOCK_USDC_ADDRESS)) {
    throw new Error("Địa chỉ MockUSDC không hợp lệ.");
  }

  const mockUSDC = await ethers.getContractAt("MockUSDC", MOCK_USDC_ADDRESS);

  for (const account of TEST_ACCOUNTS) {
    if (!ethers.isAddress(account)) {
      throw new Error(`Địa chỉ ví không hợp lệ: ${account}`);
    }

    const recipient = ethers.getAddress(account);
    const balanceBefore = await mockUSDC.balanceOf(recipient);
    console.log(`\nVí: ${recipient}`);
    console.log(`Số dư trước: ${ethers.formatUnits(balanceBefore, 6)} mUSDC`);

    // Mint tuần tự và chờ xác nhận để số dư sau phản ánh đúng từng giao dịch Sepolia.
    const tx = await mockUSDC.mint(recipient, MINT_AMOUNT);
    console.log(`Tx hash: ${tx.hash}`);
    await tx.wait();

    const balanceAfter = await mockUSDC.balanceOf(recipient);
    console.log(`Số dư sau: ${ethers.formatUnits(balanceAfter, 6)} mUSDC`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
