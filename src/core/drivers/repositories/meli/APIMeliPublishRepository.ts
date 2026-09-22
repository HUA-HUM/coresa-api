import { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  MeliCategoryAttribute,
  MeliCategorySuggestion,
} from '../../../entities/MeliCategory';
import {
  PublicationDraft,
  PublicationValidation,
} from '../../../entities/PublicationDraft';

/**
 * Cliente de los endpoints de publicación de meli-api
 * (rama feature/meli-write-endpoints-items).
 */
export class APIMeliPublishRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    const url = process.env.MERCADOLIBRE_API_URL;
    if (!url) {
      throw new Error(
        '[meli-api] MERCADOLIBRE_API_URL no está definida. Revisá el archivo .env',
      );
    }
    return url.replace(/\/$/, '');
  }

  private get apiKey(): string {
    return String(
      process.env.MERCADOLIBRE_API_KEY ?? process.env.INTERNAL_API_KEY ?? '',
    ).trim();
  }

  private get timeout(): number {
    return Number(process.env.MERCADOLIBRE_API_TIMEOUT_MS ?? 30000);
  }

  private prepareRequest(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    query: Record<string, string | number> = {},
    data?: unknown,
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['x-internal-api-key'] = this.apiKey;

    const config: AxiosRequestConfig = {
      method,
      url: `${this.apiUrl}${path}`,
      headers,
      params: query,
      timeout: this.timeout,
    };
    if (data !== undefined) config.data = data;
    return config;
  }

  async predictCategories(
    title: string,
    limit = 3,
  ): Promise<MeliCategorySuggestion[]> {
    const config = this.prepareRequest('GET', '/meli/categories/predict', {
      title,
      limit,
    });
    const response = await this.axios.request(config);
    const payload: unknown = response.data;
    return Array.isArray(payload) ? (payload as MeliCategorySuggestion[]) : [];
  }

  async getCategoryAttributes(
    categoryId: string,
  ): Promise<MeliCategoryAttribute[]> {
    const config = this.prepareRequest(
      'GET',
      `/meli/categories/${encodeURIComponent(categoryId)}/attributes`,
    );
    const response = await this.axios.request(config);
    const payload = response.data as { attributes?: MeliCategoryAttribute[] };
    return Array.isArray(payload?.attributes) ? payload.attributes : [];
  }

  async validateItem(draft: PublicationDraft): Promise<PublicationValidation> {
    const config = this.prepareRequest(
      'POST',
      '/meli/items/validate',
      {},
      draft,
    );
    const response = await this.axios.request(config);
    return response.data as PublicationValidation;
  }
}
