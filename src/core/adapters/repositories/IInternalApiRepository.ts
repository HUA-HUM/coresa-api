import { InternalMeliBulkProduct } from '../../entities/InternalMeliBulkProduct';
import { InternalMeliProduct } from '../../entities/InternalMeliProduct';

export interface IInternalApiRepository {
  upsertProducts(products: InternalMeliBulkProduct[]): Promise<void>;
  getProductBySku(sku: string): Promise<InternalMeliProduct | null>;
}

export const IInternalApiRepositoryToken = Symbol('IInternalApiRepository');
