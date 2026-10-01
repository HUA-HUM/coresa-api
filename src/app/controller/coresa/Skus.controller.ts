import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../guards/InternalApiKey.guard';
import {
  CoresaSkuInfo,
  GetCoresaSkuInfo,
} from '../../../core/interactors/coresa/GetCoresaSkuInfo';

@ApiTags('Coresa SKUs')
@ApiSecurity('internal-api-key')
@Controller('coresa/skus')
@UseGuards(InternalApiKeyGuard)
export class SkusCoresaController {
  constructor(private readonly skuInfo: GetCoresaSkuInfo) {}

  @Get(':sku')
  @ApiOperation({
    summary: 'Los datos de un SKU para elegir cómo publicarlo',
    description:
      'Lo que el panel necesita antes de armar el borrador: con cuántas unidades viene el empaque de Coresa, cuánto sale la unidad, cuánto stock hay y qué variantes ya están publicadas. No llama a OpenAI ni a MercadoLibre, así que responde en el acto y se puede pedir mientras el usuario escribe.',
  })
  @ApiParam({ name: 'sku', example: 'JDAC1345' })
  @ApiOkResponse({ description: 'Datos del SKU' })
  async get(@Param('sku') sku: string): Promise<CoresaSkuInfo> {
    return this.skuInfo.execute(sku);
  }
}
