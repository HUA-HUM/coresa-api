import { Controller, Get, Logger, Post, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../guards/InternalApiKey.guard';
import { SyncCoresaCatalog } from '../../../core/interactors/coresa/SyncCoresaCatalog';

@ApiTags('Coresa Products')
@ApiSecurity('internal-api-key')
@Controller('coresa')
@UseGuards(InternalApiKeyGuard)
export class ProductsCoresaController {
  private readonly logger = new Logger(ProductsCoresaController.name);

  constructor(private readonly syncCoresaCatalog: SyncCoresaCatalog) {}

  @Post('sync')
  @ApiOperation({
    summary:
      'Cron: catálogo Coresa → lookup ML por SKU → upsert precio/stock ARS de publicaciones active',
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
}
