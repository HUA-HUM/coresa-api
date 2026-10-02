import { EnrichedProductContent } from '../adapters/repositories/IProductEnrichmentRepository';
import { CoresaProduct } from '../entities/CoresaProduct';
import { DraftAttribute, PublicationDraft } from '../entities/PublicationDraft';
import {
  DEFAULT_VARIANT,
  PublicationVariant,
} from '../entities/PublicationVariant';
import { toNumber } from './coresaPriceStock';

export const DEFAULT_WARRANTY_TYPE = 'Garantía del vendedor';
export const DEFAULT_WARRANTY_TIME = '12 meses';
export const MAX_PICTURES = 10;
/** Producto nacionalizado por el proveedor: el comprador no paga aduana. */
export const DEFAULT_IMPORT_DUTY = '0 %';

export function getShippingMode(): string {
  return String(process.env.MELI_SHIPPING_MODE ?? 'me2').trim() || 'me2';
}

export function getFreeShipping(): boolean {
  return String(process.env.MELI_FREE_SHIPPING ?? 'false').trim() === 'true';
}

/** Retiro en persona por el domicilio del vendedor. */
export function getLocalPickUp(): boolean {
  return String(process.env.MELI_LOCAL_PICK_UP ?? 'true').trim() === 'true';
}

/**
 * Con Flex activo ML no deja editar el tiempo de disponibilidad del producto,
 * y Coresa vende bajo demanda: la mercadería no está en nuestro depósito.
 * La lista vacía es pedirle a ML que no lo active; no mandar el campo deja
 * decidir a la configuración de la cuenta.
 */
export function getShippingTags(): string[] | undefined {
  const raw = process.env.MELI_SHIPPING_TAGS;
  if (raw === undefined) return undefined;
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '');
}

/**
 * Días que tardamos en tener el producto listo para despachar. ML lo pide
 * como término de venta MANUFACTURING_TIME. Si no está configurado no se
 * manda: un valor inventado acá promete una entrega que no podemos cumplir.
 */
export function getHandlingTimeDays(): number | null {
  const raw = process.env.MELI_HANDLING_TIME_DAYS;
  if (raw === undefined || String(raw).trim() === '') return null;
  const days = Math.floor(Number(raw));
  return Number.isFinite(days) && days > 0 ? days : null;
}

