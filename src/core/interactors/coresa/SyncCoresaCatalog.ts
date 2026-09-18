import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  ICoresaRepository,
  ICoresaRepositoryToken,
} from '../../adapters/repositories/ICoresaRepository';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import {
  IMercadoLibreRepository,
  IMercadoLibreRepositoryToken,
} from '../../adapters/repositories/IMercadoLibreRepository';
import { ActiveMeliListing } from '../../entities/ActiveMeliListing';
import { BrandCatalog } from '../../entities/BrandCatalog';
import { CoresaProduct } from '../../entities/CoresaProduct';
import { isActiveMeliStatus } from '../../entities/InternalMeliProduct';
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
    private readonly syncInternal: SyncCoresaProductsToInternalApi,
  ) {}

  private get bySkuConcurrency(): number {
    return Number(process.env.INTERNAL_API_BY_SKU_CONCURRENCY ?? 10);
  }

  async execute(): Promise<{
    total: number;
    brands: BrandCatalog[];
    activeForMeli: number;
    meliItemIdsSample: string[];
  }> {
    const products = await this.coresaRepo.getAllProducts();
    const brands = this.productsByBrand(products);

    this.logger.log(
      `[Coresa] ${products.length} productos, marcas: ${brands
        .map((b) => `${b.brand} (${b.products.length})`)
        .join(', ')}`,
    );

    const activeForMeli = await this.classifyActiveForMeli(products);

    this.logger.log(
      `[Coresa] ${activeForMeli.length} publicaciones ML activas (meli-api pendiente)`,
    );

    await this.syncInternal.execute(products);

    // Listo para pegarle a meli-api:
    // await this.mercadoLibreRepo.updateListings(activeForMeli);

    return {
      total: products.length,
      brands,
      activeForMeli: activeForMeli.length,
      meliItemIdsSample: activeForMeli
        .slice(0, 20)
        .map((item) => item.meli_item_id),
    };
  }

  private async classifyActiveForMeli(
    products: CoresaProduct[],
  ): Promise<ActiveMeliListing[]> {
    const listings = await mapWithConcurrency(
      products,
      this.bySkuConcurrency,
      async (product) => {
        const sku = String(product.SKU ?? '').trim();
        if (!sku) {
          this.logger.warn('[Coresa] producto sin SKU, se omite lookup ML');
          return null;
        }

        try {
          const internal = await this.internalApi.getProductBySku(sku);
          if (!internal || !isActiveMeliStatus(internal.status)) return null;
          return {
            product,
            meli_item_id: internal.meli_item_id ?? '',
          };
        } catch (err) {
          this.logger.warn(
            `[internal-api] by-sku ${sku} falló: ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        }
      },
    );

    return listings.filter((item): item is ActiveMeliListing => item !== null);
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
