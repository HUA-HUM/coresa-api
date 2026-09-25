import { EnrichedProductContent } from '../adapters/repositories/IProductEnrichmentRepository';
import { CoresaProduct } from '../entities/CoresaProduct';
import { DraftAttribute, PublicationDraft } from '../entities/PublicationDraft';
import { priceCoresaProduct, toNumber } from './coresaPriceStock';

export const DEFAULT_WARRANTY_TYPE = 'Garantía del vendedor';
export const DEFAULT_WARRANTY_TIME = '6 meses';
export const MAX_PICTURES = 10;
/** Producto nacionalizado por el proveedor: el comprador no paga aduana. */
export const DEFAULT_IMPORT_DUTY = '0 %';

export function getShippingMode(): string {
  return String(process.env.MELI_SHIPPING_MODE ?? 'me2').trim() || 'me2';
}

export function getFreeShipping(): boolean {
  return String(process.env.MELI_FREE_SHIPPING ?? 'false').trim() === 'true';
}

/**
 * Un GTIN válido tiene 8, 12, 13 o 14 dígitos y el último es un dígito
 * verificador. ML lo valida y rechaza la publicación si no cierra.
 */
export function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (![8, 12, 13, 14].includes(value.length)) return false;

  const digits = value.split('').map(Number);
  const check = digits.pop() as number;
  // De derecha a izquierda, los pesos alternan 3 y 1.
  const sum = digits
    .reverse()
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );

  return (10 - (sum % 10)) % 10 === check;
}

/**
 * Código de barras que se manda como GTIN. Coresa a veces trae el unitario
 * mal (por ejemplo con un cero de más), así que se prueba el unitario y,
 * si no cierra, el master.
 */
export function getGtin(product: CoresaProduct): string {
  const candidates = [
    String(product.CodBarra_Unitario ?? '').trim(),
    String(product.CodBarra_Master ?? '').trim(),
  ];
  return candidates.find((candidate) => isValidGtin(candidate)) ?? '';
}

/** Dimensión del paquete en cm enteros: ML no acepta menos que el producto. */
export function packageDimension(value: unknown): string {
  const cm = Math.ceil(toNumber(value));
  return cm > 0 ? `${cm} cm` : '';
}

/** Peso del paquete: gramos abajo del kilo, que es como lo espera ML. */
export function packageWeight(value: unknown): string {
  const kg = toNumber(value);
  if (!(kg > 0)) return '';
  if (kg < 1) return `${Math.max(1, Math.round(kg * 1000))} g`;
  return `${kg} kg`;
}

/**
 * IVA del producto: Coresa lo manda como IVA_21, IVA_10.5, etc. y ML espera
 * uno de los valores de su lista ("21 %").
 */
export function valueAddedTax(product: CoresaProduct): string {
  const raw = String(product.Impuestos ?? '').trim();
  const match = /([\d.,]+)/.exec(raw);
  if (!match) return '';
  return `${match[1].replace(',', '.')} %`;
}

/**
 * ML pide los cuatro datos del paquete juntos, aunque no aparezcan en los
 * atributos de la categoría, así que van siempre.
 */
export function packageAttributes(product: CoresaProduct): DraftAttribute[] {
  const values: DraftAttribute[] = [
    {
      id: 'SELLER_PACKAGE_HEIGHT',
      value_name: packageDimension(product.Alto_cm),
    },
    {
      id: 'SELLER_PACKAGE_WIDTH',
      value_name: packageDimension(product.Ancho_cm),
    },
    {
      id: 'SELLER_PACKAGE_LENGTH',
      value_name: packageDimension(product.Largo_cm),
    },
    { id: 'SELLER_PACKAGE_WEIGHT', value_name: packageWeight(product.Peso_kg) },
  ];

  // Si falta alguno, ML rechaza igual: o van los cuatro, o no va ninguno.
  return values.every((attribute) => attribute.value_name) ? values : [];
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
    { id: 'VALUE_ADDED_TAX', value_name: valueAddedTax(product) },
    { id: 'IMPORT_DUTY', value_name: DEFAULT_IMPORT_DUTY },
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

  const priced = priceCoresaProduct(product, usdBna, discountPercent);
  if (priced?.Precio_Convertido == null) {
    throw new Error(
      `[coresa] SKU ${String(product.SKU ?? '')} sin precio de lista válido`,
    );
  }

  return {
    sku: String(product.SKU ?? '').trim(),
    title: content.title,
    category_id: categoryId,
    price: priced.Precio_Convertido,
    available_quantity: Number(priced.Disponible ?? 0),
    condition: 'new',
    pictures: buildPictures(product),
    attributes: [
      ...withProductAttributes(
        content.attributes,
        product,
        content,
        params.allowedAttributeIds,
      ),
      ...packageAttributes(product),
    ],
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
