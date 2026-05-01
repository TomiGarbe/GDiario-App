import { request } from "../lib/api";
import type { Movement, MovementCreateInput, MovementUpdateInput } from "../types/api";

const BASE_PATH = "/movements";

export const movementService = {
  getAll: () => request<Movement[]>(BASE_PATH),

  getById: (id: string) => request<Movement>(`${BASE_PATH}/${id}`),

  create: (data: MovementCreateInput) =>
    request<Movement>(BASE_PATH, {
      method: "POST",
      body: data,
    }),

  update: (id: string, data: MovementUpdateInput) =>
    request<Movement>(`${BASE_PATH}/${id}`, {
      method: "PATCH",
      body: data,
    }),

  remove: (id: string) =>
    request<void>(`${BASE_PATH}/${id}`, {
      method: "DELETE",
    }),
};
