import { APIMeliApiRepository } from './APIMeliApiRepository';

describe('APIMeliApiRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MERCADOLIBRE_API_URL: 'https://api.meli.example.com',
      MERCADOLIBRE_API_KEY: '_soled',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('no llama a meli-api si no hay listings', async () => {
    const request = jest.fn();
    const repo = new APIMeliApiRepository({ request } as never);

    await repo.updateListings([]);

    expect(request).not.toHaveBeenCalled();
  });

  it('posta listings con meli_item_id y producto Coresa', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, data: {} });
    const repo = new APIMeliApiRepository({ request } as never);

    await repo.updateListings([
      { meli_item_id: 'MLA1', product: { SKU: 'A' } },
    ]);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.meli.example.com/listings/update',
        data: {
          items: [{ meli_item_id: 'MLA1', product: { SKU: 'A' } }],
        },
      }),
    );
  });
});
