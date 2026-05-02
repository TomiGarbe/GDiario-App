"use client";

import { useCallback, useEffect, useState } from "react";

import type { Movement } from "../types/api";
import { ApiError } from "../lib/api";
import { movementService } from "../services/movements";

export function useMovements() {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMovements = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await movementService.list();
      setMovements(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Unexpected error loading movements";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchMovements();
  }, [fetchMovements]);

  const createMovement = useCallback(async (payload: any) => {
    const created = await movementService.create(payload);
    setMovements((prev) => [created, ...prev]);
    return created;
  }, []);

  const updateMovement = useCallback(async (id: string, payload: any) => {
    const updated = await movementService.update(id, payload);
    setMovements((prev) => prev.map((movement) => (movement.id === id ? updated : movement)));
    return updated;
  }, []);

  const deleteMovement = useCallback(async (id: string) => {
    await movementService.remove(id);
    setMovements((prev) => prev.filter((movement) => movement.id !== id));
  }, []);

  return {
    movements,
    loading,
    error,
    refetch: fetchMovements,
    createMovement,
    updateMovement,
    deleteMovement,
  };
}
