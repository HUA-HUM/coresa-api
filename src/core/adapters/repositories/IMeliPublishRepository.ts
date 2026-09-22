import {
  MeliCategoryAttribute,
  MeliCategorySuggestion,
} from '../../entities/MeliCategory';
import {
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
}

export const IMeliPublishRepositoryToken = Symbol('IMeliPublishRepository');
