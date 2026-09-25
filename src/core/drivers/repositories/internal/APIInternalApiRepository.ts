import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { CoresaProduct } from '../../../entities/CoresaProduct';
import {
  CoresaProductInMercadoLibre,
  MercadoLibreProductSnapshot,
  mapCoresaProduct,
  mapCoresaProductsInMercadoLibre,
  mapMercadoLibreProductSnapshot,
  unwrapList,
} from '../../../entities/CoresaMercadoLibre';

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

  private get pageLimit(): number {
    const limit = Number(process.env.INTERNAL_API_PAGE_LIMIT ?? 200);
    return Number.isFinite(limit) && limit > 0 ? limit : 200;
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

  private async getOrNull(path: string, label: string): Promise<unknown> {
    try {
      const response = await this.request(this.prepareRequest(path));
      if (response.status === 404) return null;
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] ${label} -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }
      return response.data;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        return null;
      }
      throw err;
    }
  }

  async upsertCoresaProducts(products: CoresaProduct[]): Promise<void> {
    if (products.length === 0) return;

    for (const batch of this.chunk(products, this.chunkSize)) {
      const config = this.prepareRequest(
        '/internal/coresa/products/bulk',
        {},
        { products: batch },
      );
      const response = await this.request(config);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] upsert coresa -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }
    }
  }

  private hasNextPage(
    payload: unknown,
    page: number,
    pageItems: number,
    limit: number,
  ): boolean {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return pageItems >= limit;
    }
    const root = payload as Record<string, unknown>;
    const meta =
      root.meta && typeof root.meta === 'object' && !Array.isArray(root.meta)
        ? (root.meta as Record<string, unknown>)
        : root;

    if (typeof meta.has_next === 'boolean') return meta.has_next;
    if (typeof meta.hasNext === 'boolean') return meta.hasNext;

    const totalPages = meta.total_pages ?? meta.totalPages;
    if (typeof totalPages === 'number') return page < totalPages;

    const total = meta.total ?? meta.totalItems ?? meta.total_items;
    if (typeof total === 'number') return page * limit < total;

    return pageItems >= limit;
  }

  async listCoresaProductsInMercadoLibre(): Promise<
    CoresaProductInMercadoLibre[]
  > {
    const limit = this.pageLimit;
    const links: CoresaProductInMercadoLibre[] = [];
    const seen = new Set<string>();
    let page = 1;

    while (page <= 500) {
      const config = this.prepareRequest(
        '/internal/coresa/products-in-mercadolibre',
        { page, limit },
      );
      const response = await this.request(config);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] products-in-mercadolibre -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }

      const mapped = mapCoresaProductsInMercadoLibre(response.data);
      let added = 0;
      for (const link of mapped) {
        const key = `${link.sku}\0${link.mla}`;
        if (seen.has(key)) continue;
        seen.add(key);
        links.push(link);
        added += 1;
      }

      const pageItems = unwrapList(response.data).length;
      if (!this.hasNextPage(response.data, page, pageItems, limit)) break;
      if (added === 0) break;
      page += 1;
    }

    return links;
  }

  async getCoresaProductBySku(sku: string): Promise<CoresaProduct | null> {
    const encoded = encodeURIComponent(sku);
    const payload = await this.getOrNull(
      `/internal/coresa/products/by-sku/${encoded}`,
      `coresa by-sku ${sku}`,
    );
    if (payload === null) return null;
    return mapCoresaProduct(payload);
  }

  async getMercadoLibreProductByMla(
    mla: string,
  ): Promise<MercadoLibreProductSnapshot | null> {
    const encoded = encodeURIComponent(mla);
    const payload = await this.getOrNull(
      `/internal/mercadolibre/products/by-mla/${encoded}`,
      `mercadolibre by-mla ${mla}`,
    );
    if (payload === null) return null;
    return mapMercadoLibreProductSnapshot(payload);
  }
}
