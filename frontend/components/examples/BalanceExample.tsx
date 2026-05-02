"use client";

import { useState } from "react";

import { useBalance } from "../../hooks/useBalance";

export default function BalanceExample() {
  const [inputDate, setInputDate] = useState(new Date().toISOString().slice(0, 10));
  const { balance, loading, error, refetch } = useBalance(inputDate);

  return (
    <section>
      <h2>Balance</h2>

      <input type="date" value={inputDate} onChange={(e) => setInputDate(e.target.value)} />
      <button type="button" onClick={() => void refetch(inputDate)} disabled={loading}>
        {loading ? "Consulting..." : "Consult"}
      </button>

      {error && <p>{error}</p>}

      {balance && (
        <div>
          <p>Balance: {balance.balance}</p>
        </div>
      )}
    </section>
  );
}
