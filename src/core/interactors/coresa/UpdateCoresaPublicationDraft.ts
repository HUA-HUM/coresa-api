import {
  BadRequestException,
  ConflictException,
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
  IMeliPublishRepository,
  IMeliPublishRepositoryToken,
} from '../../adapters/repositories/IMeliPublishRepository';
import { CoresaPublicationStatus } from '../../entities/CoresaPublication';
import {
  PublicationDraft,
  PublicationValidation,
} from '../../entities/PublicationDraft';
import { missingRequiredAttributes } from '../../utils/enrichment';

/** Estados sobre los que todavía se puede editar el borrador. */
const EDITABLE: CoresaPublicationStatus[] = ['draft', 'ready', 'failed'];

export class UpdateDraftInput {
  publicationId: number;
  draft: Partial<PublicationDraft>;
  requestedBy?: string;
}

export class UpdateDraftResult {
  publicationId: number;
  sku: string;
  status: CoresaPublicationStatus;
  draft: PublicationDraft;
  validation: PublicationValidation;
  missingRequiredAttributes: string[];
}

/**
 * Guarda las correcciones del usuario y las vuelve a validar contra ML, sin
 * publicar y sin volver a llamar a OpenAI: rearmar el borrador con el preview
 * pisaría justo lo que el usuario acaba de escribir.
 */
@Injectable()
export class UpdateCoresaPublicationDraft {
  private readonly logger = new Logger(UpdateCoresaPublicationDraft.name);

  constructor(
    @Inject(ICoresaPublicationRepositoryToken)
    private readonly publications: ICoresaPublicationRepository,
    @Inject(IMeliPublishRepositoryToken)
    private readonly meliPublish: IMeliPublishRepository,
  ) {}

  async execute(input: UpdateDraftInput): Promise<UpdateDraftResult> {
    const changes = input.draft ?? {};
    if (Object.keys(changes).length === 0) {
      throw new BadRequestException('No hay nada para cambiar en draft');
    }

    const publication = await this.publications.getById(input.publicationId);
    if (!publication) {
      throw new NotFoundException(
        `La publicación ${input.publicationId} no existe`,
      );
    }
    if (!publication.draft) {
      throw new BadRequestException(
        `La publicación ${input.publicationId} no tiene borrador guardado`,
      );
    }
    if (!EDITABLE.includes(publication.status)) {
      throw new ConflictException(
        `La publicación ${input.publicationId} está en ${publication.status} y no se puede editar`,
      );
    }

    // attributes y pictures se reemplazan enteros: mezclar listas por id
    // escondería una baja hecha a propósito por el usuario.
    const draft: PublicationDraft = { ...publication.draft, ...changes };

    const validation = await this.meliPublish.validateItem(draft);
    const isValid = Object.values(validation?.results ?? {}).every(
      (result) => result?.valid,
    );
    const status: CoresaPublicationStatus = isValid ? 'ready' : 'draft';

    const missing = await this.missingFor(draft);

    // internal-api valida las transiciones de estado y rechaza ready -> ready.
    // Tiene razón: pedir el estado que la publicación ya tiene no es un
    // cambio. Se manda solo cuando de verdad cambió.
    await this.publications.update(input.publicationId, {
      ...(status === publication.status ? {} : { status }),
      draft,
      categoryId: draft.category_id,
      validation,
      errorCode: null,
      errorMessage: null,
    });

    this.logger.log(
      `[draft] publicación ${input.publicationId} (${draft.sku}) editada: ${Object.keys(
        changes,
      ).join(', ')} → ${status}`,
    );

    return {
      publicationId: input.publicationId,
      sku: draft.sku,
      status,
      draft,
      validation,
      missingRequiredAttributes: missing,
    };
  }

  /**
   * Los obligatorios se piden por la categoría del borrador ya editado: si el
   * usuario cambió de categoría, los que faltan son otros.
   */
  private async missingFor(draft: PublicationDraft): Promise<string[]> {
    try {
      const attributes = await this.meliPublish.getCategoryAttributes(
        draft.category_id,
      );
      return missingRequiredAttributes(draft.attributes ?? [], attributes);
    } catch (err) {
      this.logger.warn(
        `[draft] no se pudieron traer los atributos de ${draft.category_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }
  }
}