export function saleTerms(campaign?: string | null): DraftAttribute[] {
  const terms: DraftAttribute[] = [
    { id: 'WARRANTY_TYPE', value_name: DEFAULT_WARRANTY_TYPE },
    { id: 'WARRANTY_TIME', value_name: DEFAULT_WARRANTY_TIME },
  ];

  const days = getHandlingTimeDays();
  if (days !== null) {
    terms.push({
      id: 'MANUFACTURING_TIME',
      value_name: `${days} días`,
    });
  }

  // Sin este término la publicación no ofrece las cuotas que cotizamos, y dos
  // opciones de venta del mismo producto quedan idénticas: ML anula una por
  // duplicada. El contado es justamente la ausencia del término.
  if (campaign) {
    terms.push({ id: 'INSTALLMENTS_CAMPAIGN', value_name: campaign });
  }
  return terms;
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

/**
 * Peso del paquete, siempre en gramos enteros. ML es terminante con esto:
 * "Only integers are accepted for dimensions and weight, with centimeters
 * 'cm' as the unit for dimensions and grams 'g' as the unit for weight".
 * Mandar "1.3 kg" hace que rechace la publicación entera.
 */
export function packageWeight(value: unknown): string {
  const kg = toNumber(value);
  if (!(kg > 0)) return '';
  return `${Math.max(1, Math.round(kg * 1000))} g`;
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
 * El paquete de una publicación que vende varias unidades es el de TODAS, no
 * el de una. Coresa manda peso y medidas por unidad, y ML cobra el envío por
 * este dato: declarar 40 g donde van 800 g es pagar de menos un envío que
 * igual hay que despachar.
 *
 * El peso se multiplica, que es exacto. Las medidas se estiman apilando sobre
 * el lado más chico, que es como se arma una caja de verdad; es un estimado y
 * el usuario lo puede corregir en el borrador antes de publicar.
 */
export function packagedSize(
  product: CoresaProduct,
  unitsPerListing: number,
): { alto: number; ancho: number; largo: number; kg: number } {
  const alto = toNumber(product.Alto_cm);
  const ancho = toNumber(product.Ancho_cm);
  const largo = toNumber(product.Largo_cm);
  const kg = toNumber(product.Peso_kg) * Math.max(1, unitsPerListing);

  if (unitsPerListing <= 1) return { alto, ancho, largo, kg };

  const menor = Math.min(alto, ancho, largo);
  const apilar = (lado: number): number =>
    lado === menor ? lado * unitsPerListing : lado;

  // Solo se estira un lado: si los tres son iguales, el primero.
  let yaApilado = false;
  const estirar = (lado: number): number => {
    if (yaApilado || lado !== menor) return lado;
    yaApilado = true;
    return apilar(lado);
  };

  return {
    alto: estirar(alto),
    ancho: estirar(ancho),
    largo: estirar(largo),
    kg,
  };
}

/**
 * ML pide los cuatro datos del paquete juntos, aunque no aparezcan en los
 * atributos de la categoría, así que van siempre.
 */
export function packageAttributes(
  product: CoresaProduct,
  unitsPerListing: number = 1,
): DraftAttribute[] {
  const paquete = packagedSize(product, unitsPerListing);
  const values: DraftAttribute[] = [
    { id: 'SELLER_PACKAGE_HEIGHT', value_name: packageDimension(paquete.alto) },
    { id: 'SELLER_PACKAGE_WIDTH', value_name: packageDimension(paquete.ancho) },
    {
      id: 'SELLER_PACKAGE_LENGTH',
      value_name: packageDimension(paquete.largo),
    },
    { id: 'SELLER_PACKAGE_WEIGHT', value_name: packageWeight(paquete.kg) },
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
  unitsPerListing: number = 1,
): DraftAttribute[] {
  const result = [...attributes];
  const present = new Set(result.map((attribute) => attribute.id));

  const candidates: DraftAttribute[] = [
    { id: 'VALUE_ADDED_TAX', value_name: valueAddedTax(product) },
    { id: 'IMPORT_DUTY', value_name: DEFAULT_IMPORT_DUTY },
    { id: 'BRAND', value_name: String(product.Marca ?? '').trim() },
    { id: 'MODEL', value_name: content.model },
    // El código de barras de la unidad no identifica al pack, y ML lo valida
    // contra su base global: en un pack es preferible no mandarlo.
    {
      id: 'GTIN',
      value_name: unitsPerListing > 1 ? '' : getGtin(product),
    },
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

/**
 * El precio y el stock llegan ya compuestos para la variante; acá no se
 * recalcula nada.
 */
export function buildPublicationDraft(params: {
  product: CoresaProduct;
  categoryId: string;
  content: EnrichedProductContent;
  price: number;
  availableQuantity: number;
  allowedAttributeIds: Set<string>;
  variant?: PublicationVariant;
  /** Cómo llama ML a las cuotas de esta variante. */
  campaign?: string | null;
  /** Fotos ya pasadas por el CDN. Sin esto, las del proveedor. */
  pictures?: string[];
  /**
   * El título de una publicación hermana del mismo producto. ML agrupa las
   * opciones de venta por family_name, así que si no es el mismo quedan como
   * publicaciones separadas en vez de una con varias opciones.
   */
  familyName?: string;
}): PublicationDraft {
  const { product, categoryId, content, price, availableQuantity } = params;
  const variant = params.variant ?? DEFAULT_VARIANT;

  return {
    sku: String(product.SKU ?? '').trim(),
    title: params.familyName?.trim() || content.title,
    category_id: categoryId,
    price,
    available_quantity: availableQuantity,
    condition: 'new',
    pictures: params.pictures?.length
      ? params.pictures
      : buildPictures(product),
    attributes: [
      ...withProductAttributes(
        content.attributes,
        product,
        content,
        params.allowedAttributeIds,
        variant.unitsPerListing,
      ),
      ...packageAttributes(product, variant.unitsPerListing),
    ],
    sale_terms: saleTerms(params.campaign),
    shipping: {
      mode: getShippingMode(),
      free_shipping: getFreeShipping(),
      local_pick_up: getLocalPickUp(),
      ...(getShippingTags() === undefined ? {} : { tags: getShippingTags() }),
    },
    description: content.description,
    listing_types: [variant.listingType],
    variant,
  };
}
