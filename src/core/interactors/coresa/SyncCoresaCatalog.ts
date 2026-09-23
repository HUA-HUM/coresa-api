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
  IMercadoLibreRepository,
  IMercadoLibreRepositoryToken,
} from '../../adapters/repositories/IMercadoLibreRepository';
import { BrandCatalog } from '../../entities/BrandCatalog';
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  isActiveMeliStatus,
  MeliListingProduct,
} from '../../entities/MeliListingProduct';
import {
  getDiscountPercent,
  getMeliSellerId,
  mapCoresaToMeliListing,
} from '../../utils/coresaPriceStock';
import { mapWithConcurrency } from '../../utils/mapWithConcurrency';
import { SyncCoresaProductsToInternalApi } from './SyncCoresaProductsToInternalApi';

@Injectable()
export class SyncCoresaCatalog {
  private readonly logger = new Logger(SyncCoresaCatalog.name);

  constructor(
    @Inject(ICoresaRepositoryToken)
    private readonly coresaRepo: ICoresaRepository,
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
    @Inject(IMercadoLibreRepositoryToken)
    private readonly mercadoLibreRepo: IMercadoLibreRepository,
    @Inject(IExchangeRateRepositoryToken)
    private readonly exchangeRate: IExchangeRateRepository,
    private readonly syncInternal: SyncCoresaProductsToInternalApi,
  ) {}

  private get bySkuConcurrency(): number {
    return Number(process.env.INTERNAL_API_BY_SKU_CONCURRENCY ?? 10);
  }

  async execute(): Promise<{
    total: number;
    brands: BrandCatalog[];
    activeForMeli: number;
    upserted: number;
    meliItemIdsSample: string[];
  }> {
    const products = await this.coresaRepo.getAllProducts();
    const brands = this.productsByBrand(products);

    this.logger.log(
      `[Coresa] ${products.length} productos, marcas: ${brands
        .map((b) => `${b.brand} (${b.products.length})`)
        .join(', ')}`,
    );

    // Comentar esta línea para mandar todas las marcas a ML.
    const forMeli = products.filter(
      (p) =>
        String(p.Marca ?? '')
          .trim()
          .toUpperCase() === 'JADEVER',
    );

    const [usdBna, matches] = await Promise.all([
      this.exchangeRate.getUsdBnaSell(),
      this.findActiveMatches(forMeli),
    ]);

    const discountPercent = getDiscountPercent();
    const sellerId = getMeliSellerId();
    const listings: MeliListingProduct[] = [];
    for (const match of matches) {
      const mapped = mapCoresaToMeliListing(
        match.product,
        match.meli_item_id,
        usdBna,
        sellerId,
        discountPercent,
      );
      if (!mapped) {
        const sku = String(match.product.SKU ?? '').trim() || '(sin SKU)';
        this.logger.warn(
          `[internal-api] SKU ${sku} sin MLA o precio válido, se omite`,
        );
        continue;
      }
      listings.push(mapped);
    }

    this.logger.log(`[Coresa] USD BNA venta: ${usdBna}`);
    this.logger.log(`[Coresa] ${listings.length} publicaciones ML activas`);

    const upserted = await this.syncInternal.execute(listings);
    await this.mercadoLibreRepo.updateListings(listings);

    return {
      total: products.length,
      brands,
      activeForMeli: listings.length,
      upserted,
      meliItemIdsSample: listings.slice(0, 20).map((item) => item.meli_item_id),
    };
  }

  private async findActiveMatches(
    products: CoresaProduct[],
  ): Promise<{ product: CoresaProduct; meli_item_id: string }[]> {
    const matches = await mapWithConcurrency(
      products,
      this.bySkuConcurrency,
      async (product) => {
        const sku = String(product.SKU ?? '').trim();
        if (!sku) {
          this.logger.warn('[Coresa] producto sin SKU, se omite lookup ML');
          return null;
        }

        try {
          const lookup = await this.internalApi.getProductBySku(sku);
          if (!lookup || !isActiveMeliStatus(lookup.status)) return null;
          const meli_item_id = String(lookup.meli_item_id ?? '').trim();
          if (!meli_item_id) return null;
          return { product, meli_item_id };
        } catch (err) {
          this.logger.warn(
            `[internal-api] by-sku ${sku} falló: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      },
    );

    return matches.filter(
      (item): item is { product: CoresaProduct; meli_item_id: string } =>
        item !== null,
    );
  }

  private productsByBrand(products: CoresaProduct[]): BrandCatalog[] {
    const byBrand = new Map<string, CoresaProduct[]>();
    for (const product of products) {
      const brand =
        String(product.Marca ?? '')
          .trim()
          .toUpperCase() || 'UNKNOWN';
      const list = byBrand.get(brand) ?? [];
      list.push(product);
      byBrand.set(brand, list);
    }
    return [...byBrand.entries()].map(([brand, brandProducts]) => ({
      brand,
      products: brandProducts,
    }));
  }
}
