import { CoresaProduct } from '../../entities/CoresaProduct';
import { MeliCategoryAttribute } from '../../entities/MeliCategory';
import { DraftAttribute } from '../../entities/PublicationDraft';

export class EnrichedProductContent {
  title: string;
  description: string;
  attributes: DraftAttribute[];
  model: string;
}

export interface IProductEnrichmentRepository {
  buildContent(
    product: CoresaProduct,
    categoryAttributes: MeliCategoryAttribute[],
  ): Promise<EnrichedProductContent>;
  /**
   * Segunda pasada: completa los atributos obligatorios que la primera dejó
   * afuera, eligiendo el valor más probable en vez de omitirlos.
   */
  completeMissingAttributes(
    product: CoresaProduct,
    missing: MeliCategoryAttribute[],
    title: string,
  ): Promise<DraftAttribute[]>;
}

export const IProductEnrichmentRepositoryToken = Symbol(
  'IProductEnrichmentRepository',
);
