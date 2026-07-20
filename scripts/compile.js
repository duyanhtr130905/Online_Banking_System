const solc = require("solc");
const fs = require("fs");
const path = require("path");

function findImports(importPath) {
  try {
    const fullPath = path.resolve(__dirname, "node_modules", importPath);
    return { contents: fs.readFileSync(fullPath, "utf8") };
  } catch (e) {
    try {
      const fullPath = path.resolve(__dirname, importPath);
      return { contents: fs.readFileSync(fullPath, "utf8") };
    } catch (e2) {
      return { error: "File not found: " + importPath };
    }
  }
}

const files = ["MockUSDC.sol", "VaultManager.sol", "SavingCore.sol"];
const sources = {};
files.forEach((f) => {
  sources[f] = { content: fs.readFileSync(path.join(__dirname, "contracts", f), "utf8") };
});

const input = {
  language: "Solidity",
  sources,
  settings: {
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    optimizer: { enabled: true, runs: 200 },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

let hasError = false;
if (output.errors) {
  output.errors.forEach((err) => {
    if (err.severity === "error") {
      hasError = true;
      console.log("ERROR:\n" + err.formattedMessage);
    } else {
      console.log("WARNING:\n" + err.formattedMessage);
    }
  });
}

if (!hasError) {
  console.log("\n✅ COMPILE THÀNH CÔNG - không có lỗi cú pháp.");
  files.forEach((f) => {
    const contractsInFile = output.contracts[f];
    Object.keys(contractsInFile).forEach((name) => {
      const bytecodeSize = contractsInFile[name].evm.bytecode.object.length / 2;
      console.log(`   - ${name}: bytecode size ~${bytecodeSize} bytes`);
    });
  });
} else {
  console.log("\n❌ COMPILE THẤT BẠI - xem lỗi ở trên.");
  process.exit(1);
}
