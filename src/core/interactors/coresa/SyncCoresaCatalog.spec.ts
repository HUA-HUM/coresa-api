import { SyncCoresaCatalog } from './SyncCoresaCatalog';
import { SyncCoresaProductsToInternalApi } from './SyncCoresaProductsToInternalApi';
import { CoresaProduct } from '../../entities/CoresaProduct';
import { ICoresaRepository } from '../../adapters/repositories/ICoresaRepository';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';
import { IMercadoLibreRepository } from '../../adapters/repositories/IMercadoLibreRepository';
import { InternalMeliProduct } from '../../entities/InternalMeliProduct';

describe('SyncCoresaCatalog', () => {
  const products: CoresaProduct[] = [
    { SKU: 'A', Marca: 'Jadever' },
    { SKU: 'B', Marca: 'Timo' },
    { SKU: 'C', Marca: 'Timo' },
    { SKU: '', Marca: 'Unknown' },
  ];

  const mercadoLibreRepo: IMercadoLibreRepository = {
    updateListings: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hace upsert de todo el catálogo y clasifica solo status active para meli', async () => {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue(products),
      getProductBySku: jest.fn(),
    };

    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(async (sku: string) => {
        const map: Record<string, InternalMeliProduct> = {
          A: { sku: 'A', status: 'active', meli_item_id: 'MLA1' },
          B: { sku: 'B', status: 'paused', meli_item_id: 'MLA2' },
        };
        return map[sku] ?? null;
      }),
    };

    const syncInternal = new SyncCoresaProductsToInternalApi(internalApi);
    const useCase = new SyncCoresaCatalog(
      coresaRepo,
      internalApi,
      mercadoLibreRepo,
      syncInternal,
    );

    const result = await useCase.execute();

    expect(internalApi.upsertProducts).toHaveBeenCalledTimes(1);
    expect(internalApi.upsertProducts).toHaveBeenCalledWith(products);
    expect(internalApi.getProductBySku).toHaveBeenCalledWith('A');
    expect(internalApi.getProductBySku).toHaveBeenCalledWith('B');
    expect(internalApi.getProductBySku).toHaveBeenCalledWith('C');
    expect(internalApi.getProductBySku).not.toHaveBeenCalledWith('');
    expect(result.total).toBe(4);
    expect(result.activeForMeli).toBe(1);
    expect(result.meliItemIdsSample).toEqual(['MLA1']);
    expect(result.brands).toEqual([
      { brand: 'JADEVER', products: [products[0]] },
      { brand: 'TIMO', products: [products[1], products[2]] },
      { brand: 'UNKNOWN', products: [products[3]] },
    ]);
    expect(mercadoLibreRepo.updateListings).not.toHaveBeenCalled();
  });

  it('sigue el upsert si un lookup by-sku falla', async () => {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue([
        { SKU: 'ERR', Marca: 'X' },
        { SKU: 'OK', Marca: 'X' },
      ]),
      getProductBySku: jest.fn(),
    };

    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(async (sku: string) => {
        if (sku === 'ERR') throw new Error('timeout');
        return { sku: 'OK', status: 'ACTIVE', meli_item_id: 'MLA9' };
      }),
    };

    const useCase = new SyncCoresaCatalog(
      coresaRepo,
      internalApi,
      mercadoLibreRepo,
      new SyncCoresaProductsToInternalApi(internalApi),
    );

    const result = await useCase.execute();

    expect(result.activeForMeli).toBe(1);
    expect(result.meliItemIdsSample).toEqual(['MLA9']);
    expect(internalApi.upsertProducts).toHaveBeenCalled();
  });
});
