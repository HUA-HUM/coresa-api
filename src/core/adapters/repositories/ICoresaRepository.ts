import { CoresaProduct } from '../../entities/CoresaProduct';

export interface ICoresaRepository {
  getAllProducts(): Promise<CoresaProduct[]>;
  getProductBySku(sku: string): Promise<CoresaProduct | null>;
}

export const ICoresaRepositoryToken = Symbol('ICoresaRepository');
