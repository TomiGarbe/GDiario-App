"use client";

import { FormEvent, useMemo, useState } from "react";

import { ApiError } from "../../lib/api";
import { useMovements } from "../../hooks/useMovements";
import type { MovementCreateInput, MovementKind, MovementUpdateInput } from "../../types/api";

const MOVEMENT_TYPES: MovementKind[] = ["compra", "venta", "gasto", "pago", "sueldo"];

const EMPTY_FORM: MovementCreateInput = {
  date: new Date().toISOString().slice(0, 10),
  type: "gasto",
  client: "",
  employee: "",
  description: "",
  details: [],
};

export default function MovementsExample() {
  const { movements, loading, error, refetch, createMovement, updateMovement, deleteMovement } = useMovements();

  const [form, setForm] = useState<MovementCreateInput>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isEditing = useMemo(() => Boolean(editingId), [editingId]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setSubmitError(null);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (editingId) {
        const updatePayload: MovementUpdateInput = {
          ...form,
          details: form.details ?? [],
        };
        await updateMovement(editingId, updatePayload);
      } else {
        await createMovement({ ...form, details: form.details ?? [] });
      }
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not save movement");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (id: string) => {
    const movement = movements.find((item) => item.id === id);
    if (!movement) return;

    setEditingId(movement.id);
    setForm({
      date: movement.date,
      type: movement.type,
      client: movement.client ?? "",
      employee: movement.employee ?? "",
      description: movement.description ?? "",
      details: movement.details.map((detail) => ({
        type: detail.type,
        product: detail.product,
        employee: detail.employee,
        quantity: detail.quantity,
        unit_price: detail.unit_price,
      })),
    });
  };

  const onDelete = async (id: string) => {
    setSubmitError(null);
    try {
      await deleteMovement(id);
      if (editingId === id) resetForm();
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : "Could not delete movement");
    }
  };

  return (
    <section>
      <h2>Movements</h2>

      <form onSubmit={onSubmit}>
        <input
          type="date"
          value={form.date}
          onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
          required
        />

        <select
          value={form.type}
          onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as MovementKind }))}
          required
        >
          {MOVEMENT_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <input
          placeholder="Client"
          value={form.client ?? ""}
          onChange={(e) => setForm((prev) => ({ ...prev, client: e.target.value }))}
        />

        <input
          placeholder="Employee"
          value={form.employee ?? ""}
          onChange={(e) => setForm((prev) => ({ ...prev, employee: e.target.value }))}
        />

        <input
          placeholder="Description"
          value={form.description ?? ""}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />

        <button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : isEditing ? "Update" : "Create"}
        </button>
        {isEditing && (
          <button type="button" onClick={resetForm}>
            Cancel
          </button>
        )}
      </form>

      {submitError && <p>{submitError}</p>}
      {error && <p>{error}</p>}

      <button type="button" onClick={refetch} disabled={loading}>
        {loading ? "Loading..." : "Refetch"}
      </button>

      <ul>
        {movements.map((movement) => (
          <li key={movement.id}>
            <p>
              {movement.date} - {movement.type} - {movement.amount}
            </p>
            <p>{movement.description}</p>
            <button type="button" onClick={() => startEdit(movement.id)}>
              Edit
            </button>
            <button type="button" onClick={() => void onDelete(movement.id)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
