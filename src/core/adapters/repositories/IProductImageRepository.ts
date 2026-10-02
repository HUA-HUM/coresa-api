export interface IProductImageRepository {
  /**
   * Deja las fotos en el tamaño que pide ML y devuelve las URL públicas del
   * CDN. Si no se puede, devuelve las originales: publicar con una foto chica
   * es peor que publicar, pero mejor que no publicar.
   */
  prepareForMercadoLibre(sku: string, imageUrls: string[]): Promise<string[]>;
}

export const IProductImageRepositoryToken = Symbol('IProductImageRepository');
