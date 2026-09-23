import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  CoresaPublication,
  CoresaPublicationFilters,
  CreateCoresaPublicationInput,
  UpdateCoresaPublicationInput,
} from '../../../entities/CoresaPublication';

const BASE_PATH = '/internal/coresa/publications';

/**
 * Registro de publicaciones en internal-api
 * (tabla coresa_meli_publications).
 */
export class APICoresaPublicationRepository {
  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    const url = process.env.INTERNAL_API_URL;
    if (!url) {
      throw new Error(
        '[internal-api] INTERNAL_API_URL no está definida. Revisá el archivo .env',
      );
    }
    return url.replace(/\/$/, '');
  }

  private get apiKey(): string {
    return String(process.env.INTERNAL_API_KEY ?? '').trim();
  }

  private get timeout(): number {
    return Number(process.env.INTERNAL_API_TIMEOUT_MS ?? 20000);
  }

  private prepareRequest(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    data?: unknown,
    params?: Record<string, string | number>,
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['x-internal-api-key'] = this.apiKey;

    const config: AxiosRequestConfig = {
      method,
      url: `${this.apiUrl}${path}`,
      headers,
      timeout: this.timeout,
    };
    if (data !== undefined) config.data = data;
    if (params !== undefined) config.params = params;
    return config;
  }

  /**
   * Si el SKU ya tiene una publicación en curso, internal-api responde 409
   * con su id. Rearmar el borrador de un SKU es normal (el usuario corrige y
   * vuelve a pedir el preview), así que se reutiliza esa publicación en vez
   * de fallar: se le pisa el borrador con el nuevo.
   */
  async create(
    input: CreateCoresaPublicationInput,
  ): Promise<CoresaPublication> {
    const config = this.prepareRequest('POST', BASE_PATH, input);
    try {
      const response = await this.axios.request(config);
      return response.data as CoresaPublication;
    } catch (err) {
      const existingId = this.inProgressPublicationId(err);
      if (existingId === null) throw err;

      return this.update(existingId, {
        status: 'draft',
        draft: input.draft,
        errorCode: null,
        errorMessage: null,
      });
    }
  }

  private inProgressPublicationId(err: unknown): number | null {
    if (!axios.isAxiosError(err) || err.response?.status !== 409) return null;

    const body = err.response.data as {
      code?: string;
      publicationId?: number;
    };
    if (body?.code !== 'publication_in_progress') return null;

    const id = Number(body.publicationId);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  async update(
    id: number,
    input: UpdateCoresaPublicationInput,
  ): Promise<CoresaPublication> {
    const config = this.prepareRequest('PATCH', `${BASE_PATH}/${id}`, input);
    const response = await this.axios.request(config);
    return response.data as CoresaPublication;
  }

  async getById(id: number): Promise<CoresaPublication | null> {
    const config = this.prepareRequest('GET', `${BASE_PATH}/${id}`);
    try {
      const response = await this.axios.request(config);
      return response.data as CoresaPublication;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  async getBySku(sku: string): Promise<CoresaPublication | null> {
    const config = this.prepareRequest(
      'GET',
      `${BASE_PATH}/by-sku/${encodeURIComponent(sku)}`,
    );
    try {
      const response = await this.axios.request(config);
      return response.data as CoresaPublication;
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return null;
      throw err;
    }
  }

  /** Todos los intentos de ese SKU, del más nuevo al más viejo. */
  async getHistoryBySku(sku: string): Promise<CoresaPublication[]> {
    const config = this.prepareRequest(
      'GET',
      `${BASE_PATH}/by-sku/${encodeURIComponent(sku)}/history`,
    );
    try {
      const response = await this.axios.request(config);
      const payload: unknown = response.data;
      if (Array.isArray(payload)) return payload as CoresaPublication[];
      const items = (payload as { items?: CoresaPublication[] })?.items;
      return Array.isArray(items) ? items : [];
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 404) return [];
      throw err;
    }
  }

  async list(filters: CoresaPublicationFilters): Promise<{
    items: CoresaPublication[];
    pagination: { limit: number; offset: number; total: number };
  }> {
    const params: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === '') continue;
      params[key] = value as string | number;
    }

    const config = this.prepareRequest('GET', BASE_PATH, undefined, params);
    const response = await this.axios.request(config);
    const payload = response.data as {
      items?: CoresaPublication[];
      pagination?: { limit: number; offset: number; total: number };
    };

    return {
      items: Array.isArray(payload?.items) ? payload.items : [],
      pagination: payload?.pagination ?? {
        limit: Number(filters.limit ?? 50),
        offset: Number(filters.offset ?? 0),
        total: 0,
      },
    };
  }
}
