import {
  CoresaDiscontinuedSweep,
  CoresaProduct,
} from '../../entities/CoresaProduct';
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
  /**
   * runId marca las filas que vio esta corrida. Es lo que después le permite
   * al barrido distinguir lo que sigue en el catálogo de lo que se terminó,
   * sin depender de que el reloj del droplet y el de la base coincidan.
   */
  upsertCoresaProducts(products: CoresaProduct[], runId: string): Promise<void>;
  /**
   * Pone en 0 el stock de todo lo que no quedó marcado con runId, o sea lo
   * que Coresa dejó de ofrecer.
   *
   * maxUpdates es el freno: si el barrido fuera a dar de baja más filas que
   * eso, el servidor no toca nada e informa cuántas eran. Una corrida que
   * trajo medio catálogo no puede apagar media tienda sin que alguien lo mire.
   *
   * Devuelve null si internal-api todavía no tiene el endpoint, para poder
   * desplegar de este lado sin esperarlos.
   */
  markCoresaProductsUnavailable(
    runId: string,
    maxUpdates: number,
  ): Promise<CoresaDiscontinuedSweep | null>;
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
  /** Saca la publicación del actualizador. */
  unlinkProductInMercadoLibre(mla: string): Promise<void>;
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
