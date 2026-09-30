import { scalarToString, toNumber } from '../utils/coresaPriceStock';
import { unwrapList } from './CoresaMercadoLibre';

/**
 * Lo que ML nos cobra por ofrecer una modalidad de cuotas, como fracción del
 * precio de venta. Vive en internal-api para poder editarlo sin un deploy:
 * cuando ML cambia lo que cobra, se toca la tabla y listo.
 */
export class FinancingCost {
  modalidad: string;
  etiqueta: string;
  /** Fracción, no porcentaje: 21,6% es 0.216. */
  costo: number;
  activa: boolean;
}

/** Lo que se puede cambiar de una modalidad ya cargada. */
export class FinancingCostChanges {
  etiqueta?: string;
  costo?: number;
  /** Alternativa a costo, para quien piensa en multiplicador. */
  coeficiente?: number;
  activa?: boolean;
  actualizadoPor?: string;
}

/** Una modalidad nueva: sirve cuando ML saca una promo que hoy no existe. */
export class NewFinancingCost {
  modalidad: string;
  etiqueta: string;
  costo: number;
  actualizadoPor?: string;
}

/** Tope de cordura: un costo mayor a esto es un dato mal cargado. */
export const MAX_FINANCING_COST = 0.5;

/** El coeficiente que corresponde al tope: 1 / (1 - 0,5). */
export const MAX_FINANCING_FACTOR = 1 / (1 - MAX_FINANCING_COST);

/**
 * El costo y el coeficiente son el mismo dato visto de dos maneras: el costo
 * es lo que ML se lleva del precio de venta, y el coeficiente es por cuánto
 * hay que multiplicar para que ese descuento no nos lo coma.
 *
 * Se guarda el costo, que es el hecho; el coeficiente es la cuenta. Quien
 * prefiera pensar en coeficiente lo manda y acá se convierte, así la
 * conversión vive en un solo lado.
 */
export function factorToCost(factor: number): number {
  // Cuatro decimales, que es lo que admite la columna.
  return Math.round((1 - 1 / factor) * 10000) / 10000;
}

export function costToFactor(costo: number): number {
  return costo < 1 ? 1 / (1 - costo) : 1;
}

export function mapFinancingCost(payload: unknown): FinancingCost | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as Record<string, unknown>;

  const modalidad = scalarToString(row.modalidad)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
  if (!modalidad) return null;

  const costo = toNumber(row.costo);
  // Un costo fuera de rango se descarta en vez de cotizar con él: con 5 en
  // lugar de 0.05 toda publicación nueva saldría al doble.
  if (!(costo >= 0) || costo > MAX_FINANCING_COST) return null;

  return {
    modalidad,
    etiqueta: scalarToString(row.etiqueta).trim() || modalidad,
    costo,
    activa: row.activa === undefined ? true : Boolean(row.activa),
  };
}

export function mapFinancingCosts(payload: unknown): FinancingCost[] {
  return unwrapList(payload)
    .map((item) => mapFinancingCost(item))
    .filter((item): item is FinancingCost => item !== null);
}
