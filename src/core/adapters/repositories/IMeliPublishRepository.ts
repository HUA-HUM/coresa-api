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
  updateDescription(itemId: string, description: string): Promise<void>;
}

export const IMeliPublishRepositoryToken = Symbol('IMeliPublishRepository');
