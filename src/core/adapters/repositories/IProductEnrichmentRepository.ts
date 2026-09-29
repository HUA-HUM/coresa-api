import { CoresaProduct } from '../../entities/CoresaProduct';
import { MeliCategoryAttribute } from '../../entities/MeliCategory';
import { DraftAttribute } from '../../entities/PublicationDraft';
import { PublicationVariant } from '../../entities/PublicationVariant';

export class EnrichedProductContent {
  title: string;
  description: string;
  attributes: DraftAttribute[];
  model: string;
}

export interface IProductEnrichmentRepository {
  /**
   * La variante entra acá y no se agrega después: un pack de 6 necesita que
   * el título se arme sabiéndolo desde el principio, porque a 60 caracteres
   * no hay lugar para pegarle un "Pack X 6" a un título ya escrito.
   */
  buildContent(
    product: CoresaProduct,
    categoryAttributes: MeliCategoryAttribute[],
    variant: PublicationVariant,
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
