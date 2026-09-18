import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { CoresaProduct } from '../../../entities/CoresaProduct';
import {
  InternalMeliProduct,
  mapInternalMeliProduct,
} from '../../../entities/InternalMeliProduct';

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

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      accept: '*/*',
    };
    if (this.apiKey) {
      headers['x-api-key'] = this.apiKey;
      headers['x-internal-api-key'] = this.apiKey;
    }
    return headers;
  }

  private url(path: string): string {
    const base = this.apiUrl.replace(/\/$/, '');
    return `${base}${path}`;
  }

  private prepareRequest(path: string, data: unknown): AxiosRequestConfig {
    return {
      method: 'POST',
      url: this.url(path),
      headers: this.headers(),
      data,
    };
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, size + i));
    return out;
  }

  async upsertProducts(products: CoresaProduct[]): Promise<void> {
    for (const batch of this.chunk(products, this.chunkSize)) {
      const config = this.prepareRequest(
        '/internal/mercadolibre/products/bulk',
        {
          products: batch,
        },
      );
      const response = await this.axios.request(config);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] upsert -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }
    }
  }

  async getProductBySku(sku: string): Promise<InternalMeliProduct | null> {
    const encoded = encodeURIComponent(sku);
    try {
      const response = await this.axios.request({
        method: 'GET',
        url: this.url(`/internal/mercadolibre/products/by-sku/${encoded}`),
        headers: this.headers(),
      });
      if (response.status === 404) return null;
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] by-sku ${sku} -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }
      return mapInternalMeliProduct(response.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }
}
