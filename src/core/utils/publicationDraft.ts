import { EnrichedProductContent } from '../adapters/repositories/IProductEnrichmentRepository';
import { CoresaProduct } from '../entities/CoresaProduct';
import { DraftAttribute, PublicationDraft } from '../entities/PublicationDraft';
import {
  calculateCoresaPriceArs,
  calculateCoresaStock,
} from './coresaPriceStock';

export const DEFAULT_WARRANTY_TYPE = 'Garantía del vendedor';
export const DEFAULT_WARRANTY_TIME = '6 meses';
export const MAX_PICTURES = 10;

export function getShippingMode(): string {
  return String(process.env.MELI_SHIPPING_MODE ?? 'me2').trim() || 'me2';
}

export function getFreeShipping(): boolean {
  return String(process.env.MELI_FREE_SHIPPING ?? 'false').trim() === 'true';
}

/** Código de barras unitario, que es el GTIN que espera ML. */
export function getGtin(product: CoresaProduct): string {
  return String(product.CodBarra_Unitario ?? '').trim();
}

/**
 * Agrega BRAND, MODEL y GTIN si la categoría los admite y OpenAI no los
 * completó: son datos que vienen de Coresa y no hace falta deducirlos.
 */
export function withProductAttributes(
  attributes: DraftAttribute[],
  product: CoresaProduct,
  content: EnrichedProductContent,
  allowedIds: Set<string>,
): DraftAttribute[] {
  const result = [...attributes];
  const present = new Set(result.map((attribute) => attribute.id));

  const candidates: DraftAttribute[] = [
    { id: 'BRAND', value_name: String(product.Marca ?? '').trim() },
    { id: 'MODEL', value_name: content.model },
    { id: 'GTIN', value_name: getGtin(product) },
  ];

  for (const candidate of candidates) {
    if (present.has(candidate.id)) continue;
    if (!allowedIds.has(candidate.id)) continue;
    if (!candidate.value_name) continue;
    result.push(candidate);
    present.add(candidate.id);
  }

  return result;
}

export function buildPictures(product: CoresaProduct): string[] {
  const url = String(product.URL_Imagen ?? '').trim();
  return url ? [url].slice(0, MAX_PICTURES) : [];
}

export function buildPublicationDraft(params: {
  product: CoresaProduct;
  categoryId: string;
  content: EnrichedProductContent;
  usdBna: number;
  discountPercent: number;
  allowedAttributeIds: Set<string>;
}): PublicationDraft {
  const { product, categoryId, content, usdBna, discountPercent } = params;

  const price = calculateCoresaPriceArs(
    product.Precio_Lista_1,
    usdBna,
    discountPercent,
  );
  if (price === null) {
    throw new Error(
      `[coresa] SKU ${String(product.SKU ?? '')} sin precio de lista válido`,
    );
  }

  return {
    sku: String(product.SKU ?? '').trim(),
    title: content.title,
    category_id: categoryId,
    price,
    available_quantity: calculateCoresaStock(
      product.Disponible,
      product.CantIntermedia,
    ),
    condition: 'new',
    pictures: buildPictures(product),
    attributes: withProductAttributes(
      content.attributes,
      product,
      content,
      params.allowedAttributeIds,
    ),
    sale_terms: [
      { id: 'WARRANTY_TYPE', value_name: DEFAULT_WARRANTY_TYPE },
      { id: 'WARRANTY_TIME', value_name: DEFAULT_WARRANTY_TIME },
    ],
    shipping: {
      mode: getShippingMode(),
      free_shipping: getFreeShipping(),
    },
    description: content.description,
  };
}
