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

/** Tope de cordura: un costo mayor a esto es un dato mal cargado. */
export const MAX_FINANCING_COST = 0.5;

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
