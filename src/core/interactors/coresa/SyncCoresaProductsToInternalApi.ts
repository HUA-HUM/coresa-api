import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import { MeliListingProduct } from '../../entities/MeliListingProduct';

@Injectable()
export class SyncCoresaProductsToInternalApi {
  private readonly logger = new Logger(SyncCoresaProductsToInternalApi.name);

  constructor(
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  async execute(products: MeliListingProduct[]): Promise<number> {
    await this.internalApi.upsertProducts(products);
    this.logger.log(
      `[internal-api] upsert de ${products.length} publicaciones ML.`,
    );
    return products.length;
  }
}
