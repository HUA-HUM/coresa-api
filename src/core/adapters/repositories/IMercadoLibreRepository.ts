import { MeliListingUpdate } from '../../entities/CoresaMercadoLibre';

export interface IMercadoLibreRepository {
  updateListing(mla: string, patch: MeliListingUpdate): Promise<void>;
}

export const IMercadoLibreRepositoryToken = Symbol('IMercadoLibreRepository');
