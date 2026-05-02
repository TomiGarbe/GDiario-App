export type MovementKind =
  | "compra"
  | "venta"
  | "gasto"
  | "sueldo"
  | "entrega_dinero"
  | "pago_cliente";

export interface MovementItem {
  client: string;
  product: string;
  quantity: string;
  unit_price: string;
  subtotal: string;
}

export interface MovementSalary {
  employee: string;
  subtotal: string;
}

export interface MovementClientPayment {
  client: string;
  subtotal: string;
}

export interface Movement {
  id: string;
  date: string;
  type: MovementKind;
  amount: string;
  description: string | null;
  items: MovementItem[];
  salaries: MovementSalary[];
  client_payments: MovementClientPayment[];
}

export interface Balance {
  balance: string;
}

export interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
}
