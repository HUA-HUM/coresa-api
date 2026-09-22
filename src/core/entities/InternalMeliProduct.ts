export class InternalMeliProduct {
  sku: string;
  status: string;
  meli_item_id: string | null;
}

export function mapInternalMeliProduct(
  payload: unknown,
): InternalMeliProduct | null {
  if (!payload || typeof payload !== 'object') return null;

  const root = payload as Record<string, unknown>;
  const nested =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;

  const sku = String(nested.sku ?? nested.SKU ?? '').trim();
  const status = String(nested.status ?? nested.Status ?? '').trim();
  const rawId =
    nested.meli_item_id ??
    nested.meliItemId ??
    nested.MLA ??
    nested.mla ??
    nested.id;

  const meli_item_id =
    rawId === undefined || rawId === null || String(rawId).trim() === ''
      ? null
      : String(rawId).trim();

  if (!sku && !status && !meli_item_id) return null;

  return { sku, status, meli_item_id };
}

export function isActiveMeliStatus(status: string): boolean {
  return status.trim().toLowerCase() === 'active';
}
