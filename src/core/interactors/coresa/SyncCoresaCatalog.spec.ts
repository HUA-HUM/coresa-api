import { SyncCoresaCatalog } from './SyncCoresaCatalog';
import { CoresaProduct } from '../../entities/CoresaProduct';
import { ICoresaRepository } from '../../adapters/repositories/ICoresaRepository';
import { IExchangeRateRepository } from '../../adapters/repositories/IExchangeRateRepository';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';

describe('SyncCoresaCatalog', () => {
  const products: CoresaProduct[] = [
    {
      SKU: 'A',
      Marca: 'Jadever',
      Impuestos: 'IVA_21',
      Descripcion: 'Prod A',
      Precio_Lista_1: 10,
      CantIntermedia: 100,
      Disponible: 250,
    },
    {
      SKU: 'B',
      Marca: 'Weidmuller',
      Impuestos: 'IVA_10.5',
      Precio_Lista_1: 20,
      CantIntermedia: 2,
      Disponible: 5,
    },
    { SKU: 'C', Marca: 'Otra', Impuestos: 'IVA_21', Precio_Lista_1: 10 },
    { SKU: '', Marca: 'Jadever', Impuestos: 'IVA_21', Precio_Lista_1: 10 },
  ];

  const getUsdBnaSell = jest.fn().mockResolvedValue(1000);
  const exchangeRate: IExchangeRateRepository = { getUsdBnaSell };

  beforeEach(() => {
    jest.clearAllMocks();
    getUsdBnaSell.mockResolvedValue(1000);
  });

  it('calcula precio de pack y stock total de todo el catálogo y hace upsert', async () => {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue(products),
      getProductBySku: jest.fn(),
    };
    const upsertCoresaProducts = jest.fn().mockResolvedValue(undefined);
    const internalApi: IInternalApiRepository = {
      upsertCoresaProducts,
      listCoresaProductsInMercadoLibre: jest.fn(),
      getCoresaProductBySku: jest.fn(),
      getMercadoLibreProductByMla: jest.fn(),
    };

    const result = await new SyncCoresaCatalog(
      coresaRepo,
      internalApi,
      exchangeRate,
    ).execute();

    expect(getUsdBnaSell).toHaveBeenCalledTimes(1);
    expect(upsertCoresaProducts).toHaveBeenCalledWith([
      {
        ...products[0],
        Precio_Convertido: 998250,
        Disponible: 250,
      },
      {
        ...products[1],
        Precio_Convertido: Math.round(20 * 2 * 1000 * 0.5 * 1.105 * 1.5),
        Disponible: 5,
      },
    ]);
    expect(result).toEqual({ total: 4, upserted: 2, skipped: 2 });
  });
});
