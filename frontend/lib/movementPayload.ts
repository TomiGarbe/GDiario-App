import type { MovementKind } from "../types/api";

type MovementForm = {
  period_id: number | string;
  date: string;
  type: MovementKind;
  description?: string | null;
  amount?: number | string;
  items?: Array<{
    client: string;
    product: string;
    quantity: number | string;
    unit_price: number | string;
  }>;
  salaries?: Array<{
    employee: string;
    subtotal: number | string;
  }>;
  client_payments?: Array<{
    client: string;
    subtotal: number | string;
  }>;
};

export function buildPayloadFromForm(form: any) {
  const periodId = Number(form?.period_id);
  if (!Number.isInteger(periodId) || periodId <= 0) {
    throw new Error("Periodo invalido");
  }

  const base = {
    period_id: periodId,
    date: String(form?.date ?? ""),
    type: form?.type as MovementKind,
    description: form?.description ?? null,
  };

  if (form.type === "compra" || form.type === "venta") {
    const items = (Array.isArray(form.items) ? form.items : [])
      .map((i: any) => {
        const client = String(i?.client ?? "").trim();
        const product = String(i?.product ?? "").trim();
        const quantity = Number(i?.quantity);
        const unit_price = Number(i?.unit_price);
        const subtotal = quantity * unit_price;

        return {
          client,
          product,
          quantity,
          unit_price,
          subtotal,
        };
      })
      .filter((i: any) => i.client && i.product && i.quantity > 0 && i.unit_price > 0);

    if (!items.length) {
      throw new Error("Debe haber al menos un item valido");
    }

    return {
      ...base,
      items,
      amount: items.reduce((sum: number, i: { subtotal: number }) => sum + i.subtotal, 0),
    };
  }

  if (form.type === "sueldo") {
    const salaries = (Array.isArray(form.salaries) ? form.salaries : [])
      .map((s: any) => ({
        employee: String(s?.employee ?? "").trim(),
        subtotal: Number(s?.subtotal),
      }))
      .filter((s: any) => s.employee && s.subtotal > 0);

    if (!salaries.length) {
      throw new Error("Debe haber al menos un sueldo valido");
    }

    return {
      ...base,
      salaries,
      amount: salaries.reduce((sum: number, s: { subtotal: number }) => sum + s.subtotal, 0),
    };
  }

  if (form.type === "pago_cliente") {
    const client_payments = (Array.isArray(form.client_payments) ? form.client_payments : [])
      .map((c: any) => ({
        client: String(c?.client ?? "").trim(),
        subtotal: Number(c?.subtotal),
      }))
      .filter((c: any) => c.client && c.subtotal > 0);

    if (!client_payments.length) {
      throw new Error("Debe haber al menos un pago a cliente valido");
    }

    return {
      ...base,
      client_payments,
      amount: client_payments.reduce((sum: number, c: { subtotal: number }) => sum + c.subtotal, 0),
    };
  }

  if (form.type === "gasto" || form.type === "entrega_dinero") {
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      throw new Error("Monto invalido");
    }

    return {
      ...base,
      amount,
    };
  }

  throw new Error("Tipo de movimiento invalido");
}

export type { MovementForm };
