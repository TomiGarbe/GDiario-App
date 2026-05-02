import { request } from "../lib/api";
import { qs } from "../lib/qs";
import type { Balance, Movement } from "../types/api";

export const movementService = {
  list: (params?: Record<string, any>) =>
    request<Movement[]>(`/movements?${qs(params)}`),

  getById: (id: string) => request<Movement>(`/movements/${id}`),

  create: (payload: any) =>
    request<Movement>("/movements/", {
      method: "POST",
      body: payload,
    }),

  update: (id: string, payload: any) =>
    request<Movement>(`/movements/${id}`, {
      method: "PATCH",
      body: payload,
    }),

  remove: (id: string) =>
    request<void>(`/movements/${id}`, {
      method: "DELETE",
    }),

  entities: () =>
    request<{
      clients: string[];
      products: string[];
      employees: string[];
    }>("/movements/entities"),

  balance: (params?: Record<string, any>) =>
    request<Balance>(`/movements/balance?${qs(params)}`),
};
