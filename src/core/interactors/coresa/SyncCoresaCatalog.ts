import { randomUUID } from 'crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ICoresaRepository,
  ICoresaRepositoryToken,
} from '../../adapters/repositories/ICoresaRepository';
import {
  IExchangeRateRepository,
  IExchangeRateRepositoryToken,
} from '../../adapters/repositories/IExchangeRateRepository';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import {
  CoresaDiscontinuedSweep,
  CoresaProduct,
} from '../../entities/CoresaProduct';
import {
  getDiscountPercent,
  priceCoresaProduct,
} from '../../utils/coresaPriceStock';

/**
 * Piso de cordura para el barrido. Hoy el catálogo de Coresa tiene más de
 * 6000 SKUs; si una corrida trae menos que esto, la respuesta vino cortada y
 * barrer sería apagar la tienda por un problema del proveedor.
 */
const DEFAULT_MIN_CATALOG_SIZE = 1000;

/**
 * Cuántas bajas acepta una corrida sin que nadie la mire. Si el barrido fuera
 * a dar de baja más que esto, no se toca nada y se avisa con el número: lo
 * decide una persona, no el cron.
 */
const DEFAULT_MAX_DISCONTINUED = 500;

export class SyncCoresaCatalogResult {
  total: number;
  upserted: number;
  skipped: number;
  /**
   * Cuántos SKUs quedaron en stock 0 porque Coresa dejó de ofrecerlos.
   * null cuando el barrido no corrió, y entonces motivo dice por qué.
   */
  discontinued: number | null;
  discontinuedReason?: string;
  discontinuedSkus?: string[];
}

/** Lo que el barrido agrega al resumen de la corrida. */
type DiscontinuedOutcome = Pick<
  SyncCoresaCatalogResult,
  'discontinued' | 'discontinuedReason' | 'discontinuedSkus'
>;

@Injectable()
export class SyncCoresaCatalog {
  private readonly logger = new Logger(SyncCoresaCatalog.name);

  constructor(
    @Inject(ICoresaRepositoryToken)
    private readonly coresaRepo: ICoresaRepository,
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
    @Inject(IExchangeRateRepositoryToken)
    private readonly exchangeRate: IExchangeRateRepository,
  ) {}

  private get minCatalogSize(): number {
    const size = Number(
      process.env.CORESA_MIN_CATALOG_SIZE ?? DEFAULT_MIN_CATALOG_SIZE,
    );
    return Number.isFinite(size) && size >= 0 ? size : DEFAULT_MIN_CATALOG_SIZE;
  }

  private get maxDiscontinued(): number {
    const max = Number(
      process.env.CORESA_MAX_DISCONTINUED ?? DEFAULT_MAX_DISCONTINUED,
    );
    return Number.isFinite(max) && max >= 0 ? max : DEFAULT_MAX_DISCONTINUED;
  }

  async execute(): Promise<SyncCoresaCatalogResult> {
    // Marca las filas que ve esta corrida. Después el barrido da de baja lo
    // que no quedó marcado, sin comparar relojes con la base.
    const runId = randomUUID();
    const products = await this.coresaRepo.getAllProducts();
    const usdBna = await this.exchangeRate.getUsdBnaSell();
    const discountPercent = getDiscountPercent();

    const priced: CoresaProduct[] = [];
    let skipped = 0;

    for (const product of products) {
      const mapped = priceCoresaProduct(product, usdBna, discountPercent);
      if (!mapped) {
        skipped += 1;
        //const sku = String(product.SKU ?? '').trim() || '(sin SKU)';
        //const brand = String(product.Marca ?? '').trim() || '(sin marca)';
        //this.logger.warn(
        //  `[Coresa] SKU ${sku} (${brand}) omitido: sin precio, IVA o fórmula de marca`,
        //);
        continue;
      }
      priced.push(mapped);
    }

    this.logger.log(`[Coresa] USD BNA venta: ${usdBna}`);
    this.logger.log(
      `[Coresa] ${priced.length} productos para coresa_products, ${skipped} omitidos`,
    );

    await this.internalApi.upsertCoresaProducts(priced, runId);

    const sweep = await this.sweepDiscontinued(runId, products.length);

    return {
      total: products.length,
      upserted: priced.length,
      skipped,
      ...sweep,
    };
  }

  /**
   * Da de baja lo que Coresa dejó de ofrecer.
   *
   * Coresa no informa los productos sin stock en 0: los saca del catálogo. Y
   * el upsert solo toca lo que llegó, así que sin este paso la fila se queda
   * con el último stock informado y el actualizador lo sostiene en ML. En
   * noviembre de 2026 había 19 publicaciones activas con stock que Coresa no
   * podía despachar, una con 387 unidades.
   *
   * Es el único paso del sync que puede apagar ventas, así que va con dos
   * frenos: no corre si la corrida vino corta, y no corre si fuera a dar de
   * baja más de lo esperado.
   */
  private async sweepDiscontinued(
    runId: string,
    fetched: number,
  ): Promise<DiscontinuedOutcome> {
    const minimum = this.minCatalogSize;
    if (fetched < minimum) {
      const reason =
        `la corrida trajo ${fetched} productos, menos que el piso de ${minimum}: ` +
        'se omite el barrido para no dar de baja medio catálogo por una respuesta cortada';
      this.logger.warn(`[Coresa] ${reason}`);
      return { discontinued: null, discontinuedReason: reason };
    }

    let sweep: CoresaDiscontinuedSweep | null;
    try {
      sweep = await this.internalApi.markCoresaProductsUnavailable(
        runId,
        this.maxDiscontinued,
      );
    } catch (err) {
      // El catálogo ya quedó actualizado: que falle el barrido no tiene por
      // qué perder esa corrida entera.
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `[Coresa] falló el barrido de discontinuados: ${reason}`,
      );
      return { discontinued: null, discontinuedReason: reason };
    }

    if (!sweep) {
      const reason =
        'internal-api todavía no tiene POST /internal/coresa/products/mark-unavailable';
      this.logger.warn(`[Coresa] ${reason}: el stock discontinuado sigue vivo`);
      return { discontinued: null, discontinuedReason: reason };
    }

    if (sweep.refused) {
      const reason =
        `el barrido daría de baja ${sweep.wouldUpdate ?? 'más'} SKUs y el tope es ` +
        `${this.maxDiscontinued}: no se tocó nada. Revisalo y subí CORESA_MAX_DISCONTINUED si está bien`;
      this.logger.warn(`[Coresa] ${reason}`);
      return { discontinued: null, discontinuedReason: reason };
    }

    if (sweep.updated > 0) {
      this.logger.log(
        `[Coresa] ${sweep.updated} SKUs dados de baja: Coresa ya no los ofrece`,
      );
    }

    return {
      discontinued: sweep.updated,
      discontinuedSkus: sweep.skus.length > 0 ? sweep.skus : undefined,
    };
  }
}
