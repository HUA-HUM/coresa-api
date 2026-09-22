import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PreviewCoresaPublication,
  PreviewCoresaPublicationResult,
} from '../../../core/interactors/coresa/PreviewCoresaPublication';

class PreviewPublicationBody {
  sku: string;
  requestedBy?: string;
  categoryId?: string;
}

@ApiTags('Coresa Publications')
@Controller('coresa/publications')
export class PublicationsCoresaController {
  private readonly logger = new Logger(PublicationsCoresaController.name);

  constructor(private readonly previewPublication: PreviewCoresaPublication) {}

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
}
