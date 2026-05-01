"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import { balanceService } from "../services/balance";
import type { Balance } from "../types/api";

export function useBalance(initialDate: string) {
  const [date, setDate] = useState(initialDate);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async (targetDate = date) => {
    try {
      setLoading(true);
      setError(null);
      const data = await balanceService.getByDate(targetDate);
      setBalance(data);
      setDate(targetDate);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unexpected error loading balance";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    void fetchBalance(initialDate);
  }, [fetchBalance, initialDate]);

  return {
    date,
    balance,
    loading,
    error,
    refetch: fetchBalance,
    setDate,
  };
}
