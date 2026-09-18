import { ActiveMeliListing } from '../../entities/ActiveMeliListing';

export interface IMercadoLibreRepository {
  updateListings(items: ActiveMeliListing[]): Promise<void>;
}

export const IMercadoLibreRepositoryToken = Symbol('IMercadoLibreRepository');
