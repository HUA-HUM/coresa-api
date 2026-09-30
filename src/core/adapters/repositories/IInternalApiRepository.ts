import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  FinancingCost,
  FinancingCostChanges,
  NewFinancingCost,
} from '../../entities/FinancingCost';
import {
  CoresaListingVariantInput,
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
  /** Los costos de financiación vigentes, para cotizar las cuotas. */
  listFinancingCosts(): Promise<FinancingCost[]>;
  updateFinancingCost(
    modalidad: string,
    changes: FinancingCostChanges,
  ): Promise<FinancingCost | null>;
  createFinancingCost(cost: NewFinancingCost): Promise<FinancingCost | null>;
  /** Las variantes ya publicadas de un SKU, para no publicar dos veces la misma. */
  listVariantsBySku(sku: string): Promise<CoresaProductInMercadoLibre[]>;
  upsertProductInMercadoLibre(
    sku: string,
    mla: string,
    fields?: CoresaListingVariantInput,
  ): Promise<void>;
  recordSyncChanges(
    runId: number | null,
    source: 'cron' | 'manual',
    changes: CoresaSyncChange[],
  ): Promise<number>;
}

export const IInternalApiRepositoryToken = Symbol('IInternalApiRepository');
