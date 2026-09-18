import { Inject, Injectable, Logger } from '@nestjs/common';
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';

@Injectable()
export class SyncCoresaProductsToInternalApi {
  private readonly logger = new Logger(SyncCoresaProductsToInternalApi.name);

  constructor(
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  async execute(products: CoresaProduct[]): Promise<void> {
    await this.internalApi.upsertProducts(products);
    this.logger.log(
      `[internal-api] upsert de ${products.length} productos Coresa.`,
    );
  }
}
