import type { ApiErrorPayload } from "../types/api";

const API_URL = (import.meta.env.VITE_API_URL || "https://gdiario-api.botly.com.ar")
  .trim()
  .replace(/\/$/, "");
const API_BASE_URL = `${API_URL}/api`;
const REQUEST_TIMEOUT_MS = 25_000;

console.log("API_URL:", API_URL);

export class ApiError extends Error {
  status: number;
  payload?: ApiErrorPayload;

  constructor(message: string, status: number, payload?: ApiErrorPayload) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface RequestOptions {
  method?: HttpMethod;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

const buildUrl = (path: string) => {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalizedPath}`;
};

const getErrorMessage = (status: number, payload?: ApiErrorPayload) => {
  if (!payload) return `Request failed with status ${status}`;
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail) && payload.detail[0]?.msg) return payload.detail[0].msg;
  if (payload.message) return payload.message;
  return `Request failed with status ${status}`;
};

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers, signal } = options;
  const url = buildUrl(path);
  const requestBody = body !== undefined ? JSON.stringify(body) : undefined;
  const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort("timeout"), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });
  const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: requestBody,
    });
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason === "timeout") {
      throw new ApiError(`The request exceeded ${REQUEST_TIMEOUT_MS / 1000} seconds (request ID: ${requestId})`, 0);
    }
    throw new ApiError("Network error: could not connect to server", 0);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();

  let payload: unknown = undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | undefined;
    throw new ApiError(text || getErrorMessage(response.status, errorPayload), response.status, errorPayload);
  }

  return payload as T;
}
