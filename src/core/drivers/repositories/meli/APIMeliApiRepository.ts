import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ActiveMeliListing } from '../../../entities/ActiveMeliListing';

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

  private prepareRequest(path: string, data: unknown): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['x-api-key'] = this.apiKey.trim();

    const base = this.apiUrl.replace(/\/$/, '');
    return {
      method: 'POST',
      url: `${base}${path}`,
      headers,
      data,
    };
  }

  async updateListings(items: ActiveMeliListing[]): Promise<void> {
    if (items.length === 0) return;

    const config = this.prepareRequest('/listings/update', {
      items: items.map((item) => ({
        meli_item_id: item.meli_item_id,
        product: item.product,
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
