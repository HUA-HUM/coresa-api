import { SyncCoresaProductsToMercadoLibreApi } from './SyncCoresaProductsToMercadoLibreApi';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';
import { IMercadoLibreRepository } from '../../adapters/repositories/IMercadoLibreRepository';
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  CoresaProductInMercadoLibre,
  MeliListingUpdate,
  MeliListingUpdateResult,
  MeliUpdateError,
} from '../../entities/CoresaMercadoLibre';

describe('SyncCoresaProductsToMercadoLibreApi', () => {
  const desired: CoresaProduct = {
    SKU: 'A',
    Precio_Convertido: 998250,
    Disponible: 250,
  };

  /** Una fila ya registrada por el publicador: unidad suelta, sin recargo. */
  function link(
    sku: string,
    mla: string,
    over: Partial<CoresaProductInMercadoLibre> = {},
  ): CoresaProductInMercadoLibre {
    return {
      sku,
      mla,
      updatePrice: true,
      updateStock: true,
      listingType: 'gold_special',
      unitsPerListing: 1,
      modalidad: 'contado',
      priceFactor: 1,
      origen: 'publicador',
      ...over,
    };
  }

  /** meli-api aplicando todo lo que se le pidió. */
  function applied(
    mla: string,
    patch: MeliListingUpdate,
  ): MeliListingUpdateResult {
    return {
      meli_item_id: mla,
      status: 'active',
      sub_status: [],
      requested: patch,
      applied: patch,
      changed: true,
    };
  }

  function repo(
    overrides: Partial<IInternalApiRepository> = {},
  ): IInternalApiRepository {
    return {
      upsertCoresaProducts: jest.fn(),
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue([]),
      getCoresaProductBySku: jest.fn().mockResolvedValue(desired),
      listVariantsBySku: jest.fn().mockResolvedValue([]),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 900000,
        available_quantity: 1,
      }),
      upsertProductInMercadoLibre: jest.fn(),
      startProcessRun: jest.fn().mockResolvedValue(812),
      finishProcessRun: jest.fn().mockResolvedValue(undefined),
      recordSyncChanges: jest
        .fn()
        .mockImplementation((_runId, _source, changes: unknown[]) =>
          Promise.resolve(changes.length),
        ),
      ...overrides,
    };
  }

  function meliRepo(
    updateListing: IMercadoLibreRepository['updateListing'],
  ): IMercadoLibreRepository {
    return { updateListing };
  }

  it('manda solo el campo que difiere y está habilitado', async () => {
    const links: CoresaProductInMercadoLibre[] = [
      link('A', 'MLA1'),
      link('B', 'MLA2', { updatePrice: false }),
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
            : { meli_item_id: 'MLA1', price: 900000, available_quantity: 1 },
        ),
      ),
    });
    const updateListing = jest.fn((mla: string, patch: MeliListingUpdate) =>
      Promise.resolve(applied(mla, patch)),
    );

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('manual');

    // MLA1: cambian precio y stock. MLA2: el stock ya coincide y el precio
    // está deshabilitado, así que no se toca.
    expect(updateListing).toHaveBeenCalledTimes(1);
    expect(updateListing).toHaveBeenCalledWith('MLA1', {
      price: 998250,
      available_quantity: 250,
    });
    expect(summary.updated).toBe(1);
    expect(summary.unchanged).toBe(1);
  });

  it('distingue not_applied cuando ML acepta pero no cambia el valor', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1', { updateStock: false })]),
    });
    const updateListing = jest.fn().mockResolvedValue({
      meli_item_id: 'MLA1',
      status: 'active',
      sub_status: [],
      requested: { price: 998250 },
      applied: { price: 900000 },
      changed: false,
    });

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(summary.updated).toBe(0);
    expect(summary.notApplied).toBe(1);
    expect(summary.items[0].change).toEqual({
      sku: 'A',
      mla: 'MLA1',
      result: 'not_applied',
      priceBefore: 900000,
      priceRequested: 998250,
      priceApplied: 900000,
      stockBefore: null,
      stockRequested: null,
      stockApplied: null,
      meliStatus: 'active',
      meliSubStatus: [],
    });
  });

  it('registra los cambios en internal-api con la corrida y el origen', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1')]),
    });
    const updateListing = jest.fn((mla: string, patch: MeliListingUpdate) =>
      Promise.resolve(applied(mla, patch)),
    );

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(internalApi.startProcessRun).toHaveBeenCalledWith(
      'coresa_meli_sync',
      'cron',
    );
    expect(internalApi.recordSyncChanges).toHaveBeenCalledWith(
      812,
      'cron',
      expect.arrayContaining([expect.objectContaining({ result: 'updated' })]),
    );
    expect(summary.runId).toBe(812);
    expect(summary.registered).toBe(1);
  });

  it('no registra las publicaciones que ya estaban iguales', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1')]),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 998250,
        available_quantity: 250,
      }),
    });
    const updateListing = jest.fn();

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(updateListing).not.toHaveBeenCalled();
    expect(summary.unchanged).toBe(1);
    expect(internalApi.recordSyncChanges).toHaveBeenCalledWith(812, 'cron', []);
  });

  it('registra el fallo cuando meli-api tira error y sigue con el resto', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([
          link('A', 'MLA1', { updateStock: false }),
          link('A', 'MLA2', { updateStock: false }),
        ]),
    });
    const updateListing = jest.fn((mla: string, patch: MeliListingUpdate) =>
      mla === 'MLA1'
        ? Promise.reject(new Error('401 Unauthorized'))
        : Promise.resolve(applied(mla, patch)),
    );

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(summary.failed).toBe(1);
    expect(summary.updated).toBe(1);
    const fallo = summary.items.find((item) => item.result === 'failed');
    expect(fallo?.change).toMatchObject({
      result: 'failed',
      errorCode: 'MELI_UPDATE_ERROR',
      errorMessage: '401 Unauthorized',
    });
  });

  it('omite las filas sin producto o sin publicación', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1'), link('B', 'MLA2')]),
      getCoresaProductBySku: jest.fn((sku: string) =>
        Promise.resolve(sku === 'A' ? desired : null),
      ),
      getMercadoLibreProductByMla: jest.fn(() => Promise.resolve(null)),
    });
    const updateListing = jest.fn();

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(updateListing).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(2);
    expect(summary.items.map((item) => item.reason)).toEqual([
      'el MLA no está en mercadolibre_products',
      'el SKU no está en coresa_products',
    ]);
  });

  it('cierra la corrida como fallida si explota el proceso', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockRejectedValue(new Error('internal-api caído')),
    });

    await expect(
      new SyncCoresaProductsToMercadoLibreApi(
        internalApi,
        meliRepo(jest.fn()),
      ).execute('cron'),
    ).rejects.toThrow('internal-api caído');

    expect(internalApi.finishProcessRun).toHaveBeenCalledWith(
      812,
      'failed',
      null,
      'internal-api caído',
    );
  });

  it('sigue funcionando si internal-api no pudo abrir la corrida', async () => {
    const internalApi = repo({
      upsertProductInMercadoLibre: jest.fn(),
      startProcessRun: jest.fn().mockResolvedValue(null),
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1')]),
    });
    const updateListing = jest.fn((mla: string, patch: MeliListingUpdate) =>
      Promise.resolve(applied(mla, patch)),
    );

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(summary.runId).toBeNull();
    expect(summary.updated).toBe(1);
    expect(internalApi.finishProcessRun).not.toHaveBeenCalled();
  });

  it('registra el motivo de ML y lo que se intentó mandar', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1')]),
    });
    const updateListing = jest
      .fn()
      .mockRejectedValue(
        new MeliUpdateError(
          'MLA1',
          422,
          'item.status.invalid',
          'Validation error',
          ['Item is not active'],
        ),
      );

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(summary.failed).toBe(1);
    expect(summary.items[0].change).toEqual({
      sku: 'A',
      mla: 'MLA1',
      result: 'failed',
      priceBefore: 900000,
      priceRequested: 998250,
      priceApplied: null,
      stockBefore: 1,
      stockRequested: 250,
      stockApplied: null,
      errorCode: 'item.status.invalid',
      errorMessage: 'Item is not active',
    });
  });
  it('compone el precio de la variante a partir del precio base del SKU', async () => {
    // Coresa cotiza la caja de 100 a 919209: la unidad sale 9192. La
    // publicación vende packs de 6 en 6 cuotas, que cuestan un 13,4%.
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([
          link('A', 'MLA1', { unitsPerListing: 6, modalidad: '6_cuotas' }),
        ]),
      getCoresaProductBySku: jest.fn().mockResolvedValue({
        SKU: 'A',
        Precio_Convertido: 919209,
        base_units: 100,
        Disponible: 250,
      }),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 60000,
        available_quantity: 0,
      }),
    });
    const updateListing = jest.fn((mla: string, patch: MeliListingUpdate) =>
      Promise.resolve(applied(mla, patch)),
    );

    await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    // (919209 / 100) x 6 / 0,866.
    expect(updateListing).toHaveBeenCalledWith('MLA1', {
      price: 63687,
      available_quantity: 41,
    });
  });

  it('no toca las filas sin variante cargada', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue([
        link('A', 'MLA1', {
          listingType: null,
          unitsPerListing: null,
          modalidad: null,
          origen: 'heredado',
        }),
      ]),
    });
    const updateListing = jest.fn();

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    // Sin saber si vende de a 1 o de a 100 no hay precio posible: se deja
    // quieta en vez de suponer.
    expect(updateListing).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.items[0].reason).toMatch(/units_per_listing/);
  });

  it('frena un precio que se va más de x2 y no lo manda', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1', { updateStock: false })]),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 9192,
        available_quantity: 250,
      }),
    });
    const updateListing = jest.fn();

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(updateListing).not.toHaveBeenCalled();
    expect(summary.skipped).toBe(1);
    expect(summary.items[0].reason).toMatch(/precio frenado/);
  });

  it('manda el stock aunque el precio haya quedado frenado', async () => {
    const internalApi = repo({
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([link('A', 'MLA1')]),
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 9192,
        available_quantity: 3,
      }),
    });
    const updateListing = jest.fn((mla: string, patch: MeliListingUpdate) =>
      Promise.resolve(applied(mla, patch)),
    );

    const summary = await new SyncCoresaProductsToMercadoLibreApi(
      internalApi,
      meliRepo(updateListing),
    ).execute('cron');

    expect(updateListing).toHaveBeenCalledWith('MLA1', {
      available_quantity: 250,
    });
    expect(summary.updated).toBe(1);
    expect(summary.items[0].reason).toMatch(/precio frenado/);
  });
});
