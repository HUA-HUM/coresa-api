import {
  MeliListingUpdate,
  MeliListingUpdateResult,
} from '../../entities/CoresaMercadoLibre';

export interface IMercadoLibreRepository {
  updateListing(
    mla: string,
    patch: MeliListingUpdate,
  ): Promise<MeliListingUpdateResult>;
}

export const IMercadoLibreRepositoryToken = Symbol('IMercadoLibreRepository');
