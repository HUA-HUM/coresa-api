import {
  BadRequestException,
  ConflictException,
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
import {
  IProductImageRepository,
  IProductImageRepositoryToken,
} from '../../adapters/repositories/IProductImageRepository';
import {
  CoresaPublication,
  CoresaPublicationStatus,
} from '../../entities/CoresaPublication';
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  MeliCategoryAttribute,
  MeliCategorySuggestion,
} from '../../entities/MeliCategory';
import {
  PublicationDraft,
  PublicationValidation,
} from '../../entities/PublicationDraft';
import { CoresaProductInMercadoLibre } from '../../entities/CoresaMercadoLibre';
import {
  baseUnitsOf,
  describeVariant,
  isMeliListingType,
  MAX_PRICE_FACTOR,
  MELI_LISTING_TYPES,
  MIN_PRICE_FACTOR,
  normalizeModalidad,
  PublicationVariant,
  sameVariant,
  variantPrice,
  variantStock,
} from '../../entities/PublicationVariant';
import { toNumber } from '../../utils/coresaPriceStock';
import { FinancingCosts } from './FinancingCosts';
import { missingRequiredAttributes } from '../../utils/enrichment';
import {
  buildPictures,
  buildPublicationDraft,
} from '../../utils/publicationDraft';

export class PreviewCoresaPublicationInput {
  sku: string;
  requestedBy?: string;
  categoryId?: string;
  /** Con qué forma se publica. Sin nada: clásica, una unidad, contado. */
  listingType?: string;
  unitsPerListing?: number;
  modalidad?: string;
  priceFactor?: number;
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
  /** La frase con la que se le preguntó la categoría a ML. */
  categoryQuery: string;
  /** La variante con la que se armó el borrador. */
  variant: PublicationVariant;
  /** Las que ese SKU ya tiene publicadas, para que el panel las muestre. */
  publishedVariants: CoresaProductInMercadoLibre[];
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
    private readonly financingCosts: FinancingCosts,
    @Inject(IProductImageRepositoryToken)
    private readonly images: IProductImageRepository,
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

    const variant = await this.resolveVariant(input);

    const product = await this.coresaRepo.getProductBySku(sku);
    if (!product) {
      throw new NotFoundException(`SKU ${sku} no existe en el catálogo Coresa`);
    }

    // Antes de gastar una llamada a OpenAI: si esta misma variante ya está
    // publicada, publicarla de nuevo duplica la oferta en ML.
    const publishedVariants = await this.publishedVariantsOf(sku);
    this.rejectDuplicate(sku, variant, publishedVariants);

    const searchPhrase = input.categoryId
      ? ''
      : await this.searchPhraseFor(product, sku);
    const suggestions = input.categoryId
      ? []
      : await this.meliPublish.predictCategories(searchPhrase);
    const categoryId = input.categoryId ?? suggestions[0]?.category_id;
    if (!categoryId) {
      throw new BadRequestException(
        `No se pudo predecir la categoría de ML para "${searchPhrase}". Mandá categoryId a mano.`,
      );
    }

    const categoryAttributes =
      await this.meliPublish.getCategoryAttributes(categoryId);

    const [content, base, familyName, pictures] = await Promise.all([
      this.enrichment.buildContent(product, categoryAttributes, variant),
      this.baseFor(sku),
      this.familyNameFor(variant, publishedVariants),
      this.images.prepareForMercadoLibre(sku, buildPictures(product)),
    ]);

    const draft = buildPublicationDraft({
      product,
      categoryId,
      content,
      price: variantPrice(base.basePrice, base.baseUnits, variant),
      availableQuantity: variantStock(base.available, variant.unitsPerListing),
      allowedAttributeIds: new Set(
        categoryAttributes.map((attribute) => attribute.id),
      ),
      variant,
      familyName,
      pictures,
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
      `[preview] SKU ${sku} (${describeVariant(variant)}) categoría ${categoryId} ` +
        `precio ${draft.price} stock ${draft.available_quantity} válido=${isValid}`,
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
      categoryQuery: searchPhrase,
      variant,
      publishedVariants,
    };
  }

