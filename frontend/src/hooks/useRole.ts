import { useState, useEffect } from "react";
import type { Contract } from "ethers";

export function useRole(savingCore: Contract | null, account: string | null) {
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!savingCore || !account) {
      setIsAdmin(false);
      setLoading(false);
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
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [savingCore, account]);

  return { isAdmin, loading };
}
