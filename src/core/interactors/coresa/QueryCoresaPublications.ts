import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ICoresaPublicationRepository,
  ICoresaPublicationRepositoryToken,
} from '../../adapters/repositories/ICoresaPublicationRepository';
import {
  CoresaPublication,
  CoresaPublicationFilters,
  CoresaPublicationList,
  CoresaPublicationSummary,
} from '../../entities/CoresaPublication';
import { toPublicationSummary } from '../../utils/publicationSummary';

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

@Injectable()
export class QueryCoresaPublications {
  constructor(
    @Inject(ICoresaPublicationRepositoryToken)
    private readonly publications: ICoresaPublicationRepository,
  ) {}

  private normalizeLimit(limit?: number): number {
    const value = Number(limit ?? DEFAULT_LIMIT);
    if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
    return Math.min(Math.floor(value), MAX_LIMIT);
  }

  private normalizeOffset(offset?: number): number {
    const value = Number(offset ?? 0);
    if (!Number.isFinite(value) || value < 0) return 0;
    return Math.floor(value);
  }

  async list(
    filters: CoresaPublicationFilters,
  ): Promise<CoresaPublicationList> {
    const result = await this.publications.list({
      ...filters,
      limit: this.normalizeLimit(filters.limit),
      offset: this.normalizeOffset(filters.offset),
    });

    return {
      items: result.items.map(toPublicationSummary),
      pagination: result.pagination,
    };
  }

  async getById(id: number): Promise<CoresaPublication> {
    const publication = await this.publications.getById(id);
    if (!publication) {
      throw new NotFoundException(`La publicación ${id} no existe`);
    }
    return publication;
  }

  async getBySku(sku: string): Promise<CoresaPublication> {
    const publication = await this.publications.getBySku(sku);
    if (!publication) {
      throw new NotFoundException(`El SKU ${sku} no tiene publicaciones`);
    }
    return publication;
  }

  async getHistoryBySku(sku: string): Promise<CoresaPublicationSummary[]> {
    const history = await this.publications.getHistoryBySku(sku);
    return history.map(toPublicationSummary);
  }
}
