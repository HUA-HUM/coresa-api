import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import {
  IMercadoLibreRepository,
  IMercadoLibreRepositoryToken,
} from '../../adapters/repositories/IMercadoLibreRepository';
import {
  CoresaProductInMercadoLibre,
  CoresaSyncChange,
  MeliListingUpdate,
  SyncChangeResult,
} from '../../entities/CoresaMercadoLibre';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';
import { toNumber } from '../../utils/coresaPriceStock';

export const PROCESS_NAME = 'coresa_meli_sync';

export type SyncItemResult = SyncChangeResult | 'unchanged' | 'skipped';

export class SyncItemDetail {
  sku: string;
  mla: string;
  result: SyncItemResult;
  reason?: string;
  change?: CoresaSyncChange;
}

export class SyncToMercadoLibreSummary {
  runId: number | null;
  listings: number;
  updated: number;
  notApplied: number;
  unchanged: number;
  skipped: number;
  failed: number;
  registered: number;
  items: SyncItemDetail[];
}

@Injectable()
export class SyncCoresaProductsToMercadoLibreApi {
  private readonly logger = new Logger(
    SyncCoresaProductsToMercadoLibreApi.name,
  );

  constructor(
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
    @Inject(IMercadoLibreRepositoryToken)
    private readonly mercadoLibreRepo: IMercadoLibreRepository,
  ) {}

  private get bySkuConcurrency(): number {
    return Number(process.env.INTERNAL_API_BY_SKU_CONCURRENCY ?? 10);
  }

  async execute(
    source: 'cron' | 'manual' = 'manual',
  ): Promise<SyncToMercadoLibreSummary> {
    const runId = await this.internalApi.startProcessRun(PROCESS_NAME, source);

    try {
      const summary = await this.run(runId, source);
      if (runId !== null) {
        await this.internalApi.finishProcessRun(runId, 'completed', {
          ...summary,
          items: undefined,
        });
      }
      return summary;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (runId !== null) {
        await this.internalApi.finishProcessRun(runId, 'failed', null, message);
      }
      throw err;
    }
  }

  private async run(
    runId: number | null,
    source: 'cron' | 'manual',
  ): Promise<SyncToMercadoLibreSummary> {
    const links = await this.internalApi.listCoresaProductsInMercadoLibre();
    const items = await mapWithConcurrency(
      links,
      this.bySkuConcurrency,
      (link) => this.syncOne(link),
    );

    const count = (result: SyncItemResult): number =>
      items.filter((item) => item.result === result).length;

    const changes = items
      .map((item) => item.change)
      .filter((change): change is CoresaSyncChange => change !== undefined);

    const registered = await this.internalApi.recordSyncChanges(
      runId,
      source,
      changes,
    );

    const summary: SyncToMercadoLibreSummary = {
      runId,
      listings: links.length,
      updated: count('updated'),
      notApplied: count('not_applied'),
      unchanged: count('unchanged'),
      skipped: count('skipped'),
      failed: count('failed'),
      registered,
      items,
    };

    this.logger.log(
      `[meli] ${summary.listings} publicaciones: ${summary.updated} actualizadas, ` +
        `${summary.notApplied} sin impacto, ${summary.unchanged} sin cambios, ` +
        `${summary.failed} fallidas (${registered} registradas)`,
    );

    return summary;
  }

  private async syncOne(
    link: CoresaProductInMercadoLibre,
  ): Promise<SyncItemDetail> {
    const sku = link.sku.trim();
    const mla = link.mla.trim();
    if (!sku || !mla) {
      this.logger.warn('[meli] fila sin SKU o MLA, se omite');
      return { sku, mla, result: 'skipped', reason: 'fila sin SKU o MLA' };
    }

    try {
      const [desired, current] = await Promise.all([
        this.internalApi.getCoresaProductBySku(sku),
        this.internalApi.getMercadoLibreProductByMla(mla),
      ]);

      if (!desired) {
        return {
          sku,
          mla,
          result: 'skipped',
          reason: 'el SKU no está en coresa_products',
        };
      }
      if (!current) {
        return {
          sku,
          mla,
          result: 'skipped',
          reason: 'el MLA no está en mercadolibre_products',
        };
      }

      const priceBefore = Math.round(toNumber(current.price));
      const stockBefore = Math.floor(toNumber(current.available_quantity));
      const patch: MeliListingUpdate = {};

      if (link.updatePrice) {
        const price = Math.round(toNumber(desired.Precio_Convertido));
        if (price > 0 && price !== priceBefore) patch.price = price;
      }
      if (link.updateStock) {
        const stock = Math.floor(toNumber(desired.Disponible));
        if (stock !== stockBefore) patch.available_quantity = stock;
      }

      if (patch.price === undefined && patch.available_quantity === undefined) {
        return { sku, mla, result: 'unchanged' };
      }

      const applied = await this.mercadoLibreRepo.updateListing(mla, patch);
      const result: SyncChangeResult = applied.changed
        ? 'updated'
        : 'not_applied';

      if (result === 'not_applied') {
        this.logger.warn(
          `[meli] ${mla} (${sku}): ML aceptó el pedido pero no lo aplicó`,
        );
      }

      return {
        sku,
        mla,
        result,
        change: {
          sku,
          mla,
          result,
          priceBefore: patch.price === undefined ? null : priceBefore,
          priceRequested: patch.price ?? null,
          priceApplied: applied.applied?.price ?? null,
          stockBefore:
            patch.available_quantity === undefined ? null : stockBefore,
          stockRequested: patch.available_quantity ?? null,
          stockApplied: applied.applied?.available_quantity ?? null,
          meliStatus: applied.status ?? null,
          meliSubStatus: applied.sub_status ?? null,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[meli] ${mla} (${sku}) falló: ${message}`);

      return {
        sku,
        mla,
        result: 'failed',
        reason: message,
        change: {
          sku,
          mla,
          result: 'failed',
          errorCode: 'MELI_UPDATE_ERROR',
          errorMessage: message,
        },
      };
    }
  }
}
