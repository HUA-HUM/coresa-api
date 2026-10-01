import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import {
  factorToCost,
  FinancingCost,
  FinancingCostChanges,
  MAX_FINANCING_COST,
  MAX_FINANCING_FACTOR,
  NewFinancingCost,
} from '../../entities/FinancingCost';
import {
  canonicalModalidad,
  FINANCING_COST,
} from '../../entities/PublicationVariant';

/** Los valores compilados, por si internal-api no contesta. */
export const FALLBACK_COSTS: FinancingCost[] = Object.entries(
  FINANCING_COST,
).map(([modalidad, costo]) => ({
  modalidad,
  etiqueta: modalidad,
  costo,
  activa: true,
}));

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/**
 * Los costos de financiación salen de internal-api, donde se pueden editar
 * sin un deploy. Se guardan unos minutos en memoria porque cambian muy de vez
 * en cuando y el preview los pide en cada publicación.
 *
 * Si internal-api no contesta se usan los valores compilados: quedarse sin
 * cotizar sería peor que cotizar con un costo de hace unos días.
 */
@Injectable()
export class FinancingCosts {
  private readonly logger = new Logger(FinancingCosts.name);
  private cache: { at: number; items: FinancingCost[] } | null = null;

  constructor(
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  private get ttl(): number {
    const ttl = Number(process.env.FINANCING_COSTS_TTL_MS ?? DEFAULT_TTL_MS);
    return Number.isFinite(ttl) && ttl >= 0 ? ttl : DEFAULT_TTL_MS;
  }

  async list(): Promise<FinancingCost[]> {
    if (this.cache && Date.now() - this.cache.at < this.ttl) {
      return this.cache.items;
    }

    try {
      const items = await this.internalApi.listFinancingCosts();
      if (items.length === 0) {
        this.logger.warn(
          '[cuotas] internal-api devolvió la tabla vacía, se usan los valores compilados',
        );
        return FALLBACK_COSTS;
      }
      this.cache = { at: Date.now(), items };
      return items;
    } catch (err) {
      this.logger.warn(
        `[cuotas] no se pudieron leer los costos de internal-api, se usan los compilados: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return this.cache?.items ?? FALLBACK_COSTS;
    }
  }

  /** Solo las que se ofrecen hoy, para el desplegable del panel. */
  async listActive(): Promise<FinancingCost[]> {
    return (await this.list()).filter((cost) => cost.activa);
  }

  /**
   * Cambiar un costo cambia el precio de todo lo que se publique despues, asi
   * que el cache se tira al piso: seguir cotizando cinco minutos con el valor
   * viejo despues de que alguien lo corrigio en el panel seria peor que
   * pedirlo de nuevo.
   */
  async update(
    modalidad: string,
    changes: FinancingCostChanges,
  ): Promise<FinancingCost | null> {
    const actualizada = await this.internalApi.updateFinancingCost(
      canonicalModalidad(modalidad),
      this.resolveCost(changes),
    );
    this.cache = null;
    this.logger.log(
      `[cuotas] ${modalidad} editada: ${Object.keys(changes).join(', ')}`,
    );
    return actualizada;
  }

  /**
   * El panel puede mandar el costo o el coeficiente. Se guarda siempre el
   * costo: es el dato que da ML, y tener las dos columnas en la base sería
   * tener dos versiones de lo mismo que se pueden contradecir.
   */
  private resolveCost(changes: FinancingCostChanges): FinancingCostChanges {
    const { coeficiente, ...resto } = changes;
    if (coeficiente === undefined) return resto;

    if (resto.costo !== undefined) {
      throw new BadRequestException(
        'Mandá costo o coeficiente, no los dos: son el mismo dato',
      );
    }
    if (
      !Number.isFinite(coeficiente) ||
      coeficiente < 1 ||
      coeficiente > MAX_FINANCING_FACTOR
    ) {
      throw new BadRequestException(
        `El coeficiente tiene que estar entre 1 y ${MAX_FINANCING_FACTOR.toFixed(2)}`,
      );
    }

    const costo = factorToCost(coeficiente);
    if (costo < 0 || costo > MAX_FINANCING_COST) {
      throw new BadRequestException(
        `Ese coeficiente da un costo de ${costo}, fuera de 0 a ${MAX_FINANCING_COST}`,
      );
    }
    return { ...resto, costo };
  }

  async create(cost: NewFinancingCost): Promise<FinancingCost | null> {
    const modalidad = canonicalModalidad(cost.modalidad);
    if (!modalidad) {
      throw new BadRequestException('modalidad es obligatoria');
    }

    const creada = await this.internalApi.createFinancingCost({
      ...cost,
      modalidad,
      etiqueta: cost.etiqueta?.trim() || modalidad,
    });
    this.cache = null;
    this.logger.log(`[cuotas] modalidad nueva: ${modalidad}`);
    return creada;
  }

  /**
   * El multiplicador de la modalidad. El costo se descuenta del precio de
   * venta, así que se divide por (1 - costo): en 12 cuotas, multiplicar por
   * 1,216 dejaría casi seis puntos abajo.
   *
   * Devuelve null si la modalidad no existe o está desactivada: ahí no se
   * puede cotizar sola y hace falta un priceFactor explícito.
   */
  async factorFor(
    modalidad: string | null | undefined,
  ): Promise<number | null> {
    const buscada = canonicalModalidad(modalidad);
    const cost = (await this.list()).find(
      (item) => item.modalidad === buscada && item.activa,
    );
    if (!cost || cost.costo >= 1) return null;
    return 1 / (1 - cost.costo);
  }
}
