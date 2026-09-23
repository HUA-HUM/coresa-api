import {
  CoresaPublication,
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
}

export const ICoresaPublicationRepositoryToken = Symbol(
  'ICoresaPublicationRepository',
);
