export class CoresaProduct {
  SKU: string;
  CodBarra_Unitario?: string;
  CodBarra_Intermedio?: string;
  CodBarra_Master?: string;
  Descripcion?: string;
  Marca?: string;
  Macro_Familia?: string;
  Sub_Familia?: string;
  Cod_Alternativo?: string;
  Disponible?: number | string;
  Unidad_Medida?: string;
  Minimo_Venta?: boolean;
  Venta_Unitaria?: boolean;
  Precio_Lista_1?: number | string;
  Precio_Convertido?: number;
  /**
   * A cuántas unidades corresponde Precio_Convertido. Coresa cotiza por su
   * empaque, así que sin este dato no se puede sacar el precio unitario.
   */
  base_units?: number | string;
  Impuestos?: string;
  Moneda?: string;
  CantMaster?: number | string;
  CantIntermedia?: number | string;
  CantMinima?: number | string;
  Alto_cm?: number | string;
  Ancho_cm?: number | string;
  Largo_cm?: number | string;
  Dimensiones_Texto?: string;
  Peso_kg?: number | string;
  Volumen_cc?: number | string;
  Material?: string;
  Color?: string;
  Tipo_Montaje?: string;
  Tipo_Instalacion?: string;
  Soporte?: string;
  IP?: string;
  IK?: string;
  Anti_Vandalico?: string;
  Apto_Exterior?: string;
  Alimentacion?: string;
  Tension_Entrada?: string;
  Tension_Salida?: string;
  Potencia_Nominal?: string;
  Potencia_Max?: string;
  Corriente?: string;
  Polos?: string;
  Ciclos_Electricos?: string;
  Ciclos_Mecanicos?: string;
  Lumenes?: string;
  Temp_Color?: string;
  Angulo?: string;
  Dimerizable?: string;
  Tipo_Luz?: string;
  Tipo_Camara?: string;
  Tipo_Lente?: string;
  Resolucion?: string;
  Canales?: string;
  Mic?: string;
  Audio_Bidireccional?: string;
  Reconocimiento_IA?: string;
  Capacidad_Rostros?: string;
  SATA?: string;
  HDMI?: string;
  Tipo_Conexion?: string;
  Tipo_Conector?: string;
  POE?: string;
  Puertos_POE?: string;
  Ancho_Banda?: string;
  URL_Datasheet?: string;
  URL_Web?: string;
  URL_Imagen?: string;
  Certificado?: string;
}

/**
 * Lo que informa el barrido de discontinuados.
 *
 * La API de Coresa no manda los productos sin stock en 0: los saca del
 * catálogo. Y el sync solo hace upsert, así que lo que no vino en la corrida
 * se queda con el último stock informado para siempre. El barrido cierra ese
 * círculo: pone en 0 lo que no quedó marcado con el id de la corrida.
 */
export class CoresaDiscontinuedSweep {
  /** Cuántas filas quedaron en 0. */
  updated: number;
  /** Si el servidor frenó el barrido por superar el tope. */
  refused: boolean;
  /** Cuántas habría puesto en 0. Viene cuando lo frenó el tope. */
  wouldUpdate: number | null;
  /** Los SKUs que se dieron de baja, para poder revisarlos. */
  skus: string[];
}

/**
 * Lee la respuesta del barrido sin atarse a una sola forma: internal-api
 * mezcla camelCase y snake_case, y a veces envuelve en { data }.
 *
 * Si el servidor frenó el barrido, lo dice con refused/skipped o simplemente
 * no actualizando nada pero informando cuántas habría tocado. Las dos formas
 * se leen igual acá.
 */
export function mapDiscontinuedSweep(
  payload: unknown,
): CoresaDiscontinuedSweep {
  const root =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {};
  const body =
    root.data && typeof root.data === 'object' && !Array.isArray(root.data)
      ? (root.data as Record<string, unknown>)
      : root;

  const num = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = Number(body[key]);
      if (body[key] !== undefined && body[key] !== null && !isNaN(value)) {
        return value;
      }
    }
    return null;
  };

  const updated = num('updated', 'affected', 'count') ?? 0;
  const wouldUpdate = num('would_update', 'wouldUpdate', 'pending');
  const flagged = Boolean(
    body.refused ?? body.skipped ?? body.aborted ?? false,
  );
  const skus = Array.isArray(body.skus)
    ? body.skus.map((sku) => String(sku))
    : [];

  return {
    updated,
    // Que informe cuántas habría tocado y no haya tocado ninguna es la otra
    // manera de decir "lo frené": se toma como freno igual.
    refused: flagged || (updated === 0 && (wouldUpdate ?? 0) > 0),
    wouldUpdate,
    skus,
  };
}
