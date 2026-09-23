import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { MeliListingProduct } from '../../../entities/MeliListingProduct';

export class APIMeliApiRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    const url = process.env.MERCADOLIBRE_API_URL;
    if (!url) {
      throw new Error(
        '[meli-api] MERCADOLIBRE_API_URL no está definida. Revisá el archivo .env',
      );
    }
    return url;
  }

  private get apiKey(): string {
    return process.env.MERCADOLIBRE_API_KEY ?? '';
  }

  private prepareRequest(
    path: string,
    query: Record<string, string | number> = {},
    data?: unknown,
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey.trim();

    const config: AxiosRequestConfig = {
      method: data !== undefined ? 'POST' : 'GET',
      url: `${this.apiUrl.replace(/\/$/, '')}${path}`,
      headers,
      params: query,
    };
    if (data !== undefined) config.data = data;
    return config;
  }

  async updateListings(items: MeliListingProduct[]): Promise<void> {
    if (items.length === 0) return;

    const config = this.prepareRequest('/meli/products/:itemId/price', {}, {
      items: items.map((item) => ({
        meli_item_id: item.meli_item_id,
        price: item.price,
      })),
    });
    const response = await this.axios.request(config);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `[meli-api] updateListings -> ${response.status}: ${JSON.stringify(response.data)}`,
      );
    }
  }
}