  /**
   * La frase con la que se le pregunta la categoría a ML. La descripción de
   * Coresa es mala para eso: a "SET 10 PIEZAS CUCHILLAS MULTIUSO, TAMAÑO
   * 61X19MM" el predictor contesta "Rulemanes de Ruedas", y ahí terminó una
   * publicación real. Con "cuchillas de repuesto para cutter 61x19mm"
   * contesta "Cutters y Trinchetas".
   *
   * Si la IA falla se usa la descripción, que es lo que se usaba antes: una
   * categoría mal elegida es mejor que no poder publicar, y el usuario la
   * puede corregir mandando categoryId.
   */
  private async searchPhraseFor(
    product: CoresaProduct,
    sku: string,
  ): Promise<string> {
    const fallback = String(product.Descripcion ?? sku).trim();

    try {
      const frase = (await this.enrichment.buildSearchPhrase(product)).trim();
      if (!frase) return fallback;
      this.logger.log(`[preview] SKU ${sku}: categoría por "${frase}"`);
      return frase;
    } catch (err) {
      this.logger.warn(
        `[preview] SKU ${sku}: no se pudo armar la frase de búsqueda, se usa la descripción: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return fallback;
    }
  }

  /**
   * ML agrupa las opciones de venta de un producto por family_name, y
   * meli-api manda el título como family_name. Así que una variante que
   * vende la misma cantidad de unidades tiene que salir con el MISMO título
   * que sus hermanas: si no, en vez de una publicación con varias opciones
   * de cuotas quedan publicaciones sueltas, y ML anula las que considera
   * duplicadas.
   *
   * Un pack de 6 sí es otro producto y lleva su propio título: por eso la
   * comparación es por unidades y no solo por SKU.
   */
  private async familyNameFor(
    variant: PublicationVariant,
    published: CoresaProductInMercadoLibre[],
  ): Promise<string | undefined> {
    const hermana = published.find(
      (row) => row.unitsPerListing === variant.unitsPerListing,
    );
    if (!hermana) return undefined;

    try {
      const snapshot = await this.internalApi.getMercadoLibreProductByMla(
        hermana.mla,
      );
      const titulo = snapshot?.title?.trim();
      if (titulo) {
        this.logger.log(
          `[preview] se reusa el título de ${hermana.mla} para agrupar las opciones de venta`,
        );
      }
      return titulo || undefined;
    } catch (err) {
      // Sin el título se publica igual, pero suelta. Se avisa porque es
      // justo lo que esta función viene a evitar.
      this.logger.warn(
        `[preview] no se pudo leer el título de ${hermana.mla}, la variante puede quedar como publicación aparte: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Los cuatro datos de la variante, con los defaults de una publicación
   * común. Se validan acá y no más adelante porque de estos números sale el
   * precio: un 100 donde va un 1 multiplica el precio por 100.
   */
  private async resolveVariant(
    input: PreviewCoresaPublicationInput,
  ): Promise<PublicationVariant> {
    const listingType = String(input.listingType ?? 'gold_special').trim();
    if (!isMeliListingType(listingType)) {
      throw new BadRequestException(
        `listingType tiene que ser uno de ${MELI_LISTING_TYPES.join(', ')}`,
      );
    }

    const unitsPerListing =
      input.unitsPerListing === undefined ? 1 : Number(input.unitsPerListing);
    if (!Number.isInteger(unitsPerListing) || unitsPerListing < 1) {
      throw new BadRequestException(
        'unitsPerListing tiene que ser un entero mayor o igual a 1',
      );
    }

    const modalidad = normalizeModalidad(input.modalidad);

    // El factor sale del costo que tiene cargado la modalidad, no de lo que
    // escriba el panel: así el costo de la financiación está en un solo lugar,
    // editable, y nadie tipea un 1,2755. Se acepta uno explícito solo para
    // modalidades que no están en la tabla.
    const derived = await this.financingCosts.factorFor(modalidad);
    if (input.priceFactor === undefined && derived === null) {
      const conocidas = (await this.financingCosts.listActive())
        .map((cost) => cost.modalidad)
        .join(', ');
      throw new BadRequestException(
        `No conozco el costo de la modalidad "${modalidad}". Usá una de ${conocidas} o mandá priceFactor.`,
      );
    }

    const priceFactor =
      input.priceFactor === undefined
        ? (derived as number)
        : Number(input.priceFactor);
    if (
      !Number.isFinite(priceFactor) ||
      priceFactor < MIN_PRICE_FACTOR ||
      priceFactor > MAX_PRICE_FACTOR
    ) {
      throw new BadRequestException(
        `priceFactor tiene que estar entre ${MIN_PRICE_FACTOR} y ${MAX_PRICE_FACTOR}`,
      );
    }

    return { listingType, unitsPerListing, modalidad, priceFactor };
  }

  /**
   * Si internal-api no contesta no se frena el preview: el borrador se puede
   * armar igual y el aviso de duplicado es una ayuda, no una condición.
   */
  private async publishedVariantsOf(
    sku: string,
  ): Promise<CoresaProductInMercadoLibre[]> {
    if (!this.registryEnabled) return [];

    try {
      return await this.internalApi.listVariantsBySku(sku);
    } catch (err) {
      this.logger.warn(
        `[preview] no se pudieron leer las variantes de ${sku}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }

  private rejectDuplicate(
    sku: string,
    variant: PublicationVariant,
    published: CoresaProductInMercadoLibre[],
  ): void {
    const existing = published.find(
      (row) =>
        row.listingType !== null &&
        row.unitsPerListing !== null &&
        sameVariant(
          {
            listingType: row.listingType,
            unitsPerListing: row.unitsPerListing,
            modalidad: row.modalidad ?? '',
          },
          variant,
        ),
    );
    if (!existing) return;

    throw new ConflictException(
      `El SKU ${sku} ya está publicado como ${describeVariant(variant)} en ${existing.mla}`,
    );
  }

  /**
   * El precio base sale de coresa_products, que es lo que el sync de catálogo
   * deja calculado y lo que después el actualizador mantiene. Si el SKU no
   * está ahí, no se publica: publicarlo con otro precio dejaría la publicación
   * desincronizada desde el primer día.
   *
   * base_units dice a cuántas unidades corresponde ese precio, porque Coresa
   * cotiza por su empaque. Es el dato con el que se saca el precio unitario.
   */
  private async baseFor(
    sku: string,
  ): Promise<{ basePrice: number; baseUnits: number; available: number }> {
    const stored = await this.internalApi.getCoresaProductBySku(sku);
    if (!stored) {
      throw new BadRequestException(
        `El SKU ${sku} no está en coresa_products. Corré el sync de catálogo (POST /coresa/sync) antes de publicarlo.`,
      );
    }

    const basePrice = Math.round(toNumber(stored.Precio_Convertido));
    if (!(basePrice > 0)) {
      throw new BadRequestException(
        `El SKU ${sku} está en coresa_products sin precio calculado. Suele ser una marca sin fórmula de precio asignada.`,
      );
    }

    return {
      basePrice,
      baseUnits: baseUnitsOf(stored),
      available: Math.floor(toNumber(stored.Disponible)),
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

    // Mismo motivo que en la edición del borrador: internal-api rechaza una
    // transición hacia el estado que la publicación ya tiene, y al reusar un
    // registro de un preview anterior es justo lo que pasaba.
    const status: CoresaPublicationStatus = params.isValid ? 'ready' : 'draft';

    return this.publications.update(created.id, {
      ...(status === created.status ? {} : { status }),
      validation: params.validation,
    });
  }
}
