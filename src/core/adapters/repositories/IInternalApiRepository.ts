import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  CoresaProductInMercadoLibre,
  CoresaSyncChange,
  MercadoLibreProductSnapshot,
} from '../../entities/CoresaMercadoLibre';

export interface IInternalApiRepository {
  upsertCoresaProducts(products: CoresaProduct[]): Promise<void>;
  listCoresaProductsInMercadoLibre(): Promise<CoresaProductInMercadoLibre[]>;
  getCoresaProductBySku(sku: string): Promise<CoresaProduct | null>;
  getMercadoLibreProductByMla(
    mla: string,
  ): Promise<MercadoLibreProductSnapshot | null>;
  startProcessRun(
    processName: string,
    triggerType: 'cron' | 'manual',
  ): Promise<number | null>;
  finishProcessRun(
    id: number,
    status: 'completed' | 'failed',
    summary: unknown,
    errorMessage?: string | null,
  ): Promise<void>;
  recordSyncChanges(
    runId: number | null,
    source: 'cron' | 'manual',
    changes: CoresaSyncChange[],
  ): Promise<number>;
}

export const IInternalApiRepositoryToken = Symbol('IInternalApiRepository');
