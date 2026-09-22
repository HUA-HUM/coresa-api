import { CoresaProduct } from './CoresaProduct';
import { PublicationDraft, PublicationValidation } from './PublicationDraft';

export type CoresaPublicationStatus =
  | 'draft'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'partial'
  | 'failed'
  | 'discarded';

export class CreateCoresaPublicationInput {
  sku: string;
  requestedBy?: string | null;
  coresaSnapshot: CoresaProduct;
  draft: PublicationDraft;
  categoryId?: string | null;
  aiModel?: string | null;
  aiGeneratedAt?: string | null;
}

export class UpdateCoresaPublicationInput {
  status?: CoresaPublicationStatus;
  draft?: PublicationDraft;
  validation?: PublicationValidation;
  classicItemId?: string | null;
  premiumItemId?: string | null;
  permalink?: string | null;
  response?: unknown;
  errorCode?: string | null;
  errorMessage?: string | null;
}

export class CoresaPublication {
  id: number;
  sku: string;
  status: CoresaPublicationStatus;
  draft?: PublicationDraft | null;
  validation?: PublicationValidation | null;
  classicItemId?: string | null;
  premiumItemId?: string | null;
  permalink?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
