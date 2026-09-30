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
  MeliUpdateError,
  SyncChangeResult,
} from '../../entities/CoresaMercadoLibre';
import {
  baseUnitsOf,
  PublicationVariant,
  variantPrice,
  variantStock,
} from '../../entities/PublicationVariant';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';
import { toNumber } from '../../utils/coresaPriceStock';

export const PROCESS_NAME = 'coresa_meli_sync';

/**
 * Tope de cuánto puede moverse un precio en una corrida. Un salto más grande
 * que esto casi siempre es un dato mal compuesto, no un cambio de lista: en
 * septiembre de 2026 una publicación de una unidad recibió el precio de la
 * caja de 100 y se fue de $9.192 a $919.209. Se frena y se avisa.
 */
const DEFAULT_MAX_PRICE_JUMP = 2;

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

  private get maxPriceJump(): number {
    const jump = Number(
      process.env.SYNC_MAX_PRICE_JUMP ?? DEFAULT_MAX_PRICE_JUMP,
    );
    return Number.isFinite(jump) && jump > 1 ? jump : DEFAULT_MAX_PRICE_JUMP;
  }

  /** Un precio nuevo que multiplica o divide por más del tope no se manda. */
  private isPriceJumpTooBig(before: number, next: number): boolean {
    if (!(before > 0) || !(next > 0)) return false;
    const jump = this.maxPriceJump;
    return next > before * jump || next * jump < before;
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

    // Sin la variante no se sabe si la publicación vende de a 1 o de a 100, y
    // mandarle el precio del empaque a una publicación de una unidad es
    // justamente el error que este dato viene a evitar. Las filas heredadas
    // caen acá y se quedan quietas hasta que alguien las complete.
    if (!(link.unitsPerListing !== null && link.unitsPerListing >= 1)) {
      return {
        sku,
        mla,
        result: 'skipped',
        reason:
          'la fila no tiene cargada la variante (units_per_listing vacío)',
      };
    }

    // El factor que manda es el guardado en la fila, no el que saldría de la
    // modalidad. La modalidad dice qué cuotas ofrece ML; si ese costo está o
    // no cargado en el precio es una decisión comercial, fila por fila. En el
    // catálogo de hoy la mayoría de las publicaciones con 3, 9 o 12 cuotas
    // están al precio de contado: derivar el factor acá les subiría el precio
    // hasta un 27% en la primera corrida, sin que nadie lo haya pedido.
    //
    // El publicador sí deriva el factor de la modalidad, que es donde va la
    // regla: una publicación nueva nace con el costo de la financiación
    // cubierto.
    const variant: PublicationVariant = {
      listingType: link.listingType ?? 'gold_special',
      unitsPerListing: link.unitsPerListing,
      modalidad: link.modalidad ?? 'contado',
      priceFactor: link.priceFactor,
    };

    // Se declaran afuera del try para que la fila de error pueda registrar
    // qué se intentó mandar: sin eso, no se sabe si era precio o stock.
    const patch: MeliListingUpdate = {};
    let priceBefore: number | null = null;
    let stockBefore: number | null = null;

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

      priceBefore = Math.round(toNumber(current.price));
      stockBefore = Math.floor(toNumber(current.available_quantity));

      let blocked: string | null = null;

      if (link.updatePrice) {
        // El precio de esta publicación se compone a partir del precio base
        // del SKU: precio unitario x unidades de la publicación x recargo.
        const price = variantPrice(
          Math.round(toNumber(desired.Precio_Convertido)),
          baseUnitsOf(desired),
          variant,
        );
        if (price > 0 && price !== priceBefore) {
          if (this.isPriceJumpTooBig(priceBefore, price)) {
            blocked = `precio frenado: ${priceBefore} -> ${price} supera el tope de x${this.maxPriceJump}`;
            this.logger.warn(`[meli] ${mla} (${sku}): ${blocked}`);
          } else {
            patch.price = price;
          }
        }
      }
      if (link.updateStock) {
        const stock = variantStock(
          toNumber(desired.Disponible),
          variant.unitsPerListing,
        );
        if (stock !== stockBefore) patch.available_quantity = stock;
      }

      if (patch.price === undefined && patch.available_quantity === undefined) {
        return blocked
          ? { sku, mla, result: 'skipped', reason: blocked }
          : { sku, mla, result: 'unchanged' };
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
        reason: blocked ?? undefined,
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
      const isMeliError = err instanceof MeliUpdateError;
      const errorCode = isMeliError ? err.code : 'MELI_UPDATE_ERROR';
      const detail = isMeliError
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err);

      this.logger.warn(
        `[meli] ${mla} (${sku}) falló [${errorCode}]: ${detail}`,
      );

      return {
        sku,
        mla,
        result: 'failed',
        reason: detail,
        change: {
          sku,
          mla,
          result: 'failed',
          priceBefore: patch.price === undefined ? null : priceBefore,
          priceRequested: patch.price ?? null,
          priceApplied: null,
          stockBefore:
            patch.available_quantity === undefined ? null : stockBefore,
          stockRequested: patch.available_quantity ?? null,
          stockApplied: null,
          errorCode,
          errorMessage: detail,
        },
      };
    }
  }
}
