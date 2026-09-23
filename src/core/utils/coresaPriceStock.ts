import { CoresaProduct } from '../entities/CoresaProduct';
import { MeliListingProduct } from '../entities/MeliListingProduct';

export const IVA_RATE = 0.21;
export const MARGIN_RATE = 0.65;
export const DEFAULT_DISCOUNT_PERCENT = 50;
export const DEFAULT_MELI_SELLER_ID = '6863691';

/**
 * Convierte a número tolerando formatos $ 1.234,56 o 1,234.56, etc.
 */
export function toNumber(value: unknown): number {
  const raw = String(value == null ? '' : value).trim();
  if (raw === '') return 0;
  let s = raw.replace(/[^\d,.\-]/g, '');

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

export function getMeliSellerId(): string {
  const sellerId = String(
    process.env.MELI_SELLER_ID ?? DEFAULT_MELI_SELLER_ID,
  ).trim();
  return sellerId || DEFAULT_MELI_SELLER_ID;
}

export function calculateCoresaPriceArs(
  precioListaUsd: unknown,
  usdBna: number,
  discountPercent: number = DEFAULT_DISCOUNT_PERCENT,
): number | null {
  const priceUsd = toNumber(precioListaUsd);
  if (!(priceUsd > 0) || !(usdBna > 0)) return null;

  const discountRate = 1 - discountPercent / 100;
  const usdDesc = priceUsd * discountRate;
  const usdIva = usdDesc * (1 + IVA_RATE);
  const usdMargin = usdIva * (1 + MARGIN_RATE);
  return Math.round(usdMargin * usdBna);
}

export function calculateCoresaStock(
  disponible: unknown,
  cantIntermedia: unknown,
): number {
  const stock = toNumber(disponible);
  const cantInter = toNumber(cantIntermedia);
  if (!cantInter) return Math.floor(stock);
  return Math.floor(stock / cantInter);
}

export function mapCoresaToMeliListing(
  product: CoresaProduct,
  meli_item_id: string,
  usdBna: number,
  sellerId: string,
  discountPercent: number = DEFAULT_DISCOUNT_PERCENT,
): MeliListingProduct | null {
  const itemId = String(meli_item_id ?? '').trim();
  if (!itemId) return null;

  const price = calculateCoresaPriceArs(
    product.Precio_Lista_1,
    usdBna,
    discountPercent,
  );
  if (price === null) return null;

  return {
    meli_item_id: itemId,
    seller_id: sellerId,
    sku: String(product.SKU ?? '').trim(),
    title: String(product.Descripcion ?? '').trim(),
    price,
    available_quantity: calculateCoresaStock(
      product.Disponible,
      product.CantIntermedia,
    ),
    status: 'active',
    raw_payload: {},
  };
}
