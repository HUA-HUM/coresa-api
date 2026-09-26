import { CoresaProduct } from './CoresaProduct';
import { scalarToString, toNumber } from '../utils/coresaPriceStock';

export type CoresaProductInMercadoLibre = {
  sku: string;
  mla: string;
  updateStock: boolean;
  updatePrice: boolean;
  createdAt?: string;
};

export type MercadoLibreProductSnapshot = {
  meli_item_id: string;
  price: number;
  available_quantity: number;
};

export type MeliListingUpdate = {
  price?: number;
  available_quantity?: number;
};

/**
 * Lo que devuelve meli-api al actualizar: "applied" es lo que quedó cargado
 * en ML, que no siempre es lo que se pidió (ítems con variaciones,
 * publicaciones de catálogo, topes de precio).
 */
export type MeliListingUpdateResult = {
  meli_item_id: string;
  status?: string;
  sub_status?: string[];
  requested?: MeliListingUpdate;
  applied?: MeliListingUpdate | null;
  changed: boolean;
};

export type SyncChangeResult = 'updated' | 'not_applied' | 'failed';

/** Una fila del historial de cambios de precio y stock. */
export type CoresaSyncChange = {
  sku: string;
  mla: string;
  result: SyncChangeResult;
  priceBefore?: number | null;
  priceRequested?: number | null;
  priceApplied?: number | null;
  stockBefore?: number | null;
  stockRequested?: number | null;
  stockApplied?: number | null;
  meliStatus?: string | null;
  meliSubStatus?: string[] | null;
  errorCode?: string | null;
  errorMessage?: string | null;
};

function unwrapObject(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const root = payload as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;
  return nested;
}

export function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const root = payload as Record<string, unknown>;
    if (Array.isArray(root.data)) return root.data;
    if (Array.isArray(root.products)) return root.products;
    if (Array.isArray(root.items)) return root.items;
  }
  throw new Error(
    '[internal-api] Respuesta inesperada. Se esperaba un array o { data | products | items }',
  );
}

function readBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const raw = scalarToString(value).trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return fallback;
}

export function mapCoresaProduct(payload: unknown): CoresaProduct | null {
  const nested = unwrapObject(payload);
  if (!nested) return null;
  const sku = scalarToString(nested.SKU ?? nested.sku).trim();
  if (!sku) return null;
  return { ...(nested as unknown as CoresaProduct), SKU: sku };
}

export function mapCoresaProductInMercadoLibre(
  payload: unknown,
): CoresaProductInMercadoLibre | null {
  const nested = unwrapObject(payload);
  if (!nested) return null;

  const sku = scalarToString(nested.sku ?? nested.SKU).trim();
  const mla = scalarToString(
    nested.mla ?? nested.MLA ?? nested.meli_item_id,
  ).trim();
  if (!sku || !mla) return null;

  const createdAt =
    scalarToString(nested.createdAt ?? nested.created_at).trim() || undefined;

  return {
    sku,
    mla,
    updateStock: readBool(nested.updateStock ?? nested.update_stock, true),
    updatePrice: readBool(nested.updatePrice ?? nested.update_price, true),
    createdAt,
  };
}

export function mapCoresaProductsInMercadoLibre(
  payload: unknown,
): CoresaProductInMercadoLibre[] {
  return unwrapList(payload)
    .map((item) => mapCoresaProductInMercadoLibre(item))
    .filter((item): item is CoresaProductInMercadoLibre => item !== null);
}

export function mapMercadoLibreProductSnapshot(
  payload: unknown,
): MercadoLibreProductSnapshot | null {
  const nested = unwrapObject(payload);
  if (!nested) return null;

  const rawId =
    nested.meli_item_id ??
    nested.meliItemId ??
    nested.MLA ??
    nested.mla ??
    nested.id;
  const meli_item_id = scalarToString(rawId).trim();
  if (!meli_item_id) return null;

  return {
    meli_item_id,
    price: toNumber(nested.price ?? nested.Price),
    available_quantity: toNumber(
      nested.available_quantity ?? nested.availableQuantity ?? nested.stock,
    ),
  };
}
