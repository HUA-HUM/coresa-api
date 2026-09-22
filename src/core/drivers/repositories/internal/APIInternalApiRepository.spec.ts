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

  it('envía productos en chunks al endpoint bulk con ambos headers de API key', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, data: {} });
    const repo = new APIInternalApiRepository({ request } as never);

    const product = {
      meli_item_id: 'MLA123',
      seller_id: '6863691',
      sku: 'MFTBLP2',
      title: 'Producto ejemplo',
      price: 95000,
      available_quantity: 12,
      status: 'active',
      raw_payload: {},
    };

    await repo.upsertProducts([product]);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://internal.example.com/internal/mercadolibre/products/bulk',
        data: { products: [product] },
        headers: expect.objectContaining({
          'x-api-key': '_internal',
          'x-internal-api-key': '_internal',
        }),
      }),
    );
  });

  it('consulta by-sku y mapea meli_item_id / status', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: { sku: 'MFTBLP2', status: 'active', meli_item_id: 'MLA123' },
    });
    const repo = new APIInternalApiRepository({ request } as never);

    const product = await repo.getProductBySku('MFTBLP2');

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://internal.example.com/internal/mercadolibre/products/by-sku/MFTBLP2',
        params: {},
        headers: expect.objectContaining({
          'x-api-key': '_internal',
          'x-internal-api-key': '_internal',
        }),
      }),
    );
    expect(product).toEqual({
      sku: 'MFTBLP2',
      status: 'active',
      meli_item_id: 'MLA123',
    });
  });

  it('devuelve null en 404', async () => {
    const err = Object.assign(new Error('not found'), {
      isAxiosError: true,
      response: { status: 404 },
    });
    const request = jest.fn().mockRejectedValue(err);
    const repo = new APIInternalApiRepository({ request } as never);

    await expect(repo.getProductBySku('MISSING')).resolves.toBeNull();
  });

  it('no llama al /bulk si no hay productos', async () => {
    const request = jest.fn();
    const repo = new APIInternalApiRepository({ request } as never);

    await repo.upsertProducts([]);

    expect(request).not.toHaveBeenCalled();
  });
});
