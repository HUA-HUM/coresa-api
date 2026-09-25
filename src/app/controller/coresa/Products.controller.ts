import { Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../guards/InternalApiKey.guard';
import { SyncCoresaCatalog } from '../../../core/interactors/coresa/SyncCoresaCatalog';
import { SyncCoresaProductsToMercadoLibreApi } from '../../../core/interactors/coresa/SyncCoresaProductsToMercadoLibreApi';

@ApiTags('Coresa Products')
@ApiSecurity('internal-api-key')
@Controller('coresa')
@UseGuards(InternalApiKeyGuard)
export class ProductsCoresaController {
  private readonly logger = new Logger(ProductsCoresaController.name);

  constructor(
    private readonly syncCoresaCatalog: SyncCoresaCatalog,
    private readonly syncCoresaProductsToMercadoLibre: SyncCoresaProductsToMercadoLibreApi,
  ) {}

  @Post('sync')
  @ApiOperation({
    summary:
      'Catálogo Coresa completo → precio de pack en pesos y stock total → upsert coresa_products',
  })
  @ApiOkResponse({ description: 'Catálogo sincronizado' })
  async sync() {
    this.logger.log('Trigger local: sync de catálogo Coresa');
    const result = await this.syncCoresaCatalog.execute();
    return { message: 'Catálogo Coresa sincronizado', ...result };
  }

  @Get('products')
  @ApiOperation({
    summary: 'Igual que POST /coresa/sync (útil para probar desde el browser)',
  })
  @ApiOkResponse({ description: 'Catálogo sincronizado' })
  async getProducts() {
    this.logger.log('Trigger local GET: sync de catálogo Coresa');
    const result = await this.syncCoresaCatalog.execute();
    return { message: 'Catálogo Coresa sincronizado', ...result };
  }

  @Post('sync-meli')
  @ApiOperation({
    summary:
      'coresa_products_in_mercadolibre vs mercadolibre_products → actualiza precio y/o stock según updatePrice y updateStock',
  })
  @ApiOkResponse({ description: 'Publicaciones Mercado Libre sincronizadas' })
  async syncMeli() {
    this.logger.log('Trigger local: sync de productos Coresa a Mercado Libre');
    const result = await this.syncCoresaProductsToMercadoLibre.execute();
    return {
      message: 'Productos Coresa sincronizados en Mercado Libre',
      ...result,
    };
  }
}
