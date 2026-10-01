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

export class CoresaSkuInfo {
  sku: string;
  descripcion: string;
  marca: string;
  /** Cuántas unidades trae el empaque de Coresa (CantIntermedia). */
  empaque: number;
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

    const empaque = baseUnitsOf(stored);
    const precioEmpaque = Math.round(toNumber(stored.Precio_Convertido));
    const disponible = Math.floor(toNumber(stored.Disponible));

    return {
      sku,
      descripcion: String(
        product?.Descripcion ?? stored.Descripcion ?? '',
      ).trim(),
      marca: String(product?.Marca ?? stored.Marca ?? '').trim(),
      empaque,
      precioEmpaque,
      // El precio unitario es la base de todo cálculo de precio.
      precioUnitario: Math.round(precioEmpaque / empaque),
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
