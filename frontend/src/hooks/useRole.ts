import { useState, useEffect } from "react";
import type { Contract } from "ethers";

export function useRole(savingCore: Contract | null, account: string | null) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checkedAccount, setCheckedAccount] = useState<string | null>(null);
  const [checkedContract, setCheckedContract] = useState<Contract | null>(null);

  useEffect(() => {
    if (!savingCore || !account) {
      setIsAdmin(false);
      setLoading(false);
      setCheckedAccount(account);
      setCheckedContract(savingCore);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const role = await savingCore.ADMIN_ROLE();
        const has = await savingCore.hasRole(role, account);
        if (!cancelled) setIsAdmin(has);
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) {
          setCheckedAccount(account);
          setCheckedContract(savingCore);
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [savingCore, account]);

  const isCurrentRole = checkedAccount === account && checkedContract === savingCore;
  return { isAdmin: isCurrentRole ? isAdmin : false, loading: isCurrentRole ? loading : true };
}
