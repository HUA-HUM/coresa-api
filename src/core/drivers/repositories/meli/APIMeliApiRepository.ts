import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { MeliListingUpdate } from '../../../entities/CoresaMercadoLibre';

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

  async updateListing(mla: string, patch: MeliListingUpdate): Promise<void> {
    const body: MeliListingUpdate = {};
    if (patch.price !== undefined) body.price = patch.price;
    if (patch.available_quantity !== undefined) {
      body.available_quantity = patch.available_quantity;
    }
    if (body.price === undefined && body.available_quantity === undefined) {
      return;
    }

    const itemId = encodeURIComponent(mla);
    const config = this.prepareRequest(`/meli/items/${itemId}`, {}, body);
    const response = await this.axios.request(config);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `[meli-api] updateListing ${mla} -> ${response.status}: ${JSON.stringify(response.data)}`,
      );
    }
  }
}
