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
}

export const IProductEnrichmentRepositoryToken = Symbol(
  'IProductEnrichmentRepository',
);
