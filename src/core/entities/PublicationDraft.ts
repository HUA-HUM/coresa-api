import { PublicationVariant } from './PublicationVariant';

export class DraftAttribute {
  id: string;
  value_id?: string;
  value_name?: string;
}

export class DraftShipping {
  mode: string;
  free_shipping: boolean;
  /** Retiro en persona por el domicilio del vendedor. */
  local_pick_up?: boolean;
  /**
   * Tags de envío de ML. La lista vacía pide que NO active Flex: con Flex
   * prendido ML no deja editar el tiempo de disponibilidad del producto.
   */
  tags?: string[];
  logistic_type?: string;
}

/**
 * Borrador que se manda tal cual a meli-api (POST /meli/items/validate y
 * POST /meli/items). meli-api agrega currency_id, buying_mode, los dos
 * listing types y el SELLER_SKU.
 */
export class PublicationDraft {
  sku: string;
  title: string;
  category_id: string;
  price: number;
  available_quantity: number;
  condition: string;
  pictures: string[];
  attributes: DraftAttribute[];
  sale_terms?: DraftAttribute[];
  shipping: DraftShipping;
  description: string;
  /** El tipo de la variante. meli-api publica los dos tipos si no se le dice. */
  listing_types?: string[];
  /**
   * Tags del ítem. Así se activan las campañas de cuotas: 3x_campaign,
   * 9x_campaign y 12x_campaign sobre premium, pcj-co-funded sobre clásica.
   */
  tags?: string[];
  /**
   * Con qué forma se publica: tipo, unidades y modalidad. Viaja dentro del
   * borrador para que el publicador pueda registrarla cuando ML devuelva el
   * MLA, y se saca del payload antes de mandarlo a meli-api.
   */
  variant?: PublicationVariant;
}

export class ListingValidation {
  valid: boolean;
  error?: unknown;
}

export class PublicationValidation {
  sku: string;
  results: Record<string, ListingValidation>;
}

/** Resultado de un listing type dentro de POST /meli/items. */
export class ListingCreation {
  ok: boolean;
  conflict?: boolean;
  meli_item_id?: string;
  permalink?: string;
  status?: string;
  sub_status?: string[];
  description_saved?: boolean;
  description_error?: unknown;
  warnings?: unknown[];
  error?: unknown;
}

export class PublicationCreation {
  sku: string;
  results: Record<string, ListingCreation>;
}

export const LISTING_TYPE_CLASSIC = 'gold_special';
export const LISTING_TYPE_PREMIUM = 'gold_pro';
