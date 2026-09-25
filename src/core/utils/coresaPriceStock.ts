import { CoresaProduct } from '../entities/CoresaProduct';

export const DEFAULT_DISCOUNT_PERCENT = 50;

export const FORMULA_1_MARGIN = 0.65;
/** Chint línea industrial y Macroled Skyline. Hoy no se elige sola: esas marcas también están en la fórmula 1. */
export const FORMULA_2_MARGIN = 0.7;
export const FORMULA_3_MARGIN = 0.5;

const FORMULA_1_BRANDS = new Set([
  'MACROLED',
  'INTECK',
  'POWERSWITCH',
  'KING',
  'UNIVIEW',
  'CHINT',
  'JADEVER',
  'DCK',
]);

const FORMULA_3_BRANDS = new Set(['WEIDMULLER']);

export function scalarToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return '';
}

/**
 * Convierte a número tolerando formatos $ 1.234,56 o 1,234.56, etc.
 */
export function toNumber(value: unknown): number {
  const raw = scalarToString(value).trim();
  if (raw === '') return 0;
  let s = raw.replace(/[^\d,.-]/g, '');

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (hasComma && !hasDot) {
    s = s.replace(',', '.');
  }

  const n = Number(s);
  return Number.isNaN(n) ? 0 : n;
}

export function getDiscountPercent(): number {
  const raw = Number(
    process.env.CORESA_PRICE_DISCOUNT_PERCENT ?? DEFAULT_DISCOUNT_PERCENT,
  );
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_DISCOUNT_PERCENT;
}

export function parseIvaRate(impuestos: unknown): number | null {
  const raw = scalarToString(impuestos).trim().toUpperCase().replace(',', '.');
  if (raw === 'IVA_21') return 0.21;
  if (raw === 'IVA_10.5') return 0.105;
  return null;
}

export function normalizeBrand(marca: unknown): string {
  return scalarToString(marca).trim().toUpperCase();
}

export type PricingFormula = 1 | 2 | 3;

export function marginForFormula(formula: PricingFormula): number {
  if (formula === 2) return FORMULA_2_MARGIN;
  if (formula === 3) return FORMULA_3_MARGIN;
  return FORMULA_1_MARGIN;
}

/**
 * Si la marca está en la fórmula 1, gana esa. No hay dato de línea para
 * distinguir Chint industrial, Macroled Skyline ni Uniview analógica.
 */
export function formulaForBrand(marca: unknown): PricingFormula | null {
  const brand = normalizeBrand(marca);
  if (!brand) return null;
  if (FORMULA_1_BRANDS.has(brand)) return 1;
  if (FORMULA_3_BRANDS.has(brand)) return 3;
  return null;
}

export function packQuantity(cantIntermedia: unknown): number {
  const qty = toNumber(cantIntermedia);
  return qty > 0 ? qty : 1;
}

export function calculateCoresaPriceArs(
  precioListaUsd: unknown,
  cantIntermedia: unknown,
  usdBna: number,
  ivaRate: number,
  marginRate: number,
  discountPercent: number = DEFAULT_DISCOUNT_PERCENT,
): number | null {
  const priceUsd = toNumber(precioListaUsd);
  if (!(priceUsd > 0) || !(usdBna > 0)) return null;
  if (!(ivaRate >= 0) || !(marginRate >= 0)) return null;

  const discountRate = 1 - discountPercent / 100;
  const packUsd = priceUsd * packQuantity(cantIntermedia);
  const price = Math.round(
    packUsd * usdBna * discountRate * (1 + ivaRate) * (1 + marginRate),
  );
  return price > 0 ? price : null;
}

export function totalStock(disponible: unknown): number {
  return Math.floor(toNumber(disponible));
}

export function priceCoresaProduct(
  product: CoresaProduct,
  usdBna: number,
  discountPercent: number = DEFAULT_DISCOUNT_PERCENT,
): CoresaProduct | null {
  const sku = String(product.SKU ?? '').trim();
  if (!sku) return null;

  const ivaRate = parseIvaRate(product.Impuestos);
  if (ivaRate === null) return null;

  const formula = formulaForBrand(product.Marca);
  if (formula === null) return null;

  const price = calculateCoresaPriceArs(
    product.Precio_Lista_1,
    product.CantIntermedia,
    usdBna,
    ivaRate,
    marginForFormula(formula),
    discountPercent,
  );
  if (price === null) return null;

  return {
    ...product,
    SKU: sku,
    Precio_Convertido: price,
    Disponible: totalStock(product.Disponible),
  };
}
