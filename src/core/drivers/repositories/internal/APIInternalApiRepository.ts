import { Logger } from '@nestjs/common';
import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { CoresaProduct } from '../../../entities/CoresaProduct';
import {
  CoresaProductInMercadoLibre,
  CoresaSyncChange,
  MercadoLibreProductSnapshot,
  mapCoresaProduct,
  mapCoresaProductsInMercadoLibre,
  mapMercadoLibreProductSnapshot,
  unwrapList,
} from '../../../entities/CoresaMercadoLibre';

export class APIInternalApiRepository {
  private readonly logger = new Logger(APIInternalApiRepository.name);

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

  private get syncChangesChunkSize(): number {
    const size = Number(process.env.INTERNAL_API_CHANGES_CHUNK_SIZE ?? 500);
    return Number.isFinite(size) && size > 0 ? size : 500;
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

  private readTotal(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }
    const pagination = (payload as Record<string, unknown>).pagination;
    if (
      !pagination ||
      typeof pagination !== 'object' ||
      Array.isArray(pagination)
    ) {
      return null;
    }
    const total = (pagination as Record<string, unknown>).total;
    return typeof total === 'number' ? total : null;
  }

  async listCoresaProductsInMercadoLibre(): Promise<
    CoresaProductInMercadoLibre[]
  > {
    const limit = this.pageLimit;
    const links: CoresaProductInMercadoLibre[] = [];
    let offset = 0;

    while (offset <= limit * 500) {
      const config = this.prepareRequest(
        '/internal/coresa/products-in-mercadolibre',
        { limit, offset },
      );
      const response = await this.request(config);
      if (response.status < 200 || response.status >= 300) {
        throw new Error(
          `[internal-api] products-in-mercadolibre -> ${response.status}: ${JSON.stringify(response.data)}`,
        );
      }

      const mapped = mapCoresaProductsInMercadoLibre(response.data);
      links.push(...mapped);

      const pageItems = unwrapList(response.data).length;
      if (pageItems === 0) break;

      offset += pageItems;
      const total = this.readTotal(response.data);
      if (total !== null) {
        if (offset >= total) break;
      } else if (pageItems < limit) {
        break;
      }
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

  /**
   * Abre la corrida en process_runs. Si internal-api no responde, la
   * sincronización tiene que seguir igual: el registro es para auditar, no
   * puede ser el que rompa el proceso.
   */
  async startProcessRun(
    processName: string,
    triggerType: 'cron' | 'manual',
  ): Promise<number | null> {
    try {
      const config = this.prepareRequest(
        '/internal/process-runs',
        {},
        { processName, triggerType },
      );
      const response = await this.request(config);
      const id = Number((response.data as { id?: number })?.id);
      return Number.isInteger(id) && id > 0 ? id : null;
    } catch (err) {
      this.warnRegistro('no se pudo abrir la corrida', err);
      return null;
    }
  }

  async finishProcessRun(
    id: number,
    status: 'completed' | 'failed',
    summary: unknown,
    errorMessage?: string | null,
  ): Promise<void> {
    try {
      const config = this.prepareRequest(
        `/internal/process-runs/${id}`,
        {},
        { status, summary, errorMessage: errorMessage ?? null },
      );
      config.method = 'PATCH';
      await this.request(config);
    } catch (err) {
      this.warnRegistro(`no se pudo cerrar la corrida ${id}`, err);
    }
  }

  /**
   * Historial de cambios de precio y stock. Se manda en lotes; devuelve
   * cuántas filas quedaron registradas. Si el endpoint todavía no existe
   * (404), no se registra nada y el sync sigue.
   */
  async recordSyncChanges(
    runId: number | null,
    source: 'cron' | 'manual',
    changes: CoresaSyncChange[],
  ): Promise<number> {
    if (changes.length === 0) return 0;

    let inserted = 0;
    for (const batch of this.chunk(changes, this.syncChangesChunkSize)) {
      try {
        const config = this.prepareRequest(
          '/internal/coresa/meli-sync-changes/bulk',
          {},
          { runId, source, changes: batch },
        );
        const response = await this.request(config);
        const count = Number(
          (response.data as { inserted?: number })?.inserted ?? batch.length,
        );
        inserted += Number.isFinite(count) ? count : batch.length;
      } catch (err) {
        this.warnRegistro('no se pudieron registrar los cambios', err);
        break;
      }
    }
    return inserted;
  }

  private warnRegistro(mensaje: string, err: unknown): void {
    const detalle = err instanceof Error ? err.message : String(err);
    this.logger.warn(`[internal-api] ${mensaje}: ${detalle}`);
  }
}
