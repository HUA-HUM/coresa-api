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
  FinancingCost,
  FinancingCostChanges,
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
      changes,
    );
    this.cache = null;
    this.logger.log(
      `[cuotas] ${modalidad} editada: ${Object.keys(changes).join(', ')}`,
    );
    return actualizada;
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
