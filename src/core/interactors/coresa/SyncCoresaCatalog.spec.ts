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

  function build(
    catalogo: CoresaProduct[] = products,
    overrides: Partial<IInternalApiRepository> = {},
  ) {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue(catalogo),
      getProductBySku: jest.fn(),
    };
    const upsertCoresaProducts = jest.fn().mockResolvedValue(undefined);
    const markCoresaProductsUnavailable = jest.fn().mockResolvedValue({
      updated: 0,
      refused: false,
      wouldUpdate: null,
      skus: [],
    });
    const internalApi: IInternalApiRepository = {
      upsertCoresaProducts,
      markCoresaProductsUnavailable,
      listCoresaProductsInMercadoLibre: jest.fn(),
      getCoresaProductBySku: jest.fn(),
      listVariantsBySku: jest.fn(),
      listFinancingCosts: jest.fn().mockResolvedValue([]),
      updateFinancingCost: jest.fn(),
      createFinancingCost: jest.fn(),
      unlinkProductInMercadoLibre: jest.fn(),
      getMercadoLibreProductByMla: jest.fn(),
      upsertProductInMercadoLibre: jest.fn(),
      startProcessRun: jest.fn().mockResolvedValue(null),
      finishProcessRun: jest.fn(),
      recordSyncChanges: jest.fn().mockResolvedValue(0),
      ...overrides,
    };

    return {
      interactor: new SyncCoresaCatalog(coresaRepo, internalApi, exchangeRate),
      upsertCoresaProducts,
      markCoresaProductsUnavailable:
        (overrides.markCoresaProductsUnavailable as jest.Mock) ??
        markCoresaProductsUnavailable,
    };
  }

  /** Un catálogo que pasa el piso de cordura del barrido. */
  function catalogoGrande(size = 1200): CoresaProduct[] {
    return Array.from({ length: size }, (_, i) => ({
      SKU: `SKU-${i}`,
      Marca: 'Jadever',
      Impuestos: 'IVA_21',
      Precio_Lista_1: 10,
      CantIntermedia: 1,
      Disponible: 5,
    }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getUsdBnaSell.mockResolvedValue(1000);
    delete process.env.CORESA_MIN_CATALOG_SIZE;
    delete process.env.CORESA_MAX_DISCONTINUED;
  });

  it('calcula precio de pack y stock total de todo el catálogo y hace upsert', async () => {
    const { interactor, upsertCoresaProducts } = build();

    const result = await interactor.execute();

    expect(getUsdBnaSell).toHaveBeenCalledTimes(1);
    expect(upsertCoresaProducts).toHaveBeenCalledWith(
      [
        {
          ...products[0],
          Precio_Convertido: 998250,
          // A cuántas unidades corresponde ese precio: el publicador y el
          // actualizador dividen por acá para sacar el precio unitario.
          base_units: 100,
          Disponible: 250,
        },
        {
          ...products[1],
          Precio_Convertido: Math.round(20 * 2 * 1000 * 0.5 * 1.105 * 1.5),
          base_units: 2,
          Disponible: 5,
        },
      ],
      // El id de corrida, que es lo que después deja barrer lo que no vino.
      expect.any(String),
    );
    expect(result.total).toBe(4);
    expect(result.upserted).toBe(2);
    expect(result.skipped).toBe(2);
  });

  it('el upsert y el barrido comparten el mismo id de corrida', async () => {
    const { interactor, upsertCoresaProducts, markCoresaProductsUnavailable } =
      build(catalogoGrande());

    await interactor.execute();

    const llamadas = upsertCoresaProducts.mock.calls as Array<
      [CoresaProduct[], string]
    >;
    const runIdDelUpsert = llamadas[0][1];
    expect(runIdDelUpsert).toHaveLength(36);
    expect(markCoresaProductsUnavailable).toHaveBeenCalledWith(
      runIdDelUpsert,
      expect.any(Number),
    );
  });

  it('informa cuántos SKUs dio de baja', async () => {
    const { interactor } = build(catalogoGrande(), {
      markCoresaProductsUnavailable: jest.fn().mockResolvedValue({
        updated: 3,
        refused: false,
        wouldUpdate: null,
        skus: ['X', 'Y', 'Z'],
      }),
    });

    const result = await interactor.execute();

    expect(result.discontinued).toBe(3);
    expect(result.discontinuedSkus).toEqual(['X', 'Y', 'Z']);
  });
});

