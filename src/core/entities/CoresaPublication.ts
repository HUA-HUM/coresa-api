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
  requestedBy?: string | null;
  categoryId?: string | null;
  coresaSnapshot?: CoresaProduct | null;
  draft?: PublicationDraft | null;
  validation?: PublicationValidation | null;
  response?: unknown;
  aiModel?: string | null;
  aiGeneratedAt?: string | null;
  classicItemId?: string | null;
  premiumItemId?: string | null;
  permalink?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  publishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export class CoresaPublicationFilters {
  sku?: string;
  status?: string;
  categoryId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

/** Fila para la lista del panel: sin los JSON pesados. */
export class CoresaPublicationSummary {
  id: number;
  sku: string;
  status: CoresaPublicationStatus;
  title: string | null;
  categoryId: string | null;
  price: number | null;
  availableQuantity: number | null;
  classicItemId: string | null;
  premiumItemId: string | null;
  permalink: string | null;
  errorMessage: string | null;
  requestedBy: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export class CoresaPublicationList {
  items: CoresaPublicationSummary[];
  pagination: { limit: number; offset: number; total: number };
}
