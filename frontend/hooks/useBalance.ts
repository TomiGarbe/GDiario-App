"use client";

import { useCallback, useEffect, useState } from "react";

import { ApiError } from "../lib/api";
import type { Balance } from "../types/api";
import { movementService } from "../services/movements";

export function useBalance(initialDate: string) {
  const [date, setDate] = useState(initialDate);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchBalance = useCallback(async (targetDate = date) => {
    try {
      setLoading(true);
      setError(null);
      const data = await movementService.balance({
        date_from: targetDate,
        date_to: targetDate,
      });
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
