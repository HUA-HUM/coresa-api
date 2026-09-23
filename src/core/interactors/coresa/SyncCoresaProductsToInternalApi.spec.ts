import { SyncCoresaProductsToInternalApi } from './SyncCoresaProductsToInternalApi';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';
import { MeliListingProduct } from '../../entities/MeliListingProduct';

describe('SyncCoresaProductsToInternalApi', () => {
  it('hace upsert del array de MeliListingProduct', async () => {
    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(),
    };
    const products: MeliListingProduct[] = [
      {
        meli_item_id: 'MLA123',
        seller_id: '6863691',
        sku: 'B0XXXX',
        title: 'Producto ejemplo',
        price: 99825,
        available_quantity: 12,
        status: 'active',
        raw_payload: {},
      },
    ];

    const upserted = await new SyncCoresaProductsToInternalApi(internalApi).execute(
      products,
    );

    expect(upserted).toBe(1);
    expect(internalApi.upsertProducts).toHaveBeenCalledWith(products);
  });
});
