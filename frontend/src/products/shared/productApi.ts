import type { ProductHealth, ProductPrincipal } from './types';
import { announceAuthExpired, authRequestOptions } from '../../auth/client';

export class ProductApiError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = 'ProductApiError';
  }
}

function createRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createProductApi(prefix: string) {
  let token: string | null = null;

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (init.method && init.method !== 'GET') headers.set('Idempotency-Key', createRequestId());

    let response: Response;
    try {
      response = await fetch(`${prefix}${path}`, authRequestOptions({ ...init, headers }));
    } catch {
      throw new ProductApiError(0, '無法連線至此產品 API，請確認該服務已啟動。');
    }

    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) {
      const detail = typeof payload === 'object' && payload !== null ? payload.detail : undefined;
      const message = Array.isArray(detail)
        ? detail.map((entry) => typeof entry === 'object' && entry !== null && 'msg' in entry ? String((entry as { msg: unknown }).msg) : '輸入資料不符合格式').join('；')
        : typeof detail === 'object' && detail !== null
          ? String(detail.message ?? '請求未完成。')
          : typeof detail === 'string'
            ? detail
            : `請求失敗（HTTP ${response.status}）。`;
      const code = typeof detail === 'object' && detail !== null && 'code' in detail
        ? String((detail as { code: unknown }).code)
        : undefined;
      if (response.status === 401) {
        const usedBearerToken = Boolean(token);
        token = null;
        if (!usedBearerToken) announceAuthExpired();
      }
      throw new ProductApiError(response.status, message, code);
    }
    return payload as T;
  }

  return {
    setToken(value: string | null) { token = value; },
    get<T>(path: string) { return request<T>(path, { method: 'GET' }); },
    post<T>(path: string, body: unknown) { return request<T>(path, { method: 'POST', body: JSON.stringify(body) }); },
    patch<T>(path: string, body: unknown) { return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }); },
    me() { return request<ProductPrincipal>('/me', { method: 'GET' }); },
    health() { return request<ProductHealth>('/health', { method: 'GET' }); },
  };
}

export function productApiPrefix(product: 'knowledge' | 'code'): string {
  const isStandaloneBuild = import.meta.env.MODE === product;
  if (product === 'knowledge') {
    return import.meta.env.VITE_KNOWLEDGE_API_PREFIX || (isStandaloneBuild ? '/api' : '/knowledge-api');
  }
  return import.meta.env.VITE_CODE_API_PREFIX || (isStandaloneBuild ? '/api' : '/code-api');
}
