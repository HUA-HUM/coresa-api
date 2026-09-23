import {
  MeliBySkuLookup,
  MeliListingProduct,
} from '../../entities/MeliListingProduct';

export interface IInternalApiRepository {
  upsertProducts(products: MeliListingProduct[]): Promise<void>;
  getProductBySku(sku: string): Promise<MeliBySkuLookup | null>;
}

export const IInternalApiRepositoryToken = Symbol('IInternalApiRepository');
