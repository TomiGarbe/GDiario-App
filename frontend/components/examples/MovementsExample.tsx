"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { ApiError } from "../../lib/api";
import { buildPayloadFromForm, type MovementForm } from "../../lib/movementPayload";
import { useMovements } from "../../hooks/useMovements";
import { movementService } from "../../services/movements";
import type { MovementKind } from "../../types/api";

const emptyItem = { client: "", product: "", quantity: "", unit_price: "" };
const emptySalary = { employee: "", subtotal: "" };
const emptyClientPayment = { client: "", subtotal: "" };

const EMPTY_FORM: MovementForm = {
  period_id: 1,
  date: new Date().toISOString().slice(0, 10),
  type: "compra",
  amount: "",
  description: "",
  items: [emptyItem],
  salaries: [],
  client_payments: [],
};

function resetFormForType(type: MovementKind): Pick<MovementForm, "amount" | "items" | "salaries" | "client_payments"> {
  if (type === "compra" || type === "venta") {
    return { amount: "", items: [{ ...emptyItem }], salaries: [], client_payments: [] };
  }

  if (type === "sueldo") {
    return { amount: "", items: [], salaries: [{ ...emptySalary }], client_payments: [] };
  }

  if (type === "pago_cliente") {
    return { amount: "", items: [], salaries: [], client_payments: [{ ...emptyClientPayment }] };
  }

  return { amount: "", items: [], salaries: [], client_payments: [] };
}

