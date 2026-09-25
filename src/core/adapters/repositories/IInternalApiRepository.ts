import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  CoresaProductInMercadoLibre,
  MercadoLibreProductSnapshot,
} from '../../entities/CoresaMercadoLibre';

export interface IInternalApiRepository {
  upsertCoresaProducts(products: CoresaProduct[]): Promise<void>;
  listCoresaProductsInMercadoLibre(): Promise<CoresaProductInMercadoLibre[]>;
  getCoresaProductBySku(sku: string): Promise<CoresaProduct | null>;
  getMercadoLibreProductByMla(
    mla: string,
  ): Promise<MercadoLibreProductSnapshot | null>;
}

export const IInternalApiRepositoryToken = Symbol('IInternalApiRepository');
