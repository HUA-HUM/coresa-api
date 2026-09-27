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
  IInternalApiRepository,
  IInternalApiRepositoryToken,
} from '../../adapters/repositories/IInternalApiRepository';
import {
  IMeliPublishRepository,
  IMeliPublishRepositoryToken,
} from '../../adapters/repositories/IMeliPublishRepository';
import {
  IProductEnrichmentRepository,
  IProductEnrichmentRepositoryToken,
} from '../../adapters/repositories/IProductEnrichmentRepository';
import { CoresaPublication } from '../../entities/CoresaPublication';
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  MeliCategoryAttribute,
  MeliCategorySuggestion,
} from '../../entities/MeliCategory';
import {
  PublicationDraft,
  PublicationValidation,
} from '../../entities/PublicationDraft';
import { toNumber } from '../../utils/coresaPriceStock';
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
  /** Obligatorios que no estaban en los datos de Coresa y dedujo la IA. */
  inferredAttributes: string[];
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
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
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

    const [content, priceAndStock] = await Promise.all([
      this.enrichment.buildContent(product, categoryAttributes),
      this.priceAndStockFor(sku),
    ]);

    const draft = buildPublicationDraft({
      product,
      categoryId,
      content,
      price: priceAndStock.price,
      availableQuantity: priceAndStock.availableQuantity,
      allowedAttributeIds: new Set(
        categoryAttributes.map((attribute) => attribute.id),
      ),
    });

    let validation = await this.meliPublish.validateItem(draft);
    let missing = missingRequiredAttributes(
      draft.attributes,
      categoryAttributes,
    );

    // Un obligatorio vacío hace que ML rechace todo, así que se completa y se
    // revalida una vez. Sin esto el borrador queda trabado esperando que
    // alguien escriba a mano un dato que la IA puede deducir.
    const inferredAttributes = await this.completeMissing(
      product,
      categoryAttributes,
      draft,
      missing,
    );

    if (inferredAttributes.length > 0) {
      validation = await this.meliPublish.validateItem(draft);
      missing = missingRequiredAttributes(draft.attributes, categoryAttributes);
    }

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
      missingRequiredAttributes: missing,
      inferredAttributes,
      status: publication?.status ?? (isValid ? 'ready' : 'draft'),
    };
  }

  /**
   * Precio y stock salen de coresa_products, que es lo que el sync de
   * catálogo deja calculado y lo que después el actualizador mantiene. Si el
   * SKU no está ahí, no se publica: publicarlo con otro precio dejaría la
   * publicación desincronizada desde el primer día.
   */
  private async priceAndStockFor(
    sku: string,
  ): Promise<{ price: number; availableQuantity: number }> {
    const stored = await this.internalApi.getCoresaProductBySku(sku);
    if (!stored) {
      throw new BadRequestException(
        `El SKU ${sku} no está en coresa_products. Corré el sync de catálogo (POST /coresa/sync) antes de publicarlo.`,
      );
    }

    const price = Math.round(toNumber(stored.Precio_Convertido));
    if (!(price > 0)) {
      throw new BadRequestException(
        `El SKU ${sku} está en coresa_products sin precio calculado. Suele ser una marca sin fórmula de precio asignada.`,
      );
    }

    return {
      price,
      availableQuantity: Math.floor(toNumber(stored.Disponible)),
    };
  }

  /**
   * Completa los obligatorios que faltan con una segunda consulta a OpenAI y
   * los agrega al borrador. Devuelve los ids deducidos, para que el panel los
   * muestre marcados: son los únicos valores que no salen de Coresa.
   */
  private async completeMissing(
    product: CoresaProduct,
    categoryAttributes: MeliCategoryAttribute[],
    draft: PublicationDraft,
    missingIds: string[],
  ): Promise<string[]> {
    if (missingIds.length === 0) return [];

    const missing = categoryAttributes.filter((attribute) =>
      missingIds.includes(attribute.id),
    );

    try {
      const completed = await this.enrichment.completeMissingAttributes(
        product,
        missing,
        draft.title,
      );
      if (completed.length === 0) return [];

      draft.attributes = [...draft.attributes, ...completed];
      this.logger.log(
        `[preview] SKU ${draft.sku}: atributos deducidos ${completed
          .map((attribute) => attribute.id)
          .join(', ')}`,
      );
      return completed.map((attribute) => attribute.id);
    } catch (err) {
      this.logger.warn(
        `[preview] SKU ${draft.sku}: no se pudieron completar ${missingIds.join(', ')}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
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
