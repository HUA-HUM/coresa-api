import { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
  MeliListingUpdate,
  MeliListingUpdateResult,
} from '../../../entities/CoresaMercadoLibre';
import { toNumber } from '../../../utils/coresaPriceStock';

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

  /**
   * Los endpoints de escritura de meli-api piden x-internal-api-key
   * (SOLED_INTERNAL_API_KEY), no la MERCADOLIBRE_API_KEY de los endpoints
   * viejos de lectura: con esa responden 401.
   */
  private get apiKey(): string {
    return String(
      process.env.MELI_API_INTERNAL_KEY ?? process.env.INTERNAL_API_KEY ?? '',
    ).trim();
  }

  private get timeout(): number {
    return Number(process.env.MERCADOLIBRE_API_TIMEOUT_MS ?? 30000);
  }

  private prepareRequest(
    path: string,
    query: Record<string, string | number> = {},
    data?: unknown,
  ): AxiosRequestConfig {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) headers['x-internal-api-key'] = this.apiKey;

    const config: AxiosRequestConfig = {
      method: data !== undefined ? 'PUT' : 'GET',
      url: `${this.apiUrl.replace(/\/$/, '')}${path}`,
      headers,
      params: query,
      timeout: this.timeout,
    };
    if (data !== undefined) config.data = data;
    return config;
  }

  /** Un campo que ML no devolvió queda sin valor, no en 0. */
  private readApplied(
    payload: Record<string, unknown> | null | undefined,
    field: 'price' | 'available_quantity',
  ): number | undefined {
    if (!payload) return undefined;
    const raw = payload[field];
    if (raw === undefined || raw === null) return undefined;
    return toNumber(raw);
  }

  /**
   * meli-api devuelve requested/applied/changed desde el 26/09. Si llegara
   * una respuesta vieja, sin esos campos, se asume que impactó: es lo que
   * se asumía antes de tener el dato.
   */
  private mapUpdateResult(
    mla: string,
    patch: MeliListingUpdate,
    payload: unknown,
  ): MeliListingUpdateResult {
    const body = (payload ?? {}) as Record<string, unknown>;
    if (!('applied' in body) && !('changed' in body)) {
      return { meli_item_id: mla, requested: patch, changed: true };
    }

    const applied = body.applied as Record<string, unknown> | null | undefined;
    const appliedPatch: MeliListingUpdate = {};
    if (patch.price !== undefined) {
      const value = this.readApplied(applied, 'price');
      if (value !== undefined) appliedPatch.price = value;
    }
    if (patch.available_quantity !== undefined) {
      const value = this.readApplied(applied, 'available_quantity');
      if (value !== undefined) appliedPatch.available_quantity = value;
    }

    return {
      meli_item_id:
        typeof body.meli_item_id === 'string' ? body.meli_item_id : mla,
      status: typeof body.status === 'string' ? body.status : undefined,
      sub_status: Array.isArray(body.sub_status)
        ? (body.sub_status as string[])
        : undefined,
      requested: patch,
      applied: appliedPatch,
      changed: body.changed === true,
    };
  }

  async updateListing(
    mla: string,
    patch: MeliListingUpdate,
  ): Promise<MeliListingUpdateResult> {
    const body: MeliListingUpdate = {};
    if (patch.price !== undefined) body.price = patch.price;
    if (patch.available_quantity !== undefined) {
      body.available_quantity = patch.available_quantity;
    }
    if (body.price === undefined && body.available_quantity === undefined) {
      return { meli_item_id: mla, requested: {}, changed: false };
    }

    const itemId = encodeURIComponent(mla);
    const config = this.prepareRequest(`/meli/items/${itemId}`, {}, body);
    const response = await this.axios.request(config);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(
        `[meli-api] updateListing ${mla} -> ${response.status}: ${JSON.stringify(response.data)}`,
      );
    }

    return this.mapUpdateResult(mla, body, response.data);
  }
}