describe('SyncCoresaCatalog, los frenos del barrido', () => {
  const getUsdBnaSell = jest.fn().mockResolvedValue(1000);
  const exchangeRate: IExchangeRateRepository = { getUsdBnaSell };

  function build(
    catalogo: CoresaProduct[],
    mark: jest.Mock = jest.fn().mockResolvedValue({
      updated: 0,
      refused: false,
      wouldUpdate: null,
      skus: [],
    }),
  ) {
    const coresaRepo: ICoresaRepository = {
      getAllProducts: jest.fn().mockResolvedValue(catalogo),
      getProductBySku: jest.fn(),
    };
    const upsertCoresaProducts = jest.fn().mockResolvedValue(undefined);
    const internalApi: IInternalApiRepository = {
      upsertCoresaProducts,
      markCoresaProductsUnavailable: mark,
      listCoresaProductsInMercadoLibre: jest.fn(),
      getCoresaProductBySku: jest.fn(),
      listVariantsBySku: jest.fn(),
      listFinancingCosts: jest.fn().mockResolvedValue([]),
      updateFinancingCost: jest.fn(),
      createFinancingCost: jest.fn(),
      unlinkProductInMercadoLibre: jest.fn(),
      getMercadoLibreProductByMla: jest.fn(),
      upsertProductInMercadoLibre: jest.fn(),
      startProcessRun: jest.fn().mockResolvedValue(null),
      finishProcessRun: jest.fn(),
      recordSyncChanges: jest.fn().mockResolvedValue(0),
    };
    return {
      interactor: new SyncCoresaCatalog(coresaRepo, internalApi, exchangeRate),
      upsertCoresaProducts,
      mark,
    };
  }

  function catalogo(size: number): CoresaProduct[] {
    return Array.from({ length: size }, (_, i) => ({
      SKU: `SKU-${i}`,
      Marca: 'Jadever',
      Impuestos: 'IVA_21',
      Precio_Lista_1: 10,
      CantIntermedia: 1,
      Disponible: 5,
    }));
  }

  beforeEach(() => {
    jest.clearAllMocks();
    getUsdBnaSell.mockResolvedValue(1000);
    delete process.env.CORESA_MIN_CATALOG_SIZE;
    delete process.env.CORESA_MAX_DISCONTINUED;
  });

  // Este es el freno que importa: una respuesta cortada de Coresa no puede
  // apagar la tienda.
  it('no barre si la corrida vino más corta que el piso', async () => {
    const { interactor, mark, upsertCoresaProducts } = build(catalogo(10));

    const result = await interactor.execute();

    expect(mark).not.toHaveBeenCalled();
    // Pero el precio de lo que sí llegó se guarda igual: eso no es peligroso.
    expect(upsertCoresaProducts).toHaveBeenCalled();
    expect(result.discontinued).toBeNull();
    expect(result.discontinuedReason).toMatch(/piso/);
  });

  it('el piso es configurable', async () => {
    process.env.CORESA_MIN_CATALOG_SIZE = '5';
    const { interactor, mark } = build(catalogo(10));

    await interactor.execute();

    expect(mark).toHaveBeenCalled();
  });

  it('le pasa el tope al servidor para que lo frene él', async () => {
    process.env.CORESA_MAX_DISCONTINUED = '7';
    const { interactor, mark } = build(catalogo(1200));

    await interactor.execute();

    expect(mark).toHaveBeenCalledWith(expect.any(String), 7);
  });

  it('si el servidor frenó el barrido, lo dice con el número', async () => {
    const { interactor } = build(
      catalogo(1200),
      jest.fn().mockResolvedValue({
        updated: 0,
        refused: true,
        wouldUpdate: 743,
        skus: [],
      }),
    );

    const result = await interactor.execute();

    expect(result.discontinued).toBeNull();
    expect(result.discontinuedReason).toMatch(/743/);
  });

  // Se despliega antes que internal-api a propósito: el barrido se activa solo
  // cuando el endpoint exista.
  it('sigue andando si internal-api todavía no tiene el endpoint', async () => {
    const { interactor, upsertCoresaProducts } = build(
      catalogo(1200),
      jest.fn().mockResolvedValue(null),
    );

    const result = await interactor.execute();

    expect(upsertCoresaProducts).toHaveBeenCalled();
    expect(result.upserted).toBe(1200);
    expect(result.discontinued).toBeNull();
    expect(result.discontinuedReason).toMatch(/mark-unavailable/);
  });

  it('un barrido que falla no pierde la corrida de catálogo', async () => {
    const { interactor } = build(
      catalogo(1200),
      jest.fn().mockRejectedValue(new Error('internal-api caído')),
    );

    const result = await interactor.execute();

    expect(result.upserted).toBe(1200);
    expect(result.discontinued).toBeNull();
    expect(result.discontinuedReason).toMatch(/caído/);
  });
});
