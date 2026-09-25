import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseIntPipe,
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
  PreviewCoresaPublication,
  PreviewCoresaPublicationResult,
} from '../../../core/interactors/coresa/PreviewCoresaPublication';
import {
  PublishCoresaPublication,
  PublishCoresaPublicationResult,
} from '../../../core/interactors/coresa/PublishCoresaPublication';
import { PublicationDraft } from '../../../core/entities/PublicationDraft';
import { QueryCoresaPublications } from '../../../core/interactors/coresa/QueryCoresaPublications';
import {
  CoresaPublication,
  CoresaPublicationList,
  CoresaPublicationSummary,
} from '../../../core/entities/CoresaPublication';

class PreviewPublicationBody {
  sku: string;
  requestedBy?: string;
  categoryId?: string;
}

class PublishPublicationBody {
  draft?: Partial<PublicationDraft>;
  requestedBy?: string;
}

@ApiTags('Coresa Publications')
@ApiSecurity('internal-api-key')
@Controller('coresa/publications')
@UseGuards(InternalApiKeyGuard)
export class PublicationsCoresaController {
  private readonly logger = new Logger(PublicationsCoresaController.name);

  constructor(
    private readonly previewPublication: PreviewCoresaPublication,
    private readonly publishPublication: PublishCoresaPublication,
    private readonly queryPublications: QueryCoresaPublications,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Lista borradores y publicaciones, más nuevas primero. Fila liviana, sin los JSON del borrador',
  })
  @ApiQuery({ name: 'sku', required: false, example: 'AEB 35 SC/1' })
  @ApiQuery({
    name: 'status',
    required: false,
    example: 'published',
    description:
      'draft, ready, publishing, published, partial, failed o discarded',
  })
  @ApiQuery({ name: 'categoryId', required: false, example: 'MLA1591' })
  @ApiQuery({ name: 'from', required: false, example: '2026-09-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-09-30' })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  @ApiOkResponse({ description: 'Listado paginado' })
  async list(
    @Query('sku') sku?: string,
    @Query('status') status?: string,
    @Query('categoryId') categoryId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ): Promise<CoresaPublicationList> {
    return this.queryPublications.list({
      sku,
      status,
      categoryId,
      from,
      to,
      limit: limit === undefined ? undefined : Number(limit),
      offset: offset === undefined ? undefined : Number(offset),
    });
  }

  @Get('by-sku/:sku')
  @ApiOperation({ summary: 'La publicación más reciente de un SKU, completa' })
  @ApiParam({ name: 'sku', example: 'AEB 35 SC/1' })
  @ApiOkResponse({ description: 'La publicación' })
  async getBySku(@Param('sku') sku: string): Promise<CoresaPublication> {
    return this.queryPublications.getBySku(sku);
  }

  @Get('by-sku/:sku/history')
  @ApiOperation({
    summary: 'Todos los intentos de un SKU, más nuevo primero, en fila liviana',
  })
  @ApiParam({ name: 'sku', example: 'AEB 35 SC/1' })
  @ApiOkResponse({ description: 'Historial del SKU' })
  async getHistoryBySku(
    @Param('sku') sku: string,
  ): Promise<CoresaPublicationSummary[]> {
    return this.queryPublications.getHistoryBySku(sku);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Una publicación completa: borrador, validación, snapshot de Coresa y respuesta de ML',
  })
  @ApiParam({ name: 'id', example: 4 })
  @ApiOkResponse({ description: 'La publicación' })
  async getById(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CoresaPublication> {
    return this.queryPublications.getById(id);
  }

  @Post('preview')
  @ApiOperation({
    summary:
      'Arma el borrador de publicación de un SKU: categoría, atributos, contenido con OpenAI, precio y validación en ML',
  })
  @ApiBody({
    schema: {
      example: {
        sku: 'AEB 35 SC/1',
        requestedBy: 'arturo@solediluminacion.com',
      },
    },
  })
  @ApiOkResponse({ description: 'Borrador armado y validado' })
  async preview(
    @Body() body: PreviewPublicationBody,
  ): Promise<PreviewCoresaPublicationResult> {
    this.logger.log(`[preview] SKU ${body?.sku}`);
    return this.previewPublication.execute({
      sku: body?.sku,
      requestedBy: body?.requestedBy,
      categoryId: body?.categoryId,
    });
  }

  @Post(':id/publish')
  @ApiOperation({
    summary:
      'Publica el borrador en ML (clásica y premium) y guarda el resultado en internal-api',
  })
  @ApiParam({ name: 'id', example: 123 })
  @ApiBody({
    schema: {
      example: {
        draft: {
          title: 'Ángulo De Fijación Lateral Weidmuller Aeb 35 Sc/1',
          price: 2900,
          attributes: [{ id: 'MATERIAL', value_name: 'Plástico' }],
        },
        requestedBy: 'arturo@solediluminacion.com',
      },
    },
  })
  @ApiOkResponse({ description: 'Publicado, parcial o fallido' })
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: PublishPublicationBody,
  ): Promise<PublishCoresaPublicationResult> {
    this.logger.log(`[publish] publicación ${id}`);
    return this.publishPublication.execute({
      publicationId: id,
      draft: body?.draft,
      requestedBy: body?.requestedBy,
    });
  }
}
