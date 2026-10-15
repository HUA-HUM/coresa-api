import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ICoresaRepository,
  ICoresaRepositoryToken,
} from '../../adapters/repositories/ICoresaRepository';
import {
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import { CoresaProductInMercadoLibre } from '../../entities/CoresaMercadoLibre';
import { baseUnitsOf } from '../../entities/PublicationVariant';
import { toNumber } from '../../utils/coresaPriceStock';

/** De qué campo de Coresa salió el empaque con el que se publica. */
export type OrigenDelEmpaque = 'intermedia' | 'master' | 'unidad';

/**
 * Con cuántas unidades conviene publicar.
 *
 * Coresa manda dos cantidades y en casi la mitad del catálogo la intermedia
 * viene en 0: 2595 de 5544 productos tienen intermedia 0 o 1 y master mayor a
 * 1. Para esos la caja real es la master, y sugerir una unidad suelta es
 * sugerir algo que el proveedor no despacha.
 */
export function empaqueDe(
  intermedia: number,
  master: number,
): { empaque: number; empaqueOrigen: OrigenDelEmpaque } {
  if (intermedia > 1) {
    return { empaque: intermedia, empaqueOrigen: 'intermedia' };
  }
  if (master > 1) return { empaque: master, empaqueOrigen: 'master' };
  return { empaque: 1, empaqueOrigen: 'unidad' };
}

export class CoresaSkuInfo {
  sku: string;
  descripcion: string;
  marca: string;
  /** Cuántas unidades trae la caja con la que conviene publicar. */
  empaque: number;
  /** De dónde salió ese número, para que el panel lo pueda explicar. */
  empaqueOrigen: OrigenDelEmpaque;
  /** Los dos campos de Coresa, tal como vienen. */
  cantidadIntermedia: number;
  cantidadMaster: number;
  /** Lo que sale ese empaque: es el precio que compone Coresa. */
  precioEmpaque: number;
  precioUnitario: number;
  disponible: number;
  /** Cuántas publicaciones salen si se vende por empaque. */
  empaquesDisponibles: number;
  /** Lo que conviene poner en unitsPerListing si se publica por empaque. */
  unidadesSugeridas: number;
  /** Si Coresa marca el producto como vendible por unidad. */
  ventaUnitaria: boolean;
  variantesPublicadas: CoresaProductInMercadoLibre[];
}

/**
 * Los datos que el panel necesita ANTES de armar el borrador: con cuántas
 * unidades viene el empaque, cuánto sale la unidad y qué variantes ya existen.
 *
 * Va aparte del preview a propósito: el usuario elige las unidades antes de
 * publicar, y el preview cuesta una llamada a OpenAI. Esto no llama a OpenAI
 * ni a MercadoLibre, así que responde en el acto.
 */
@Injectable()
export class GetCoresaSkuInfo {
  constructor(
    @Inject(ICoresaRepositoryToken)
    private readonly coresaRepo: ICoresaRepository,
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  async execute(rawSku: string): Promise<CoresaSkuInfo> {
    const sku = String(rawSku ?? '').trim();
    if (!sku) throw new BadRequestException('sku es obligatorio');

    const [product, stored, variantes] = await Promise.all([
      this.coresaRepo.getProductBySku(sku),
      this.internalApi.getCoresaProductBySku(sku),
      this.variantesDe(sku),
    ]);

    if (!product && !stored) {
      throw new NotFoundException(`SKU ${sku} no existe en el catálogo Coresa`);
    }
    if (!stored) {
      throw new BadRequestException(
        `El SKU ${sku} está en Coresa pero todavía no en coresa_products. Corré el sync de catálogo.`,
      );
    }

    const fuente = product ?? stored;
    const intermedia = Math.floor(toNumber(fuente.CantIntermedia));
    const master = Math.floor(toNumber(fuente.CantMaster));
    const { empaque, empaqueOrigen } = empaqueDe(intermedia, master);

    const precioEmpaque = Math.round(toNumber(stored.Precio_Convertido));
    const disponible = Math.floor(toNumber(stored.Disponible));
    // base_units es a cuántas unidades corresponde Precio_Convertido, y no es
    // lo mismo que el empaque: cuando Coresa no manda intermedia, el precio es
    // por unidad y la caja es la master.
    const baseUnits = baseUnitsOf(stored);

    return {
      sku,
      descripcion: String(
        product?.Descripcion ?? stored.Descripcion ?? '',
      ).trim(),
      marca: String(product?.Marca ?? stored.Marca ?? '').trim(),
      empaque,
      empaqueOrigen,
      cantidadIntermedia: intermedia,
      cantidadMaster: master,
      precioEmpaque,
      // El precio unitario es la base de todo cálculo de precio.
      precioUnitario: Math.round(precioEmpaque / baseUnits),
      disponible,
      empaquesDisponibles: Math.floor(disponible / empaque),
      unidadesSugeridas: empaque,
      ventaUnitaria: Boolean(product?.Venta_Unitaria ?? stored.Venta_Unitaria),
      variantesPublicadas: variantes,
    };
  }

  /** Si internal-api no contesta, el panel igual puede mostrar el empaque. */
  private async variantesDe(
    sku: string,
  ): Promise<CoresaProductInMercadoLibre[]> {
    try {
      return await this.internalApi.listVariantsBySku(sku);
    } catch {
      return [];
    }
  }
}
