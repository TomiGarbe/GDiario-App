export type MovementKind =
  | "compra"
  | "venta"
  | "gasto"
  | "sueldo"
  | "saldo_inicial"
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
  sheet_sync_status: "pending" | "processing" | "synced" | "temporary_error" | "definitive_error";
  items: MovementItem[];
  salaries: MovementSalary[];
  client_payments: MovementClientPayment[];
}

export interface Balance {
  balance: string;
}

export interface EntityProduct {
  product_id: string;
  product_name: string;
  price: string;
}

export interface EntityClient {
  id: string;
  name: string;
  products: EntityProduct[];
}

export interface EntitiesResponse {
  clients: EntityClient[];
}

export interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
}
