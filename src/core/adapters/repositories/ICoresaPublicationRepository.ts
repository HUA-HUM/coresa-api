import {
  CoresaPublication,
  CoresaPublicationFilters,
  CreateCoresaPublicationInput,
  UpdateCoresaPublicationInput,
} from '../../entities/CoresaPublication';

export interface ICoresaPublicationRepository {
  create(input: CreateCoresaPublicationInput): Promise<CoresaPublication>;
  update(
    id: number,
    input: UpdateCoresaPublicationInput,
  ): Promise<CoresaPublication>;
  getById(id: number): Promise<CoresaPublication | null>;
  getBySku(sku: string): Promise<CoresaPublication | null>;
  getHistoryBySku(sku: string): Promise<CoresaPublication[]>;
  list(filters: CoresaPublicationFilters): Promise<{
    items: CoresaPublication[];
    pagination: { limit: number; offset: number; total: number };
  }>;
}

export const ICoresaPublicationRepositoryToken = Symbol(
  'ICoresaPublicationRepository',
);
