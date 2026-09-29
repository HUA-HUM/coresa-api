import { CoresaProduct } from './CoresaProduct';
import { scalarToString, toNumber } from '../utils/coresaPriceStock';
import { isMeliListingType, MeliListingType } from './PublicationVariant';

/**
 * publicador  la creó coresa-api y los datos de la variante son ciertos
 * manual      la cargó una persona y la confirmó
 * heredado    fila vieja, con la variante desconocida: no se sincroniza
 */
export type CoresaListingOrigen = 'publicador' | 'manual' | 'heredado';

export type CoresaProductInMercadoLibre = {
  sku: string;
  mla: string;
  updateStock: boolean;
  updatePrice: boolean;
  /** Los tres nulos juntos significan que no se sabe cómo se publicó. */
  listingType: MeliListingType | null;
  unitsPerListing: number | null;
  modalidad: string | null;
  priceFactor: number;
  origen: CoresaListingOrigen;
  createdAt?: string;
};

/** Lo que se manda a internal-api al registrar o corregir una fila. */
export type CoresaListingVariantInput = {
  updatePrice?: boolean;
  updateStock?: boolean;
  listingType?: MeliListingType;
  unitsPerListing?: number;
  modalidad?: string | null;
  priceFactor?: number;
  origen?: CoresaListingOrigen;
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

/**
 * Error de meli-api con el detalle de ML adentro. Sin esto, en el registro
 * queda "Request failed with status code 422" y no se puede saber qué pasó.
 */
export class MeliUpdateError extends Error {
  constructor(
    readonly mla: string,
    readonly status: number,
    readonly code: string,
    message: string,
    readonly causes: string[] = [],
  ) {
    super(message);
    this.name = 'MeliUpdateError';
  }

  /** El motivo completo, para guardar en el historial de cambios. */
  get detail(): string {
    return this.causes.length > 0 ? this.causes.join(' | ') : this.message;
  }
}

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

function isCoresaListingOrigen(value: string): value is CoresaListingOrigen {
  return value === 'publicador' || value === 'manual' || value === 'heredado';
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

  const listingType = scalarToString(nested.listing_type ?? nested.listingType)
    .trim()
    .toLowerCase();
  const units = Math.floor(
    toNumber(nested.units_per_listing ?? nested.unitsPerListing),
  );
  const modalidad =
    scalarToString(nested.modalidad).trim().toLowerCase() || null;
  const factor = toNumber(nested.price_factor ?? nested.priceFactor);
  const origen = scalarToString(nested.origen).trim().toLowerCase();

  return {
    sku,
    mla,
    updateStock: readBool(nested.updateStock ?? nested.update_stock, true),
    updatePrice: readBool(nested.updatePrice ?? nested.update_price, true),
    // Un valor que no se entiende se trata como desconocido, que es lo que
    // frena al actualizador. Completarlo con un default sería suponer.
    listingType: isMeliListingType(listingType) ? listingType : null,
    unitsPerListing: units >= 1 ? units : null,
    modalidad,
    priceFactor: factor > 0 ? factor : 1,
    origen: isCoresaListingOrigen(origen) ? origen : 'heredado',
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
