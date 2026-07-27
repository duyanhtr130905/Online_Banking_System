import { ethers } from "hardhat";

async function main() {
  const SAVING_CORE_ADDRESS = "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6";

  const [botSigner] = await ethers.getSigners();
  console.log(`Bot đang chạy với địa chỉ: ${botSigner.address}`);

  const savingCore = await ethers.getContractAt("SavingCore", SAVING_CORE_ADDRESS, botSigner);

  // BƯỚC 1: Tìm TẤT CẢ depositId đã từng tồn tại trong hệ thống (không lọc theo
  // owner nào cả, vì bot phải quét toàn bộ, không phải chỉ 1 user).
  // Dùng event DepositOpened (mint lần đầu) - depositId nằm ở topic đầu tiên.
  const currentBlock = await ethers.provider.getBlockNumber();
  const CHUNK_SIZE = 9000; // giống frontend, tránh vượt giới hạn RPC "range exceeds limit"
  const allDepositIds = new Set<bigint>();

  let fromBlock = 0; // với Hardhat local luôn bắt đầu từ 0, không cần DEPLOY_BLOCK
  while (fromBlock <= currentBlock) {
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, currentBlock);
    const events = await savingCore.queryFilter(
      savingCore.filters.DepositOpened(),
      fromBlock,
      toBlock,
    );
    for (const ev of events) {
      if ("args" in ev) allDepositIds.add(ev.args.depositId as bigint);
    }
    fromBlock = toBlock + 1;
  }

  console.log(`Tìm thấy tổng cộng ${allDepositIds.size} deposit đã từng mở.`);

  // BƯỚC 2: Lọc ra deposit đủ điều kiện auto-renew.
  const nowBlock = await ethers.provider.getBlock("latest");
  const now = BigInt(nowBlock!.timestamp);

  let renewedCount = 0;
  let skippedCount = 0;

  for (const depositId of allDepositIds) {
    try {
      const dep = await savingCore.getDeposit(depositId);

      // status 0 = Active (enum Status trong contract)
      if (Number(dep.status) !== 0) {
        skippedCount++;
        continue; // đã Withdrawn/ManualRenewed/AutoRenewed từ trước - bỏ qua
      }

      const gracePeriodSeconds = await savingCore.gracePeriodSeconds();
      const eligibleAt = dep.maturityAt + gracePeriodSeconds;

      if (now < eligibleAt) {
        console.log(`  Deposit #${depositId}: chưa đủ điều kiện (còn ${eligibleAt - now}s nữa).`);
        skippedCount++;
        continue;
      }

      // BƯỚC 3: Gọi autoRenewDeposit - KHÔNG cần biết ai là owner, hàm tự xử lý.
      console.log(`  Deposit #${depositId}: đủ điều kiện, đang gọi autoRenewDeposit...`);
      const tx = await savingCore.autoRenewDeposit(depositId);
      const receipt = await tx.wait();
      console.log(`  ✅ Deposit #${depositId} đã auto-renew thành công. Tx: ${receipt?.hash}`);
      renewedCount++;
    } catch (err: any) {
      console.log(`  ⚠️ Deposit #${depositId}: lỗi khi xử lý - ${err.reason ?? err.shortMessage ?? err.message}`);
      skippedCount++;
    }
  }

  console.log(`\nHoàn tất: ${renewedCount} deposit đã auto-renew, ${skippedCount} deposit bỏ qua.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
