import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  CoresaPublication,
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
}
