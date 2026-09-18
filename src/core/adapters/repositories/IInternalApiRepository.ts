import { CoresaProduct } from '../../entities/CoresaProduct';
import { InternalMeliProduct } from '../../entities/InternalMeliProduct';

export interface IInternalApiRepository {
  upsertProducts(products: CoresaProduct[]): Promise<void>;
  getProductBySku(sku: string): Promise<InternalMeliProduct | null>;
}

export const IInternalApiRepositoryToken = Symbol('IInternalApiRepository');
