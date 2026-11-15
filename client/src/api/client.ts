import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";
import { firebaseAuth } from "../config/firebase";

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080/api/v1",
});

apiClient.interceptors.request.use(async (config) => {
  const user = firebaseAuth.currentUser;
  if (user) {
    const token = await user.getIdToken();
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * A request rejected as "not signed in" (401) is retried once with a brand-new token. This
 * covers a token that expired a moment before the request reached the server.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retriedWithFreshToken?: boolean }) | undefined;
    const user = firebaseAuth.currentUser;
    if (error.response?.status === 401 && config && !config._retriedWithFreshToken && user) {
      config._retriedWithFreshToken = true;
      try {
        const token = await user.getIdToken(true);
        config.headers.Authorization = `Bearer ${token}`;
        return apiClient.request(config);
      } catch {
        // Fall through to the original error.
      }
    }
    return Promise.reject(error);
  }
);

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: Record<string, unknown>;
}
export interface ApiFailure {
  success: false;
  error: { code: string; message: string };
}
export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
