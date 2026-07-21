# AGENTS.md — Term Deposit System

## Compile
```bash
npm install
node scripts/compile.js
```
No Hardhat config exists yet — do not run `npx hardhat` commands. Testing infra will be added per PLAN.md.

## Personal Variant — DO NOT CHANGE
- Grace period (auto-renew): **4 days**
- Default plan APR: **400 bps (4.00%)**
- Early withdraw penalty: **400 bps (4.00%)**
- Default plan tenor: **90 days**

## 7 Invariant Business Rules — PRESERVE IN EVERY CHANGE
1. **Snapshot**: `aprBpsAtOpen` / `penaltyBpsAtOpen` captured at deposit open. Never read `plans[planId].aprBps` for existing deposits.
2. **Simple interest**: `(principal * aprBps * tenorSeconds) / (365 days * 10000)`. Multiply before dividing.
3. **Early withdraw → interest = 0**: Never call `calculateInterest` in `earlyWithdraw`.
4. **Auto-renew keeps original APR** (reads old deposit's snapshot). Manual `renewDeposit` reads new plan's APR.
5. **Interest always from VaultManager** via `onlyCore` modifier.
6. **All withdraw/renew functions** need `whenNotPaused`.
7. **No admin function accepts `depositId`** to modify an existing deposit.

## Reentrancy rule (past bug)
- `_safeMint` triggers `onERC721Received` callback if recipient is a smart contract.
- **Always place `_safeMint` last** (after all effects and transfers).
- **Every function with transfer or mint must have `nonReentrant`**.

## Architecture essentials
- 3 contracts: `MockUSDC.sol` (ERC20, 6 decimals), `VaultManager.sol` (interest vault), `SavingCore.sol` (logic + NFT hub)
- OpenZeppelin v5: ERC721, **AccessControl** (not Ownable), Pausable, ReentrancyGuard, SafeERC20
- **`depositId == tokenId`** — no separate ownership mapping
- CEI pattern required: Check → Effects → Interactions

## Code style
- Vietnamese comments explain **why** (link to business rules), not just **what**
- Solidity `^0.8.24`, OZ contracts `^5.6.1`
- No new dependencies without explicit request
