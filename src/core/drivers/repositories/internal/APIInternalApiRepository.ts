import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  MeliBySkuLookup,
  MeliListingProduct,
  mapMeliBySkuLookup,
} from '../../../entities/MeliListingProduct';

export class APIInternalApiRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    const url = process.env.INTERNAL_API_URL;
    if (!url) {
      throw new Error(
        '[internal-api] INTERNAL_API_URL no está definida. Revisá el archivo .env',
      );
    }
    return url;
  }

  private get apiKey(): string {
    return process.env.INTERNAL_API_KEY ?? '';
  }

  private get chunkSize(): number {
    return Number(process.env.INTERNAL_API_CHUNK_SIZE ?? 500);
  }

  private get requestRetries(): number {
    return Number(process.env.INTERNAL_API_RETRIES ?? 2);
  }

  private isTransientNetworkError(err: unknown): boolean {
    if (!axios.isAxiosError(err) || err.response) return false;
    const code = String(err.code ?? '');
    const causeCode = String(
      (err.cause as { code?: string } | undefined)?.code ?? '',
    );
    const transient = new Set([
      'ECONNRESET',
      'ECONNABORTED',
      'EPIPE',
      'ETIMEDOUT',
      'EAI_AGAIN',
    ]);
    return (
      transient.has(code) ||
      transient.has(causeCode) ||
      Boolean(
        (err.request as { reusedSocket?: boolean } | undefined)?.reusedSocket,
      )
    );
  }

  private async request(config: AxiosRequestConfig) {
    let lastError: unknown;
    const attempts = Math.max(1, this.requestRetries + 1);
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await this.axios.request(config);
      } catch (err) {
        lastError = err;
        if (!this.isTransientNetworkError(err) || attempt === attempts) {
          throw err;
        }
      }
    }
    throw lastError;
  }

  private prepareRequest(
    path: string,
    query: Record<string, string | number> = {},
    data?: unknown,
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      accept: '*/*',
      Connection: 'close',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
      headers['x-internal-api-key'] = this.apiKey;
    }

    const config: AxiosRequestConfig = {
      method: data !== undefined ? 'POST' : 'GET',
      url: `${this.apiUrl.replace(/\/$/, '')}${path}`,
      headers,
      params: query,
    };
    if (data !== undefined) config.data = data;
    return config;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, size + i));
    return out;
  }

  async upsertProducts(products: MeliListingProduct[]): Promise<void> {
    if (products.length === 0) return;

    for (const batch of this.chunk(products, this.chunkSize)) {
      const config = this.prepareRequest(
        '/internal/mercadolibre/products/bulk',
        {},
        { products: batch },
      );
      const response = await this.request(config);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] upsert -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }
    }
  }

  async getProductBySku(sku: string): Promise<MeliBySkuLookup | null> {
    const encoded = encodeURIComponent(sku);
    try {
      const config = this.prepareRequest(
        `/internal/mercadolibre/products/by-sku/${encoded}`,
      );
      const response = await this.request(config);
      if (response.status === 404) return null;
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] by-sku ${sku} -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }
      return mapMeliBySkuLookup(response.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }
}
