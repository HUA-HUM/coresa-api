import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../guards/InternalApiKey.guard';
import {
  costToFactor,
  FinancingCost,
} from '../../../core/entities/FinancingCost';
import { FinancingCosts } from '../../../core/interactors/coresa/FinancingCosts';

class UpdateModalidadBody {
  etiqueta?: string;
  /** Fracción, no porcentaje: 21,6% es 0.216. Entre 0 y 0.5. */
  costo?: number;
  /**
   * Alternativa a costo, para editar desde el multiplicador: 1.2755 equivale
   * a un costo de 0.216. Se manda uno de los dos, no los dos.
   */
  coeficiente?: number;
  activa?: boolean;
  actualizadoPor?: string;
}

class CreateModalidadBody {
  modalidad: string;
  etiqueta: string;
  costo: number;
  actualizadoPor?: string;
}

/**
 * La pantalla de costos de financiación del panel. El panel habla solo con
 * coresa-api, así que estos endpoints envuelven los de internal-api: una sola
 * API key en el front en lugar de dos.
 */
@ApiTags('Coresa Modalidades')
@ApiSecurity('internal-api-key')
@Controller('coresa/modalidades')
@UseGuards(InternalApiKeyGuard)
export class ModalidadesCoresaController {
  private readonly logger = new Logger(ModalidadesCoresaController.name);

  constructor(private readonly financingCosts: FinancingCosts) {}

  @Get()
  @ApiOperation({
    summary: 'Las modalidades de cuotas con su costo',
    description:
      'El costo es lo que ML nos cobra por ofrecer esa financiación, como fracción del precio de venta (0.216 es 21,6%). El precio de venta se calcula dividiendo por (1 - costo): en 12 cuotas, multiplicar por 1,216 dejaría casi seis puntos abajo. Sin el parámetro activa devuelve también las desactivadas, para la pantalla de administración.',
  })
  @ApiQuery({ name: 'activa', required: false, example: 'true' })
  @ApiOkResponse({ description: 'Modalidades con su costo y coeficiente' })
  async list(
    @Query('activa') activa?: string,
  ): Promise<{ items: (FinancingCost & { coeficiente: number })[] }> {
    const items =
      String(activa).toLowerCase() === 'true'
        ? await this.financingCosts.listActive()
        : await this.financingCosts.list();

    // El coeficiente viaja calculado para que el panel muestre el mismo
    // número que usa el publicador, sin repetir la cuenta en el front.
    return {
      items: items.map((cost) => ({
        ...cost,
        coeficiente: costToFactor(cost.costo),
      })),
    };
  }

  @Patch(':modalidad')
  @ApiOperation({
    summary: 'Cambia el costo, la etiqueta o el estado de una modalidad',
    description:
      'El costo y el coeficiente son el mismo dato: se puede editar cualquiera de los dos y se guarda el costo. Afecta el precio de lo que se publique de ahí en adelante. Las publicaciones que ya existen no se tocan: el actualizador usa el price_factor guardado en cada una. Para dejar de ofrecer una modalidad se manda activa: false; no se borra, porque hay publicaciones que la usan.',
  })
  @ApiParam({ name: 'modalidad', example: '12_cuotas' })
  @ApiBody({
    schema: {
      example: { costo: 0.23, actualizadoPor: 'arturo@solediluminacion.com' },
      description:
        'Se puede mandar costo (0.23) o coeficiente (1.2987), que son el mismo dato. Se guarda el costo.',
    },
  })
  @ApiOkResponse({ description: 'Modalidad actualizada' })
  async update(
    @Param('modalidad') modalidad: string,
    @Body() body: UpdateModalidadBody,
  ): Promise<FinancingCost | null> {
    this.logger.log(`[modalidades] editando ${modalidad}`);
    return this.financingCosts.update(modalidad, body ?? {});
  }

  @Post()
  @ApiOperation({
    summary: 'Crea una modalidad nueva',
    description:
      'Para cuando ML saca una promoción que hoy no existe, sin tocar código.',
  })
  @ApiBody({
    schema: {
      example: {
        modalidad: '18_cuotas',
        etiqueta: '18 cuotas',
        costo: 0.28,
        actualizadoPor: 'arturo@solediluminacion.com',
      },
    },
  })
  @ApiOkResponse({ description: 'Modalidad creada' })
  async create(
    @Body() body: CreateModalidadBody,
  ): Promise<FinancingCost | null> {
    this.logger.log(`[modalidades] creando ${body?.modalidad}`);
    return this.financingCosts.create(body);
  }
}
