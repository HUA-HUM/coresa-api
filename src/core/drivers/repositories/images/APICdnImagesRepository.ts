import { Logger } from '@nestjs/common';
import { AxiosInstance } from 'axios';
import { IProductImageRepository } from '../../../adapters/repositories/IProductImageRepository';

const CHANNEL = 'mercadolibre';

/**
 * El CDN de imágenes para marketplaces: recibe las URL del proveedor, las
 * redimensiona al tamaño del canal y las sirve desde Spaces.
 *
 * Las fotos de Coresa vienen en 300x300 y ML pide 500x500 como mínimo: la
 * primera publicación real quedó en infracción por eso.
 */
export class APICdnImagesRepository implements IProductImageRepository {
  private readonly logger = new Logger(APICdnImagesRepository.name);

  constructor(private readonly axios: AxiosInstance) {}

  private get apiUrl(): string {
    return String(process.env.CMD_IMAGES_MARKET_API_BASE_URL ?? '').trim();
  }

  private get timeout(): number {
    return Number(process.env.CMD_IMAGES_TIMEOUT_MS ?? 60000);
  }

  async prepareForMercadoLibre(
    sku: string,
    imageUrls: string[],
  ): Promise<string[]> {
    const urls = (imageUrls ?? []).filter((url) => url?.trim());
    // Sin el CDN configurado se publica como hasta ahora: el cambio no
    // obliga a tener el servicio arriba para poder publicar.
    if (urls.length === 0 || !this.apiUrl) return urls;

    try {
      const response = await this.axios.request({
        method: 'POST',
        url: `${this.apiUrl.replace(/\/$/, '')}/images/process`,
        timeout: this.timeout,
        headers: { 'Content-Type': 'application/json' },
        data: { sku, channel: CHANNEL, imageUrls: urls },
      });

      const procesadas = this.publicUrlsOf(response.data);
      if (procesadas.length === 0) {
        this.logger.warn(
          `[cdn] ${sku}: el CDN no devolvió ninguna foto, se usan las del proveedor`,
        );
        return urls;
      }
      return procesadas;
    } catch (err) {
      // Caer a las originales y avisar: una foto chica puede quedar en
      // infracción, pero no publicar es peor.
      this.logger.warn(
        `[cdn] ${sku}: no se pudieron procesar las fotos, se usan las del proveedor: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return urls;
    }
  }

  private publicUrlsOf(payload: unknown): string[] {
    const images = (payload as { images?: { publicUrl?: string }[] })?.images;
    if (!Array.isArray(images)) return [];
    return images
      .map((image) => String(image?.publicUrl ?? '').trim())
      .filter((url) => url.startsWith('http'));
  }
}
