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
  getBySku(sku: string): Promise<CoresaPublication | null>;
}

export const ICoresaPublicationRepositoryToken = Symbol(
  'ICoresaPublicationRepository',
);
