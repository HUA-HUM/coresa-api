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
  MeliListingUpdate,
} from '../../entities/CoresaMercadoLibre';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';
import { toNumber } from '../../utils/coresaPriceStock';

type SyncOneResult = 'updated' | 'skipped' | 'failed';

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

  async execute(): Promise<{
    listings: number;
    updated: number;
    skipped: number;
    failed: number;
  }> {
    const links = await this.internalApi.listCoresaProductsInMercadoLibre();
    const results = await mapWithConcurrency(
      links,
      this.bySkuConcurrency,
      (link) => this.syncOne(link),
    );

    const updated = results.filter((item) => item === 'updated').length;
    const failed = results.filter((item) => item === 'failed').length;
    const skipped = results.length - updated - failed;

    this.logger.log(
      `[meli] ${links.length} publicaciones, ${updated} actualizadas, ${skipped} sin cambios, ${failed} fallidas`,
    );

    return {
      listings: links.length,
      updated,
      skipped,
      failed,
    };
  }

  private async syncOne(
    link: CoresaProductInMercadoLibre,
  ): Promise<SyncOneResult> {
    const sku = link.sku.trim();
    const mla = link.mla.trim();
    if (!sku || !mla) {
      this.logger.warn('[meli] fila sin SKU o MLA, se omite');
      return 'skipped';
    }

    try {
      const [desired, current] = await Promise.all([
        this.internalApi.getCoresaProductBySku(sku),
        this.internalApi.getMercadoLibreProductByMla(mla),
      ]);

      if (!desired) {
        this.logger.warn(`[meli] SKU ${sku} no está en coresa_products`);
        return 'skipped';
      }
      if (!current) {
        this.logger.warn(`[meli] MLA ${mla} no está en mercadolibre_products`);
        return 'skipped';
      }

      const patch: MeliListingUpdate = {};
      if (link.updatePrice) {
        const price = Math.round(toNumber(desired.Precio_Convertido));
        const currentPrice = Math.round(toNumber(current.price));
        if (price > 0 && price !== currentPrice) patch.price = price;
      }
      if (link.updateStock) {
        const stock = Math.floor(toNumber(desired.Disponible));
        const currentStock = Math.floor(toNumber(current.available_quantity));
        if (stock !== currentStock) patch.available_quantity = stock;
      }

      if (patch.price === undefined && patch.available_quantity === undefined) {
        return 'skipped';
      }

      await this.mercadoLibreRepo.updateListing(mla, patch);
      return 'updated';
    } catch (err) {
      this.logger.warn(
        `[meli] ${mla} (${sku}) falló: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 'failed';
    }
  }
}
