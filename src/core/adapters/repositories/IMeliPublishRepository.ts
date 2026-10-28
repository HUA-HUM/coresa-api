import {
  MeliCategoryAttribute,
  MeliCategorySuggestion,
} from '../../entities/MeliCategory';
import {
  PublicationCreation,
  PublicationDraft,
  PublicationValidation,
} from '../../entities/PublicationDraft';

export interface IMeliPublishRepository {
  predictCategories(
    title: string,
    limit?: number,
  ): Promise<MeliCategorySuggestion[]>;
  getCategoryAttributes(categoryId: string): Promise<MeliCategoryAttribute[]>;
  validateItem(draft: PublicationDraft): Promise<PublicationValidation>;
  createItem(draft: PublicationDraft): Promise<PublicationCreation>;
  /** Cierra y elimina la publicación en ML. No hay vuelta atrás. */
  deleteItem(itemId: string): Promise<void>;
  updateDescription(itemId: string, description: string): Promise<void>;
}

export const IMeliPublishRepositoryToken = Symbol('IMeliPublishRepository');
