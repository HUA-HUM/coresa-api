import {
  CoresaPublication,
  CoresaPublicationSummary,
} from '../entities/CoresaPublication';

/**
 * Fila liviana para la lista del panel. La publicación completa trae el
 * producto de Coresa, el borrador y la respuesta de ML: son varios KB por
 * fila que la lista no usa.
 */
export function toPublicationSummary(
  publication: CoresaPublication,
): CoresaPublicationSummary {
  const draft = publication.draft ?? null;

  return {
    id: publication.id,
    sku: publication.sku,
    status: publication.status,
    title: draft?.title ?? null,
    categoryId: publication.categoryId ?? draft?.category_id ?? null,
    price: draft?.price ?? null,
    availableQuantity: draft?.available_quantity ?? null,
    classicItemId: publication.classicItemId ?? null,
    premiumItemId: publication.premiumItemId ?? null,
    permalink: publication.permalink ?? null,
    errorMessage: publication.errorMessage ?? null,
    requestedBy: publication.requestedBy ?? null,
    publishedAt: publication.publishedAt ?? null,
    createdAt: publication.createdAt ?? null,
    updatedAt: publication.updatedAt ?? null,
  };
}
