import { request } from "../lib/api";
import type { Balance, EntitiesResponse, Movement } from "../types/api";

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
    request<EntitiesResponse>("/movements/entities"),

  balance: () =>
    request<Balance>("/movements/balance"),
};
