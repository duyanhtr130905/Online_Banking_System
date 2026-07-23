export interface Plan {
  planId: number;
  tenorDays: number;
  aprBps: number;
  earlyWithdrawPenaltyBps: number;
  minDeposit: bigint;
  maxDeposit: bigint;
  enabled: boolean;
}

export enum DepositStatus {
  Active = 0,
  Withdrawn = 1,
  ManualRenewed = 2,
  AutoRenewed = 3,
}

export interface Deposit {
  depositId: bigint;
  planId: bigint;
  principal: bigint;
  maturityAt: bigint;
  aprBpsAtOpen: number;
  penaltyBpsAtOpen: number;
  status: DepositStatus;
  isCurrentOwner: boolean;
  renewedToId?: bigint;
}

export interface NetworkAddresses {
  MockUSDC: string;
  VaultManager: string;
  SavingCore: string;
}
