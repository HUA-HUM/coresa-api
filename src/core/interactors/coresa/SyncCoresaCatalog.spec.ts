import { SyncCoresaCatalog } from './SyncCoresaCatalog';
import { SyncCoresaProductsToInternalApi } from './SyncCoresaProductsToInternalApi';
import { CoresaProduct } from '../../entities/CoresaProduct';
import { ICoresaRepository } from '../../adapters/repositories/ICoresaRepository';
import { IExchangeRateRepository } from '../../adapters/repositories/IExchangeRateRepository';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';
import { IMercadoLibreRepository } from '../../adapters/repositories/IMercadoLibreRepository';
import { MeliBySkuLookup } from '../../entities/MeliListingProduct';

describe('SyncCoresaCatalog', () => {
  const products: CoresaProduct[] = [
    {
      SKU: 'A',
      Marca: 'Jadever',
      Descripcion: 'Prod A',
      Precio_Lista_1: 100,
      Disponible: 12,
    },
    { SKU: 'B', Marca: 'Timo', Precio_Lista_1: 50, Disponible: 5 },
    { SKU: 'C', Marca: 'Timo' },
    { SKU: '', Marca: 'Unknown' },
  ];

  const listingA = {
    meli_item_id: 'MLA1',
    seller_id: '6863691',
    sku: 'A',
    title: 'Prod A',
    price: 99825,
    available_quantity: 12,
    status: 'active',
    raw_payload: {},
  };

  const mercadoLibreRepo: IMercadoLibreRepository = {
    updateListings: jest.fn().mockResolvedValue(undefined),
  };

  const exchangeRate: IExchangeRateRepository = {
    getUsdBnaSell: jest.fn().mockResolvedValue(1000),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (exchangeRate.getUsdBnaSell as jest.Mock).mockResolvedValue(1000);
  });

  it('filtra Jadever, hace upsert y envía a meli-api solo publicaciones active con MLA', async () => {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue(products),
      getProductBySku: jest.fn(),
    };

    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(async (sku: string) => {
        const map: Record<string, MeliBySkuLookup> = {
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
      exchangeRate,
      syncInternal,
    );

    const result = await useCase.execute();

    expect(exchangeRate.getUsdBnaSell).toHaveBeenCalledTimes(1);
    expect(internalApi.getProductBySku).toHaveBeenCalledWith('A');
    expect(internalApi.getProductBySku).not.toHaveBeenCalledWith('B');
    expect(internalApi.getProductBySku).not.toHaveBeenCalledWith('C');
    expect(internalApi.getProductBySku).not.toHaveBeenCalledWith('');
    expect(internalApi.upsertProducts).toHaveBeenCalledTimes(1);
    expect(internalApi.upsertProducts).toHaveBeenCalledWith([listingA]);
    expect(mercadoLibreRepo.updateListings).toHaveBeenCalledWith([listingA]);
    expect(result.total).toBe(4);
    expect(result.activeForMeli).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.meliItemIdsSample).toEqual(['MLA1']);
    expect(result.brands).toEqual([
      { brand: 'JADEVER', products: [products[0]] },
      { brand: 'TIMO', products: [products[1], products[2]] },
      { brand: 'UNKNOWN', products: [products[3]] },
    ]);
  });

  it('sigue el upsert si un lookup by-sku falla y omite active sin MLA', async () => {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue([
        { SKU: 'ERR', Marca: 'Jadever', Precio_Lista_1: 10 },
        { SKU: 'NOMLA', Marca: 'Jadever', Precio_Lista_1: 10 },
        {
          SKU: 'OK',
          Marca: 'Jadever',
          Descripcion: 'Ok',
          Precio_Lista_1: 100,
          Disponible: 3,
        },
      ]),
      getProductBySku: jest.fn(),
    };

    const listingOk = {
      meli_item_id: 'MLA9',
      seller_id: '6863691',
      sku: 'OK',
      title: 'Ok',
      price: 99825,
      available_quantity: 3,
      status: 'active',
      raw_payload: {},
    };

    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(async (sku: string) => {
        if (sku === 'ERR') throw new Error('timeout');
        if (sku === 'NOMLA') {
          return { sku: 'NOMLA', status: 'active', meli_item_id: null };
        }
        return { sku: 'OK', status: 'ACTIVE', meli_item_id: 'MLA9' };
      }),
    };

    const useCase = new SyncCoresaCatalog(
      coresaRepo,
      internalApi,
      mercadoLibreRepo,
      exchangeRate,
      new SyncCoresaProductsToInternalApi(internalApi),
    );

    const result = await useCase.execute();

    expect(result.activeForMeli).toBe(1);
    expect(result.upserted).toBe(1);
    expect(result.meliItemIdsSample).toEqual(['MLA9']);
    expect(internalApi.upsertProducts).toHaveBeenCalledWith([listingOk]);
    expect(mercadoLibreRepo.updateListings).toHaveBeenCalledWith([listingOk]);
  });
});
