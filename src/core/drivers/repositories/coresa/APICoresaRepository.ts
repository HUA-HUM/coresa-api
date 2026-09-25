import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { CoresaProduct } from '../../../entities/CoresaProduct';

export class APICoresaRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    const url = process.env.CORESA_API_URL;
    if (!url) {
      throw new Error(
        '[Coresa] CORESA_API_URL no está definida. Revisá el archivo .env',
      );
    }
    return url;
  }

  private get apiKey(): string {
    const key = process.env.CORESA_API_KEY;
    if (!key) {
      throw new Error(
        '[Coresa] CORESA_API_KEY no está definida. Revisá el archivo .env',
      );
    }
    return key;
  }

  private get pageSize(): number {
    return Number(process.env.CORESA_PAGE_SIZE ?? 500);
  }

  private prepareRequest(
    query: Record<string, string | number> = {},
  ): AxiosRequestConfig {
    return {
      method: 'GET',
      url: this.apiUrl,
      headers: {
        'x-api-key': this.apiKey,
      },
      params: query,
    };
  }

  private getProductsFromResponse(payload: any): CoresaProduct[] {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.data)) return payload.data;
    if (Array.isArray(payload?.products)) return payload.products;
    if (Array.isArray(payload?.items)) return payload.items;

    throw new Error(
      '[Coresa] Respuesta inesperada. Se esperaba un array o { data | products | items }',
    );
  }

  private getSingleProduct(payload: any): CoresaProduct | null {
    if (!payload) return null;
    if (Array.isArray(payload)) return payload[0] ?? null;
    if (payload?.data && !Array.isArray(payload.data)) return payload.data;
    if (Array.isArray(payload?.data)) return payload.data[0] ?? null;
    if (payload.SKU || payload.sku) return payload as CoresaProduct;
    return null;
  }

  private hasNextPage(
    payload: any,
    currentPage: number,
    pageItems: number,
  ): boolean {
    const meta = payload?.meta;
    if (typeof meta?.has_next === 'boolean') return meta.has_next;
    if (typeof meta?.total_pages === 'number')
      return currentPage < meta.total_pages;
    if (typeof payload?.totalPages === 'number')
      return currentPage < payload.totalPages;
    return pageItems >= this.pageSize;
  }

  async getAllProducts(): Promise<CoresaProduct[]> {
    const products: CoresaProduct[] = [];
    let page = 1;

    while (true) {
      const config = this.prepareRequest({
        page,
        pageSize: this.pageSize,
      });
      const response = await this.axios.request(config);
      const pageItems = this.getProductsFromResponse(response.data);
      products.push(...pageItems);

      if (!this.hasNextPage(response.data, page, pageItems.length)) break;
      page++;
    }

    return products;
  }

  /** La API de Coresa responde 404 cuando el SKU no está en el catálogo. */
  async getProductBySku(sku: string): Promise<CoresaProduct | null> {
    const config = this.prepareRequest({ sku });
    try {
      const response = await this.axios.request(config);
      return this.getSingleProduct(response.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }
}
