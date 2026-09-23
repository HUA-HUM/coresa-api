import { CoresaProduct } from '../entities/CoresaProduct';
import { MeliCategoryAttribute } from '../entities/MeliCategory';
import { DraftAttribute } from '../entities/PublicationDraft';

export const MELI_TITLE_MAX_LENGTH = 60;
/** Cuántos valores permitidos se le muestran a OpenAI por atributo. */
export const MAX_ALLOWED_VALUES_IN_PROMPT = 30;

/** Campos de Coresa que no aportan nada al contenido de la publicación. */
const IGNORED_PRODUCT_FIELDS = new Set([
  'Precio_Lista_1',
  'Moneda',
  'Impuestos',
  'Disponible',
  'CantMaster',
  'CantIntermedia',
  'CantMinima',
  'Minimo_Venta',
  'Venta_Unitaria',
]);

/** Deja solo los campos con valor, sin los de precio y stock. */
export function productFactsForPrompt(
  product: CoresaProduct,
): Record<string, string> {
  const facts: Record<string, string> = {};
  for (const [key, value] of Object.entries(product)) {
    if (IGNORED_PRODUCT_FIELDS.has(key)) continue;
    const text = String(value ?? '').trim();
    if (text === '') continue;
    facts[key] = text;
  }
  return facts;
}

/** Atributos que se le piden a OpenAI: los obligatorios primero. */
export function attributesForPrompt(
  attributes: MeliCategoryAttribute[],
  maxOptional = 15,
): MeliCategoryAttribute[] {
  const required = attributes.filter((attribute) => attribute.required);
  const optional = attributes.filter((attribute) => !attribute.required);
  return [...required, ...optional.slice(0, maxOptional)];
}

export function describeAttributesForPrompt(
  attributes: MeliCategoryAttribute[],
): unknown[] {
  return attributes.map((attribute) => {
    const allowed = (attribute.allowed_values ?? []).slice(
      0,
      MAX_ALLOWED_VALUES_IN_PROMPT,
    );
    return {
      id: attribute.id,
      nombre: attribute.name,
      obligatorio: attribute.required,
      tipo: attribute.value_type,
      valores_permitidos: allowed.map((value) => value.name),
      unidades_permitidas: attribute.allowed_units ?? [],
    };
  });
}

/** Texto plano de un valor que vino de un JSON ajeno; objetos y nulos dan ''. */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

export function truncateTitle(
  title: string,
  maxLength = MELI_TITLE_MAX_LENGTH,
): string {
  const clean = String(title ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= maxLength) return clean;

  const cut = clean.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Descarta lo que OpenAI haya inventado: atributos que no son de la categoría
 * y valores fuera de la lista permitida. Cuando el valor coincide con uno
 * permitido, se manda el value_id, que es lo que ML prefiere.
 */
export function sanitizeAttributes(
  proposed: DraftAttribute[],
  categoryAttributes: MeliCategoryAttribute[],
): DraftAttribute[] {
  const byId = new Map(
    categoryAttributes.map((attribute) => [attribute.id, attribute]),
  );
  const result: DraftAttribute[] = [];
  const seen = new Set<string>();

  for (const candidate of proposed ?? []) {
    const id = String(candidate?.id ?? '').trim();
    const attribute = byId.get(id);
    if (!attribute || seen.has(id)) continue;

    const valueName = String(candidate.value_name ?? '').trim();
    const valueId = String(candidate.value_id ?? '').trim();
    const allowed = attribute.allowed_values ?? [];

    if (allowed.length > 0) {
      const match = allowed.find(
        (value) =>
          value.id === valueId ||
          value.name.toLowerCase() === valueName.toLowerCase(),
      );
      if (!match) continue;
      result.push({ id, value_id: match.id });
      seen.add(id);
      continue;
    }

    if (valueName === '') continue;
    result.push({ id, value_name: valueName });
    seen.add(id);
  }

  return result;
}

/** Atributos obligatorios que quedaron sin valor después de sanitizar. */
export function missingRequiredAttributes(
  attributes: DraftAttribute[],
  categoryAttributes: MeliCategoryAttribute[],
): string[] {
  const present = new Set(attributes.map((attribute) => attribute.id));
  return categoryAttributes
    .filter((attribute) => attribute.required && !present.has(attribute.id))
    .map((attribute) => attribute.id);
}
