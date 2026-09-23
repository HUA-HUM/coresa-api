import { MeliListingProduct } from '../../entities/MeliListingProduct';

export interface IMercadoLibreRepository {
  updateListings(items: MeliListingProduct[]): Promise<void>;
}

export const IMercadoLibreRepositoryToken = Symbol('IMercadoLibreRepository');
