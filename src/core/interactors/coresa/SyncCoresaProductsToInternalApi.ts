import { Inject, Injectable, Logger } from '@nestjs/common';
import { ActiveMeliListing } from '../../entities/ActiveMeliListing';
import { InternalMeliBulkProduct } from '../../entities/InternalMeliBulkProduct';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import {
  getDiscountPercent,
  mapListingToBulkProduct,
} from '../../utils/coresaPriceStock';

@Injectable()
export class SyncCoresaProductsToInternalApi {
  private readonly logger = new Logger(SyncCoresaProductsToInternalApi.name);

  constructor(
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  async execute(
    listings: ActiveMeliListing[],
    usdBna: number,
    sellerId: string,
  ): Promise<number> {
    const discountPercent = getDiscountPercent();
    const products: InternalMeliBulkProduct[] = [];

    for (const listing of listings) {
      const mapped = mapListingToBulkProduct(
        listing,
        usdBna,
        sellerId,
        discountPercent,
      );
      if (!mapped) {
        const sku = String(listing.product.SKU ?? '').trim() || '(sin SKU)';
        this.logger.warn(
          `[internal-api] SKU ${sku} sin MLA o precio válido, se omite`,
        );
        continue;
      }
      products.push(mapped);
    }

    await this.internalApi.upsertProducts(products);
    this.logger.log(
      `[internal-api] upsert de ${products.length} publicaciones ML (BNA ${usdBna}, desc ${discountPercent}%).`,
    );
    return products.length;
  }
}
