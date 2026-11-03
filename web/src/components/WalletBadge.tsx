import { useEffect, useState } from "react";
import { api } from "../api/client.js";

function formatMicros(micros: number | null): string {
  if (micros === null) return "—";
  return `$${(micros / 1_000_000).toFixed(2)}`;
}

export default function WalletBadge() {
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getWallet()
      .then((w) => {
        if (!cancelled) setBalance(w.balanceMicros);
      })
      .catch(() => {
        if (!cancelled) setError("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="rounded-full bg-stone-100 px-3 py-1 text-xs text-stone-600" data-testid="wallet-badge">
      {error ? "balance unavailable" : `balance: ${formatMicros(balance)}`}
    </div>
  );
}
