import { CoresaProduct } from '../entities/CoresaProduct';
import { MeliCategoryAttribute } from '../entities/MeliCategory';
import { DraftAttribute } from '../entities/PublicationDraft';

export const MELI_TITLE_MAX_LENGTH = 60;
/** Cuántos valores permitidos se le muestran a OpenAI por atributo. */
export const MAX_ALLOWED_VALUES_IN_PROMPT = 30;

/**
 * Campos de Coresa que no aportan nada al contenido de la publicación. Las
 * URL van acá a propósito: si entran al prompt, la IA las escribe en la
 * descripción y MercadoLibre da de baja la publicación por mandar tráfico
 * afuera.
 */
const IGNORED_PRODUCT_FIELDS = new Set([
  'URL_Datasheet',
  'URL_Web',
  'URL_Imagen',
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

/**
 * ML penaliza y da de baja las publicaciones que mandan al comprador afuera,
 * así que de la descripción se sacan links, mails y teléfonos. Se borra la
 * oración entera y no solo la URL: quitar el link de "consultá la web del
 * proveedor en macroled.com.ar" deja una frase que no termina.
 *
 * Es la segunda línea de defensa. La primera es el prompt, pero el modelo
 * puede desobedecer y acá el costo de equivocarse es perder la publicación.
 */
const LINK_PATTERN =
  /(https?:\/\/|www\.)\S+|\b[\w.-]+@[\w.-]+\.\w{2,}\b|\b[\w-]+\.(com|net|org|ar|io|shop|store)(\.[a-z]{2})?\b|\+?\d[\d\s().-]{7,}\d/i;

export function stripExternalLinks(text: string): string {
  return String(text ?? '')
    .split(/\n{2,}/)
    .map((parrafo) =>
      parrafo
        .split(/(?<=[.!?])\s+/)
        .filter((oracion) => !LINK_PATTERN.test(oracion))
        .join(' ')
        .trim(),
    )
    .filter((parrafo) => parrafo !== '')
    .join('\n\n')
    .trim();
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
      // El value_id es lo que usa ML; el value_name va igual para que el
      // panel pueda mostrar "Plástico" y no "2748302".
      result.push({ id, value_id: match.id, value_name: match.name });
      seen.add(id);
      continue;
    }

    if (valueName === '') continue;

    // Los tipos numéricos tienen un formato que ML valida de forma estricta.
    const tipo = String(attribute.value_type ?? '').toLowerCase();
    if (tipo === 'number_unit') {
      const normalizado = normalizeNumberUnit(
        valueName,
        attribute.allowed_units ?? [],
      );
      if (normalizado === null) continue;
      result.push({ id, value_name: normalizado });
      seen.add(id);
      continue;
    }
    if (tipo === 'number') {
      const normalizado = normalizeNumber(valueName);
      if (normalizado === null) continue;
      result.push({ id, value_name: normalizado });
      seen.add(id);
      continue;
    }

    result.push({ id, value_name: valueName });
    seen.add(id);
  }

  return result;
}

/**
 * Un atributo de tipo number_unit tiene que ir como "<número> <unidad>", con
 * una de las unidades que admite ML para ese atributo. Si la unidad no es una
 * de esas, ML rechaza la publicación entera, así que el atributo se descarta:
 * publicar sin un dato opcional es mucho menos grave que no publicar.
 *
 * Cuando el modelo devuelve el número pelado y el atributo admite una sola
 * unidad, no hay ambigüedad posible y se completa. Con dos o más, no se
 * adivina: 6,35 puede ser mm o cm y la diferencia es un orden de magnitud.
 */
export function normalizeNumberUnit(
  value: string,
  allowedUnits: string[],
): string | null {
  const match = /^\s*(-?[\d.,]+)\s*(.*)$/.exec(value);
  if (!match) return null;

  const numero = match[1].replace(',', '.');
  if (!Number.isFinite(Number(numero))) return null;

  const unidad = match[2].trim();
  if (unidad === '') {
    return allowedUnits.length === 1 ? `${numero} ${allowedUnits[0]}` : null;
  }

  const permitida = allowedUnits.find(
    (u) => u.toLowerCase() === unidad.toLowerCase(),
  );
  return permitida ? `${numero} ${permitida}` : null;
}

/** Un number va sin unidad: ML rechaza "20 W" donde espera "20". */
export function normalizeNumber(value: string): string | null {
  const match = /^\s*(-?[\d.,]+)/.exec(value);
  if (!match) return null;
  const numero = match[1].replace(',', '.');
  return Number.isFinite(Number(numero)) ? numero : null;
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