function numberValue(value: string | number | undefined | null): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export default function MovementsExample() {
  const { movements, loading, error, refetch, createMovement, updateMovement, deleteMovement } = useMovements();

  const [form, setForm] = useState<MovementForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [entities, setEntities] = useState<{ clients: string[]; products: string[]; employees: string[] }>({
    clients: [],
    products: [],
    employees: [],
  });

  const isEditing = useMemo(() => Boolean(editingId), [editingId]);

  useEffect(() => {
    let cancelled = false;

    const loadEntities = async () => {
      try {
        const data = await movementService.entities();
        if (!cancelled) setEntities(data);
      } catch {
        if (!cancelled) setEntities({ clients: [], products: [], employees: [] });
      }
    };

    void loadEntities();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!editingId) {
      setForm((prev) => ({
        ...prev,
        ...resetFormForType(prev.type),
      }));
    }
  }, [form.type, editingId]);

  const total = useMemo(() => {
    if (form.type === "compra" || form.type === "venta") {
      return (form.items ?? []).reduce((sum, item) => sum + numberValue(item.quantity) * numberValue(item.unit_price), 0);
    }

    if (form.type === "sueldo") {
      return (form.salaries ?? []).reduce((sum, row) => sum + numberValue(row.subtotal), 0);
    }

    if (form.type === "pago_cliente") {
      return (form.client_payments ?? []).reduce((sum, row) => sum + numberValue(row.subtotal), 0);
    }

    return numberValue(form.amount);
  }, [form]);

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
      if ((form.type === "compra" || form.type === "venta") && !(form.items ?? []).some((i) => i.client && i.product)) {
        throw new Error("Agrega al menos 1 item con cliente y producto");
      }
      if (form.type === "sueldo" && !(form.salaries ?? []).some((s) => s.employee)) {
        throw new Error("Debes seleccionar al menos 1 empleado");
      }
      if (form.type === "pago_cliente" && !(form.client_payments ?? []).some((c) => c.client)) {
        throw new Error("Debes seleccionar al menos 1 cliente");
      }
      if ((form.type === "gasto" || form.type === "entrega_dinero") && !(numberValue(form.amount) > 0)) {
        throw new Error("El monto debe ser mayor a 0");
      }

      const payload = buildPayloadFromForm(form);
      if (editingId) {
        await updateMovement(editingId, payload);
      } else {
        await createMovement(payload);
      }
      resetForm();
    } catch (err) {
      setSubmitError(err instanceof ApiError || err instanceof Error ? err.message : "Could not save movement");
    } finally {
      setSubmitting(false);
    }
  };

  const startEdit = (id: string) => {
    const movement = movements.find((item) => item.id === id);
    if (!movement) return;

    setEditingId(movement.id);
    setForm({
      period_id: 1,
      date: movement.date,
      type: movement.type,
      amount: movement.amount,
      description: movement.description ?? "",
      items: movement.items.length
        ? movement.items.map((i) => ({
            client: i.client,
            product: i.product,
            quantity: i.quantity,
            unit_price: i.unit_price,
          }))
        : [{ ...emptyItem }],
      salaries: movement.salaries.length
        ? movement.salaries.map((s) => ({
            employee: s.employee,
            subtotal: s.subtotal,
          }))
        : [{ ...emptySalary }],
      client_payments: movement.client_payments.length
        ? movement.client_payments.map((c) => ({
            client: c.client,
            subtotal: c.subtotal,
          }))
        : [{ ...emptyClientPayment }],
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
          <option value="compra">Compra</option>
          <option value="venta">Venta</option>
          <option value="gasto">Gasto</option>
          <option value="sueldo">Sueldo</option>
          <option value="pago_cliente">Pago a cliente</option>
          <option value="entrega_dinero">Entrega de dinero</option>
        </select>

        {(form.type === "compra" || form.type === "venta") && (
          <div>
            {(form.items ?? []).map((item, index) => {
              const subtotal = numberValue(item.quantity) * numberValue(item.unit_price);
              return (
                <div key={`item-${index}`}>
                  <select
                    value={item.client}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        items: (prev.items ?? []).map((row, i) => (i === index ? { ...row, client: e.target.value } : row)),
                      }))
                    }
                    required
                  >
                    <option value="">Cliente</option>
                    {entities.clients.map((client) => (
                      <option key={client} value={client}>
                        {client}
                      </option>
                    ))}
                  </select>

                  <select
                    value={item.product}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        items: (prev.items ?? []).map((row, i) => (i === index ? { ...row, product: e.target.value } : row)),
                      }))
                    }
                    required
                  >
                    <option value="">Producto</option>
                    {entities.products.map((product) => (
                      <option key={product} value={product}>
                        {product}
                      </option>
                    ))}
                  </select>

                  <input
                    placeholder="Cantidad"
                    value={item.quantity}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        items: (prev.items ?? []).map((row, i) => (i === index ? { ...row, quantity: e.target.value } : row)),
                      }))
                    }
                    required
                  />

                  <input
                    placeholder="Precio"
                    value={item.unit_price}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        items: (prev.items ?? []).map((row, i) => (i === index ? { ...row, unit_price: e.target.value } : row)),
                      }))
                    }
                    required
                  />

                  <span>Subtotal: {subtotal.toFixed(2)}</span>

                  <button
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        items: (prev.items ?? []).filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Eliminar fila
                  </button>
                </div>
              );
            })}

            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  items: [...(prev.items ?? []), { ...emptyItem }],
                }))
              }
            >
              Agregar fila
            </button>
          </div>
        )}

        {form.type === "sueldo" && (
          <div>
            {(form.salaries ?? []).map((row, index) => (
              <div key={`salary-${index}`}>
                <select
                  value={row.employee}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      salaries: (prev.salaries ?? []).map((item, i) =>
                        i === index ? { ...item, employee: e.target.value } : item,
                      ),
                    }))
                  }
                  required
                >
                  <option value="">Empleado</option>
                  {entities.employees.map((employee) => (
                    <option key={employee} value={employee}>
                      {employee}
                    </option>
                  ))}
                </select>

                <input
                  placeholder="Monto"
                  value={row.subtotal}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      salaries: (prev.salaries ?? []).map((item, i) =>
                        i === index ? { ...item, subtotal: e.target.value } : item,
                      ),
                    }))
                  }
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      salaries: (prev.salaries ?? []).filter((_, i) => i !== index),
                    }))
                  }
                >
                  Eliminar fila
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  salaries: [...(prev.salaries ?? []), { ...emptySalary }],
                }))
              }
            >
              Agregar fila
            </button>
          </div>
        )}

        {form.type === "pago_cliente" && (
          <div>
            {(form.client_payments ?? []).map((row, index) => (
              <div key={`cp-${index}`}>
                <select
                  value={row.client}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      client_payments: (prev.client_payments ?? []).map((item, i) =>
                        i === index ? { ...item, client: e.target.value } : item,
                      ),
                    }))
                  }
                  required
                >
                  <option value="">Cliente</option>
                  {entities.clients.map((client) => (
                    <option key={client} value={client}>
                      {client}
                    </option>
                  ))}
                </select>

                <input
                  placeholder="Monto"
                  value={row.subtotal}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      client_payments: (prev.client_payments ?? []).map((item, i) =>
                        i === index ? { ...item, subtotal: e.target.value } : item,
                      ),
                    }))
                  }
                  required
                />

                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      client_payments: (prev.client_payments ?? []).filter((_, i) => i !== index),
                    }))
                  }
                >
                  Eliminar fila
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  client_payments: [...(prev.client_payments ?? []), { ...emptyClientPayment }],
                }))
              }
            >
              Agregar fila
            </button>
          </div>
        )}

        {(form.type === "gasto" || form.type === "entrega_dinero") && (
          <div>
            <input
              placeholder="Monto"
              value={form.amount ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, amount: e.target.value }))}
              required
            />
            <input
              placeholder="Descripcion"
              value={form.description ?? ""}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            />
          </div>
        )}

        <p>Total: {total.toFixed(2)}</p>

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
            <p>Items: {movement.items.length}</p>
            <p>Salaries: {movement.salaries.length}</p>
            <p>Client payments: {movement.client_payments.length}</p>
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
