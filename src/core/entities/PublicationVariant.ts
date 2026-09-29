import { CoresaProduct } from './CoresaProduct';
import { toNumber } from '../utils/coresaPriceStock';

/** Los dos tipos que tiene ML: 'gold_special' es la clásica, 'gold_pro' la premium. */
export type MeliListingType = 'gold_special' | 'gold_pro';

export const MELI_LISTING_TYPES: MeliListingType[] = [
  'gold_special',
  'gold_pro',
];

/**
 * Red contra el dedazo, la misma que valida internal-api: un 100 escrito de
 * más multiplicaría el precio por 100.
 */
export const MIN_PRICE_FACTOR = 0.5;
export const MAX_PRICE_FACTOR = 3;

export const DEFAULT_MODALIDAD = 'contado';

/**
 * Con qué forma se publica un SKU. El mismo SKU puede estar publicado varias
 * veces: de a 1 o de a 6, en clásica o premium, al contado o en cuotas. El
 * precio de cada publicación sale de estos cuatro datos.
 */
export class PublicationVariant {
  listingType: MeliListingType;
  /** Cuántas unidades del SKU vende ESA publicación. */
  unitsPerListing: number;
  modalidad: string;
  /** Recargo de la modalidad: 1 sin recargo, 1.15 un 15% arriba. */
  priceFactor: number;
}

export const DEFAULT_VARIANT: PublicationVariant = {
  listingType: 'gold_special',
  unitsPerListing: 1,
  modalidad: DEFAULT_MODALIDAD,
  priceFactor: 1,
};

export function isMeliListingType(value: unknown): value is MeliListingType {
  return MELI_LISTING_TYPES.includes(value as MeliListingType);
}

/**
 * A cuántas unidades corresponde Precio_Convertido. Coresa cotiza por su
 * empaque (CantIntermedia), no por unidad, y sin este dato no se puede sacar
 * el precio unitario: fue la causa de que 31 publicaciones de una unidad
 * quedaran con el precio de la caja.
 */
export function baseUnitsOf(product: CoresaProduct): number {
  const units = Math.floor(toNumber(product.base_units));
  return units >= 1 ? units : 1;
}

export function unitPriceOf(basePrice: number, baseUnits: number): number {
  return baseUnits >= 1 ? basePrice / baseUnits : basePrice;
}

/** precio = (precio base / unidades del empaque) × unidades × recargo. */
export function variantPrice(
  basePrice: number,
  baseUnits: number,
  variant: PublicationVariant,
): number {
  const unit = unitPriceOf(basePrice, baseUnits);
  return Math.round(unit * variant.unitsPerListing * variant.priceFactor);
}

/** Un pack de 6 tiene la sexta parte del stock que las unidades sueltas. */
export function variantStock(
  available: number,
  unitsPerListing: number,
): number {
  if (!(unitsPerListing >= 1)) return Math.floor(available);
  return Math.floor(available / unitsPerListing);
}

/**
 * Dos variantes son la misma publicación si coinciden tipo, unidades y
 * modalidad. El recargo no entra: es el precio de esa misma variante, no otra.
 */
export function sameVariant(
  a: Pick<PublicationVariant, 'listingType' | 'unitsPerListing' | 'modalidad'>,
  b: Pick<PublicationVariant, 'listingType' | 'unitsPerListing' | 'modalidad'>,
): boolean {
  return (
    a.listingType === b.listingType &&
    a.unitsPerListing === b.unitsPerListing &&
    normalizeModalidad(a.modalidad) === normalizeModalidad(b.modalidad)
  );
}

export function normalizeModalidad(value: string | null | undefined): string {
  const raw = (value ?? '').trim().toLowerCase();
  return raw || DEFAULT_MODALIDAD;
}

/** Para los mensajes del panel: "premium, pack de 6, x12". */
export function describeVariant(variant: PublicationVariant): string {
  const tipo = variant.listingType === 'gold_pro' ? 'premium' : 'clásica';
  const unidades =
    variant.unitsPerListing > 1
      ? `pack de ${variant.unitsPerListing}`
      : 'unidad suelta';
  return `${tipo}, ${unidades}, ${variant.modalidad}`;
}
