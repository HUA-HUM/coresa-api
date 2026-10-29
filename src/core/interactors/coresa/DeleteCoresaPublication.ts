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

export class DeletePublicationInput {
  publicationId: number;
  requestedBy?: string;
}

export class DeletedListing {
  mla: string;
  /** Si ML aceptó el borrado. */
  deleted: boolean;
  /** Si quedó fuera del actualizador. */
  unlinked: boolean;
  error?: string;
}

export class DeletePublicationResult {
  publicationId: number;
  sku: string;
  listings: DeletedListing[];
  /** Si el registro quedó marcado como descartado. */
  recordDiscarded: boolean;
  recordError?: string;
}

/**
 * Saca una publicación de MercadoLibre y de nuestros registros.
 *
 * Es definitivo: ML cierra el ítem y lo marca como eliminado, y un ítem
 * cerrado no se puede reactivar. Sirve para una publicación que salió mal
 * —en la tienda equivocada, con el precio equivocado— y hay que rehacerla.
 *
 * Los tres pasos van en este orden a propósito: primero ML, que es el que
 * puede fallar; después la fila del actualizador, para que no quede
 * manteniendo una publicación que ya no existe; y al final el registro, que
 * es lo que menos importa si algo se corta en el medio.
 */
@Injectable()
export class DeleteCoresaPublication {
  private readonly logger = new Logger(DeleteCoresaPublication.name);

  constructor(
    @Inject(ICoresaPublicationRepositoryToken)
    private readonly publications: ICoresaPublicationRepository,
    @Inject(IMeliPublishRepositoryToken)
    private readonly meliPublish: IMeliPublishRepository,
    @Inject(IInternalApiRepositoryToken)
    private readonly internalApi: IInternalApiRepository,
  ) {}

  async execute(
    input: DeletePublicationInput,
  ): Promise<DeletePublicationResult> {
    const publication = await this.publications.getById(input.publicationId);
    if (!publication) {
      throw new NotFoundException(
        `La publicación ${input.publicationId} no existe`,
      );
    }

    const mlas = [publication.classicItemId, publication.premiumItemId]
      .map((mla) => String(mla ?? '').trim())
      .filter((mla) => mla !== '');

    if (mlas.length === 0) {
      throw new BadRequestException(
        `La publicación ${input.publicationId} no llegó a crearse en ML. Si querés sacarla del listado, descartala.`,
      );
    }

    const listings: DeletedListing[] = [];
    for (const mla of mlas) {
      listings.push(await this.deleteOne(mla, publication.sku));
    }

    // El registro queda, con su historial: sirve para saber qué se publicó y
    // por qué se dio de baja. Lo que no queda es la publicación.
    //
    // Y si esto falla, no falla el borrado. El ítem ya no está en ML y la
    // fila ya no está en el actualizador: tirar un 500 acá haría creer que no
    // pasó nada y que hay que reintentar algo que ya se hizo.
    const record = await this.discardRecord(input);

    return {
      publicationId: input.publicationId,
      sku: publication.sku,
      listings,
      recordDiscarded: record.ok,
      ...(record.error === undefined ? {} : { recordError: record.error }),
    };
  }

  private async discardRecord(
    input: DeletePublicationInput,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.publications.update(input.publicationId, {
        status: 'discarded',
        errorCode: null,
        errorMessage: `Eliminada por ${input.requestedBy ?? 'el panel'}`,
      });
      return { ok: true };
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      // internal-api trata published como estado terminal, así que hoy esto
      // falla justo en el caso normal: eliminar algo que estaba publicado.
      this.logger.warn(
        `[delete] la publicación ${input.publicationId} se eliminó pero el registro quedó como estaba: ${detalle}`,
      );
      return { ok: false, error: detalle };
    }
  }

  private async deleteOne(mla: string, sku: string): Promise<DeletedListing> {
    const listing: DeletedListing = { mla, deleted: false, unlinked: false };

    try {
      await this.meliPublish.deleteItem(mla);
      listing.deleted = true;
      this.logger.log(`[delete] ${mla} (${sku}) eliminado de ML`);
    } catch (err) {
      listing.error = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[delete] ${mla} (${sku}) no se pudo eliminar de ML: ${listing.error}`,
      );
    }

    // La fila se saca aunque ML haya fallado: una publicación que se quiso
    // dar de baja no tiene que seguir recibiendo precio y stock.
    try {
      await this.internalApi.unlinkProductInMercadoLibre(mla);
      listing.unlinked = true;
    } catch (err) {
      const detalle = err instanceof Error ? err.message : String(err);
      listing.error = listing.error ? `${listing.error} | ${detalle}` : detalle;
      this.logger.warn(
        `[delete] ${mla} (${sku}) sigue vinculado al actualizador: ${detalle}`,
      );
    }

    return listing;
  }
}
