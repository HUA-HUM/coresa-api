import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
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
import { CoresaPublicationStatus } from '../../entities/CoresaPublication';
import {
  LISTING_TYPE_CLASSIC,
  LISTING_TYPE_PREMIUM,
  ListingCreation,
  PublicationCreation,
  PublicationDraft,
} from '../../entities/PublicationDraft';
import {
  DEFAULT_VARIANT,
  describeVariant,
  PublicationVariant,
} from '../../entities/PublicationVariant';

export class PublishCoresaPublicationInput {
  publicationId: number;
  draft?: Partial<PublicationDraft>;
  requestedBy?: string;
}

export class PublishCoresaPublicationResult {
  publicationId: number;
  sku: string;
  status: CoresaPublicationStatus;
  classicItemId: string | null;
  premiumItemId: string | null;
  permalink: string | null;
  /** Si quedó registrado en coresa_products_in_mercadolibre. */
  linkedForSync: boolean;
  results: Record<string, ListingCreation>;
}

@Injectable()
export class PublishCoresaPublication {
  private readonly logger = new Logger(PublishCoresaPublication.name);

  constructor(
    @Inject(IMeliPublishRepositoryToken)
    private readonly meliPublish: IMeliPublishRepository,
    @Inject(ICoresaPublicationRepositoryToken)
    private readonly publications: ICoresaPublicationRepository,
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  private get registryEnabled(): boolean {
    return (
      String(process.env.PUBLICATIONS_REGISTRY_ENABLED ?? 'true').trim() !==
      'false'
    );
  }

  async execute(
    input: PublishCoresaPublicationInput,
  ): Promise<PublishCoresaPublicationResult> {
    const draft = await this.resolveDraft(input);

    if (this.registryEnabled) {
      await this.publications.update(input.publicationId, {
        status: 'publishing',
        draft,
      });
    }

    let creation: PublicationCreation;
    try {
      creation = await this.meliPublish.createItem(draft);
    } catch (err) {
      await this.registerFailure(input.publicationId, err);
      throw err;
    }

    await this.retryMissingDescriptions(creation, draft.description);

    const variant = draft.variant ?? DEFAULT_VARIANT;
    const classic = creation.results?.[LISTING_TYPE_CLASSIC];
    const premium = creation.results?.[LISTING_TYPE_PREMIUM];
    const classicItemId = this.itemIdOf(classic);
    const premiumItemId = this.itemIdOf(premium);

    // El MLA de la variante que se pidió: es el único que se puede registrar
    // con estos datos de variante.
    const requestedItemId =
      variant.listingType === LISTING_TYPE_PREMIUM
        ? premiumItemId
        : classicItemId;
    const otherItemId =
      variant.listingType === LISTING_TYPE_PREMIUM
        ? classicItemId
        : premiumItemId;

    const status = this.resolveStatus(requestedItemId, otherItemId);
    const permalink = classic?.permalink ?? premium?.permalink ?? null;

    const other =
      variant.listingType === LISTING_TYPE_PREMIUM ? classic : premium;
    if (otherItemId && !other?.conflict) {
      this.logger.warn(
        `[publish] SKU ${draft.sku}: se pidió ${variant.listingType} y meli-api creó también ${otherItemId}, que queda sin registrar`,
      );
    }

    const linkedForSync = await this.linkForSync(
      draft.sku,
      requestedItemId,
      variant,
    );

    if (this.registryEnabled) {
      await this.publications.update(input.publicationId, {
        status,
        classicItemId,
        premiumItemId,
        permalink,
        response: creation,
        errorCode: status === 'published' ? null : 'MELI_PUBLISH_INCOMPLETE',
        errorMessage:
          status === 'published' ? null : this.firstErrorMessage(creation),
      });
    }

    this.logger.log(
      `[publish] SKU ${draft.sku} (${describeVariant(variant)}) ${status} ` +
        `clásica=${classicItemId ?? '-'} premium=${premiumItemId ?? '-'}`,
    );

    return {
      publicationId: input.publicationId,
      sku: draft.sku,
      status,
      classicItemId,
      premiumItemId,
      permalink,
      linkedForSync,
      results: creation.results ?? {},
    };
  }

  /** El borrador guardado, con las correcciones que mandó el panel encima. */
  private async resolveDraft(
    input: PublishCoresaPublicationInput,
  ): Promise<PublicationDraft> {
    if (!this.registryEnabled) {
      const draft = input.draft as PublicationDraft | undefined;
      if (!draft?.sku || !draft?.category_id) {
        throw new BadRequestException(
          'Con el registro apagado hay que mandar el borrador completo en draft',
        );
      }
      return draft;
    }

    const publication = await this.publications.getById(input.publicationId);
    if (!publication) {
      throw new NotFoundException(
        `La publicación ${input.publicationId} no existe`,
      );
    }
    if (publication.status === 'published') {
      throw new BadRequestException(
        `La publicación ${input.publicationId} ya está publicada`,
      );
    }
    if (!publication.draft) {
      throw new BadRequestException(
        `La publicación ${input.publicationId} no tiene borrador guardado`,
      );
    }

    return { ...publication.draft, ...(input.draft ?? {}) };
  }

  /**
   * El ítem se crea igual aunque falle la descripción, así que se reintenta
   * aparte en lugar de dar por fallida la publicación.
   */
  private async retryMissingDescriptions(
    creation: PublicationCreation,
    description: string,
  ): Promise<void> {
    for (const result of Object.values(creation.results ?? {})) {
      if (!result?.ok || result.description_saved !== false) continue;
      const itemId = String(result.meli_item_id ?? '').trim();
      if (!itemId || !description) continue;

      try {
        await this.meliPublish.updateDescription(itemId, description);
        result.description_saved = true;
        result.description_error = null;
      } catch (err) {
        this.logger.warn(
          `[publish] no se pudo guardar la descripción de ${itemId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Un conflicto también trae el ID: la publicación ya existía. */
  private itemIdOf(result?: ListingCreation): string | null {
    const itemId = String(result?.meli_item_id ?? '').trim();
    return itemId || null;
  }

  /**
   * Se publica un tipo por vez, el de la variante: si ese salió, la
   * publicación está completa. Si meli-api creó el otro tipo igual, queda
   * registrado en la publicación pero no define el estado.
   */
  private resolveStatus(
    requestedItemId: string | null,
    otherItemId: string | null,
  ): CoresaPublicationStatus {
    if (requestedItemId) return 'published';
    if (otherItemId) return 'partial';
    return 'failed';
  }

  /**
   * Deja el SKU vinculado a la publicación, con la variante que se acaba de
   * crear, para que el actualizador le componga precio y stock desde la
   * corrida siguiente. Es el único momento en que estos datos son ciertos sin
   * que nadie los adivine: por eso se guardan acá y con origen 'publicador'.
   *
   * Si internal-api falla, la publicación ya está hecha: se avisa y se sigue.
   * La fila queda sin registrar y el actualizador no la va a tocar, que es el
   * lado seguro del error.
   */
  private async linkForSync(
    sku: string,
    mla: string | null,
    variant: PublicationVariant,
  ): Promise<boolean> {
    if (!mla) return false;

    try {
      await this.internalApi.upsertProductInMercadoLibre(sku, mla, {
        updatePrice: true,
        updateStock: true,
        listingType: variant.listingType,
        unitsPerListing: variant.unitsPerListing,
        modalidad: variant.modalidad,
        priceFactor: variant.priceFactor,
        origen: 'publicador',
      });
      this.logger.log(
        `[publish] ${mla} (${sku}) registrado para el actualizador como ${describeVariant(variant)}`,
      );
      return true;
    } catch (err) {
      this.logger.warn(
        `[publish] ${mla} (${sku}) quedó publicado pero NO vinculado al actualizador: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }
  }

  private firstErrorMessage(creation: PublicationCreation): string | null {
    for (const [listingType, result] of Object.entries(
      creation.results ?? {},
    )) {
      if (result?.ok || result?.conflict) continue;
      const error = result?.error as
        { message?: string; cause?: { message?: string }[] } | undefined;
      const detail =
        error?.cause
          ?.map((cause) => cause?.message)
          .filter(Boolean)
          .join(' | ') || error?.message;
      if (detail) return `${listingType}: ${detail}`;
    }
    return null;
  }

  private async registerFailure(
    publicationId: number,
    err: unknown,
  ): Promise<void> {
    if (!this.registryEnabled) return;

    const message = err instanceof Error ? err.message : String(err);
    try {
      await this.publications.update(publicationId, {
        status: 'failed',
        errorCode: 'MELI_PUBLISH_ERROR',
        errorMessage: message,
      });
    } catch (updateError) {
      this.logger.warn(
        `[publish] no se pudo registrar el fallo de ${publicationId}: ${
          updateError instanceof Error
            ? updateError.message
            : String(updateError)
        }`,
      );
    }
  }
}
