import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ICoresaRepository,
  ICoresaRepositoryToken,
} from '../../adapters/repositories/ICoresaRepository';
import {
  ICoresaPublicationRepository,
  ICoresaPublicationRepositoryToken,
} from '../../adapters/repositories/ICoresaPublicationRepository';
import {
  IExchangeRateRepository,
  IExchangeRateRepositoryToken,
} from '../../adapters/repositories/IExchangeRateRepository';
import {
  IMeliPublishRepository,
  IMeliPublishRepositoryToken,
} from '../../adapters/repositories/IMeliPublishRepository';
import {
  IProductEnrichmentRepository,
  IProductEnrichmentRepositoryToken,
} from '../../adapters/repositories/IProductEnrichmentRepository';
import { CoresaPublication } from '../../entities/CoresaPublication';
import { MeliCategorySuggestion } from '../../entities/MeliCategory';
import {
  PublicationDraft,
  PublicationValidation,
} from '../../entities/PublicationDraft';
import { getDiscountPercent } from '../../utils/coresaPriceStock';
import { missingRequiredAttributes } from '../../utils/enrichment';
import { buildPublicationDraft } from '../../utils/publicationDraft';

export class PreviewCoresaPublicationInput {
  sku: string;
  requestedBy?: string;
  categoryId?: string;
}

export class PreviewCoresaPublicationResult {
  publicationId: number | null;
  sku: string;
  categoryId: string;
  categorySuggestions: MeliCategorySuggestion[];
  draft: PublicationDraft;
  validation: PublicationValidation;
  missingRequiredAttributes: string[];
  status: string;
}

@Injectable()
export class PreviewCoresaPublication {
  private readonly logger = new Logger(PreviewCoresaPublication.name);

  constructor(
    @Inject(ICoresaRepositoryToken)
    private readonly coresaRepo: ICoresaRepository,
    @Inject(IMeliPublishRepositoryToken)
    private readonly meliPublish: IMeliPublishRepository,
    @Inject(IProductEnrichmentRepositoryToken)
    private readonly enrichment: IProductEnrichmentRepository,
    @Inject(ICoresaPublicationRepositoryToken)
    private readonly publications: ICoresaPublicationRepository,
    @Inject(IExchangeRateRepositoryToken)
    private readonly exchangeRate: IExchangeRateRepository,
  ) {}

  /** Permite trabajar en local mientras internal-api todavía no tiene la tabla. */
  private get registryEnabled(): boolean {
    return (
      String(process.env.PUBLICATIONS_REGISTRY_ENABLED ?? 'true').trim() !==
      'false'
    );
  }

  async execute(
    input: PreviewCoresaPublicationInput,
  ): Promise<PreviewCoresaPublicationResult> {
    const sku = String(input.sku ?? '').trim();
    if (!sku) throw new BadRequestException('sku es obligatorio');

    const product = await this.coresaRepo.getProductBySku(sku);
    if (!product) {
      throw new NotFoundException(`SKU ${sku} no existe en el catálogo Coresa`);
    }

    const baseTitle = String(product.Descripcion ?? sku).trim();
    const suggestions = input.categoryId
      ? []
      : await this.meliPublish.predictCategories(baseTitle);
    const categoryId = input.categoryId ?? suggestions[0]?.category_id;
    if (!categoryId) {
      throw new BadRequestException(
        `No se pudo predecir la categoría de ML para "${baseTitle}". Mandá categoryId a mano.`,
      );
    }

    const categoryAttributes =
      await this.meliPublish.getCategoryAttributes(categoryId);

    const [content, usdBna] = await Promise.all([
      this.enrichment.buildContent(product, categoryAttributes),
      this.exchangeRate.getUsdBnaSell(),
    ]);

    const draft = buildPublicationDraft({
      product,
      categoryId,
      content,
      usdBna,
      discountPercent: getDiscountPercent(),
      allowedAttributeIds: new Set(
        categoryAttributes.map((attribute) => attribute.id),
      ),
    });

    const validation = await this.meliPublish.validateItem(draft);
    const isValid = Object.values(validation?.results ?? {}).every(
      (result) => result?.valid,
    );

    const publication = await this.registerPreview({
      sku,
      requestedBy: input.requestedBy,
      product,
      draft,
      categoryId,
      validation,
      isValid,
    });

    this.logger.log(
      `[preview] SKU ${sku} categoría ${categoryId} precio ${draft.price} stock ${draft.available_quantity} válido=${isValid}`,
    );

    return {
      publicationId: publication?.id ?? null,
      sku,
      categoryId,
      categorySuggestions: suggestions,
      draft,
      validation,
      missingRequiredAttributes: missingRequiredAttributes(
        draft.attributes,
        categoryAttributes,
      ),
      status: publication?.status ?? (isValid ? 'ready' : 'draft'),
    };
  }

  private async registerPreview(params: {
    sku: string;
    requestedBy?: string;
    product: Awaited<ReturnType<ICoresaRepository['getProductBySku']>>;
    draft: PublicationDraft;
    categoryId: string;
    validation: PublicationValidation;
    isValid: boolean;
  }): Promise<CoresaPublication | null> {
    if (!this.registryEnabled) return null;

    const created = await this.publications.create({
      sku: params.sku,
      requestedBy: params.requestedBy ?? null,
      coresaSnapshot: params.product!,
      draft: params.draft,
      categoryId: params.categoryId,
      aiModel: String(process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'),
      aiGeneratedAt: new Date().toISOString(),
    });

    return this.publications.update(created.id, {
      status: params.isValid ? 'ready' : 'draft',
      validation: params.validation,
    });
  }
}
