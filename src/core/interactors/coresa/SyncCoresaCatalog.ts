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
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  getDiscountPercent,
  priceCoresaProduct,
} from '../../utils/coresaPriceStock';

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

  async execute(): Promise<{
    total: number;
    upserted: number;
    skipped: number;
  }> {
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

    await this.internalApi.upsertCoresaProducts(priced);

    return {
      total: products.length,
      upserted: priced.length,
      skipped,
    };
  }
}
