export type MovementKind = "compra" | "venta" | "gasto" | "pago" | "sueldo";
export type MovementDetailKind = "producto" | "empleado" | "gasto";

export interface MovementDetail {
  id: string;
  type: MovementDetailKind;
  product: string | null;
  employee: string | null;
  quantity: string | null;
  unit_price: string | null;
  subtotal: string | null;
}

export interface Movement {
  id: string;
  date: string;
  type: MovementKind;
  client: string | null;
  employee: string | null;
  amount: string;
  description: string | null;
  details: MovementDetail[];
}

export interface MovementDetailInput {
  type: MovementDetailKind;
  product?: string | null;
  employee?: string | null;
  quantity?: number | string | null;
  unit_price?: number | string | null;
}

export interface MovementCreateInput {
  date: string;
  type: MovementKind;
  client?: string | null;
  employee?: string | null;
  description?: string | null;
  details?: MovementDetailInput[];
}

export interface MovementUpdateInput {
  date?: string;
  type?: MovementKind;
  client?: string | null;
  employee?: string | null;
  description?: string | null;
  details: MovementDetailInput[];
}

export interface Balance {
  date: string;
  total_debe: string;
  total_haber: string;
  balance: string;
}

export interface ApiErrorPayload {
  detail?: string | Array<{ msg?: string }>;
  message?: string;
}
