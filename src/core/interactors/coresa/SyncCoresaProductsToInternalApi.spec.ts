import { SyncCoresaProductsToInternalApi } from './SyncCoresaProductsToInternalApi';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';

describe('SyncCoresaProductsToInternalApi', () => {
  it('hace upsert de los productos en internal-api', async () => {
    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(),
    };
    const products = [{ SKU: 'A' }];

    await new SyncCoresaProductsToInternalApi(internalApi).execute(products);

    expect(internalApi.upsertProducts).toHaveBeenCalledWith(products);
  });
});
