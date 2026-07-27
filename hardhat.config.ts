import "@nomicfoundation/hardhat-toolbox";
import "hardhat-contract-sizer";
import "hardhat-abi-exporter";
import "hardhat-gas-reporter";
import * as dotenv from "dotenv";
import "hardhat-deploy";
import "hardhat-deploy-ethers";

dotenv.config();

const { TESTNET_PRIVATE_KEY: testnetPrivateKey } = process.env;
const reportGas = process.env.REPORT_GAS;
const etherscanApiKey = process.env.ETHERSCAN_API_KEY || "";

module.exports = {
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts: testnetPrivateKey ? [testnetPrivateKey] : [],
      timeout: 40000,
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          evmVersion: "cancun",
          optimizer: { enabled: true, runs: 1000 },
          viaIR: true,
        },
      },
    ],
  },
  abiExporter: {
    path: "data/abi",
    runOnCompile: true,
    clear: true,
    flat: false,
    only: [],
    spacing: 4,
  },
  gasReporter: {
    enabled: reportGas == "1",
  },
  contractSizer: {
    alphaSort: true,
    disambiguatePaths: false,
    runOnCompile: true,
  },
  mocha: {
    timeout: 40000,
  },
  namedAccounts: {
    deployer: 0,
  },
  typechain: {
    outDir: "typechain",
    target: "ethers-v6",
  },
  etherscan: {
    apiKey: etherscanApiKey,
  },
};
