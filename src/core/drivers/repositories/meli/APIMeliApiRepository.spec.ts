import { APIMeliApiRepository } from './APIMeliApiRepository';
import { MeliListingProduct } from '../../../entities/MeliListingProduct';

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

  it('posta listings con meli_item_id y price', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, data: {} });
    const repo = new APIMeliApiRepository({ request } as never);
    const listing: MeliListingProduct = {
      meli_item_id: 'MLA1',
      seller_id: '6863691',
      sku: 'A',
      title: 'Prod A',
      price: 99825,
      available_quantity: 12,
      status: 'active',
      raw_payload: {},
    };

    await repo.updateListings([listing]);

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.meli.example.com/meli/products/:itemId/price',
        data: {
          items: [{ meli_item_id: 'MLA1', price: 99825 }],
        },
      }),
    );
  });
});
