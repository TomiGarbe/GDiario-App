import { request } from "../lib/api";
import type { Balance } from "../types/api";

export const balanceService = {
  getByDate: (date: string) => {
    const query = new URLSearchParams({ date }).toString();
    return request<Balance>(`/movements/balance?${query}`);
  },
};
