import { APIInternalApiRepository } from './APIInternalApiRepository';

describe('APIInternalApiRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INTERNAL_API_URL: 'https://internal.example.com',
      INTERNAL_API_KEY: '_internal',
      INTERNAL_API_CHUNK_SIZE: '500',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('envía productos Coresa en chunks al bulk con ambos headers de API key', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, data: {} });
    const repo = new APIInternalApiRepository({ request } as never);
    const product = {
      SKU: 'MFTBLP2',
      Precio_Lista_1: 998250,
      Disponible: 12,
      Moneda: 'ARS',
    };

    await repo.upsertCoresaProducts([product]);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://internal.example.com/internal/coresa/products/bulk',
        data: { products: [product] },
      }),
    );
    const config = (
      request.mock.calls as Array<[{ headers: Record<string, string> }]>
    )[0][0];
    expect(config.headers['x-api-key']).toBe('_internal');
    expect(config.headers['x-internal-api-key']).toBe('_internal');
  });

  it('no llama al bulk si no hay productos', async () => {
    const request = jest.fn();
    const repo = new APIInternalApiRepository({ request } as never);

    await repo.upsertCoresaProducts([]);

    expect(request).not.toHaveBeenCalled();
  });

  it('lista coresa_products_in_mercadolibre', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        products: [
          {
            SKU: 'A',
            MLA: 'MLA1',
            update_stock: false,
            update_price: 'true',
            created_at: '2026-01-01',
          },
          { sku: '', mla: 'MLA2' },
        ],
      },
    });
    const repo = new APIInternalApiRepository({ request } as never);

    const links = await repo.listCoresaProductsInMercadoLibre();

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://internal.example.com/internal/coresa/products-in-mercadolibre',
        params: { limit: 200, offset: 0 },
      }),
    );
    expect(links).toEqual([
      {
        sku: 'A',
        mla: 'MLA1',
        updateStock: false,
        updatePrice: true,
        createdAt: '2026-01-01',
      },
    ]);
  });

  it('recorre todas las páginas de products-in-mercadolibre', async () => {
    process.env.INTERNAL_API_PAGE_LIMIT = '1';
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          products: [
            { sku: 'A', mla: 'MLA1', updateStock: true, updatePrice: true },
          ],
          pagination: { limit: 1, offset: 0, total: 2 },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          products: [
            { sku: 'B', mla: 'MLA2', update_stock: false, update_price: false },
          ],
          pagination: { limit: 1, offset: 1, total: 2 },
        },
      });
    const repo = new APIInternalApiRepository({ request } as never);

    const links = await repo.listCoresaProductsInMercadoLibre();

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ params: { limit: 1, offset: 0 } }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ params: { limit: 1, offset: 1 } }),
    );
    expect(links.map((link) => link.sku)).toEqual(['A', 'B']);
  });

  it('consulta coresa by-sku y mercadolibre by-mla', async () => {
    const request = jest.fn((config: { url: string }) => {
      if (config.url.includes('/coresa/products/by-sku/')) {
        return {
          status: 200,
          data: { data: { SKU: 'MFTBLP2', Precio_Lista_1: 10, Disponible: 4 } },
        };
      }
      return {
        status: 200,
        data: { mla: 'MLA 1', price: '1.234,56', available_quantity: 8 },
      };
    });
    const repo = new APIInternalApiRepository({ request } as never);

    await expect(repo.getCoresaProductBySku('MFTBLP2')).resolves.toMatchObject({
      SKU: 'MFTBLP2',
      Precio_Lista_1: 10,
      Disponible: 4,
    });
    await expect(repo.getMercadoLibreProductByMla('MLA 1')).resolves.toEqual({
      meli_item_id: 'MLA 1',
      price: 1234.56,
      available_quantity: 8,
    });
  });

  it('devuelve null en 404', async () => {
    const err = Object.assign(new Error('not found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    const request = jest.fn().mockRejectedValue(err);
    const repo = new APIInternalApiRepository({ request } as never);

    await expect(repo.getCoresaProductBySku('MISSING')).resolves.toBeNull();
    await expect(repo.getMercadoLibreProductByMla('MLA0')).resolves.toBeNull();
  });
});
