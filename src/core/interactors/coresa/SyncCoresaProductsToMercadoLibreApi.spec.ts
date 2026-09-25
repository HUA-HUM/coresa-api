import { SyncCoresaProductsToMercadoLibreApi } from './SyncCoresaProductsToMercadoLibreApi';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';
import { IMercadoLibreRepository } from '../../adapters/repositories/IMercadoLibreRepository';
import { CoresaProduct } from '../../entities/CoresaProduct';
import { CoresaProductInMercadoLibre } from '../../entities/CoresaMercadoLibre';

describe('SyncCoresaProductsToMercadoLibreApi', () => {
  const desired: CoresaProduct = {
    SKU: 'A',
    Precio_Convertido: 998250,
    Disponible: 250,
  };

  function repo(
    overrides: Partial<IInternalApiRepository> = {},
  ): IInternalApiRepository {
    return {
      upsertCoresaProducts: jest.fn(),
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue([]),
      getCoresaProductBySku: jest.fn().mockResolvedValue(desired),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 100,
        available_quantity: 1,
      }),
      ...overrides,
    };
  }

  it('manda solo el campo que difiere y está habilitado', async () => {
    const links: CoresaProductInMercadoLibre[] = [
      { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: true },
      { sku: 'B', mla: 'MLA2', updatePrice: false, updateStock: true },
    ];
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue(links),
      getCoresaProductBySku: jest.fn((sku: string) =>
        Promise.resolve(
          sku === 'B' ? { ...desired, SKU: 'B', Disponible: 9 } : desired,
        ),
      ),
      getMercadoLibreProductByMla: jest.fn((mla: string) =>
        Promise.resolve(
          mla === 'MLA2'
            ? { meli_item_id: 'MLA2', price: 1, available_quantity: 9 }
            : { meli_item_id: 'MLA1', price: 998250, available_quantity: 1 },
        ),
      ),
    });
    const updateListing = jest.fn().mockResolvedValue(undefined);
    const mercadoLibreRepo: IMercadoLibreRepository = { updateListing };

    const result = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      mercadoLibreRepo,
    ).execute();

    expect(updateListing).toHaveBeenCalledTimes(1);
    expect(updateListing).toHaveBeenCalledWith('MLA1', {
      available_quantity: 250,
    });
    expect(result).toEqual({ listings: 2, updated: 1, skipped: 1, failed: 0 });
  });

  it('no llama a MELI si precio y stock coinciden', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([
          { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: true },
        ]),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 998250,
        available_quantity: 250,
      }),
    });
    const updateListing = jest.fn();
    const mercadoLibreRepo: IMercadoLibreRepository = { updateListing };

    const result = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      mercadoLibreRepo,
    ).execute();

    expect(updateListing).not.toHaveBeenCalled();
    expect(result.updated).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('sigue con el resto si falta el producto o falla un MLA', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue([
        { sku: 'MISS', mla: 'MLA1', updatePrice: true, updateStock: true },
        { sku: 'A', mla: 'MLA2', updatePrice: true, updateStock: false },
        { sku: 'A', mla: 'MLA3', updatePrice: true, updateStock: false },
      ]),
      getCoresaProductBySku: jest.fn((sku: string) =>
        Promise.resolve(sku === 'MISS' ? null : desired),
      ),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA',
        price: 1,
        available_quantity: 1,
      }),
    });
    const updateListing = jest.fn((mla: string) => {
      if (mla === 'MLA3') return Promise.reject(new Error('timeout'));
      return Promise.resolve();
    });
    const mercadoLibreRepo: IMercadoLibreRepository = { updateListing };

    const result = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      mercadoLibreRepo,
    ).execute();

    expect(updateListing).toHaveBeenCalledWith('MLA2', {
      price: 998250,
    });
    expect(result).toEqual({ listings: 3, updated: 1, skipped: 1, failed: 1 });
  });
});
