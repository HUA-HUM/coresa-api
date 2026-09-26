import { SyncCoresaProductsToMercadoLibreApi } from './SyncCoresaProductsToMercadoLibreApi';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';
import { IMercadoLibreRepository } from '../../adapters/repositories/IMercadoLibreRepository';
import { CoresaProduct } from '../../entities/CoresaProduct';
import {
  CoresaProductInMercadoLibre,
  MeliListingUpdate,
  MeliListingUpdateResult,
} from '../../entities/CoresaMercadoLibre';

describe('SyncCoresaProductsToMercadoLibreApi', () => {
  const desired: CoresaProduct = {
    SKU: 'A',
    Precio_Convertido: 998250,
    Disponible: 250,
  };

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
      getMercadoLibreProductByMla: jest.fn().mockResolvedValue({
        meli_item_id: 'MLA1',
        price: 100,
        available_quantity: 1,
      }),
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
            : { meli_item_id: 'MLA1', price: 100, available_quantity: 1 },
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
        .mockResolvedValue([
          { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: false },
        ]),
    });
    const updateListing = jest.fn().mockResolvedValue({
      meli_item_id: 'MLA1',
      status: 'active',
      sub_status: [],
      requested: { price: 998250 },
      applied: { price: 100 },
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
      priceBefore: 100,
      priceRequested: 998250,
      priceApplied: 100,
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
        .mockResolvedValue([
          { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: true },
        ]),
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
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue([
        { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: false },
        { sku: 'A', mla: 'MLA2', updatePrice: true, updateStock: false },
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
      listCoresaProductsInMercadoLibre: jest.fn().mockResolvedValue([
        { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: true },
        { sku: 'B', mla: 'MLA2', updatePrice: true, updateStock: true },
      ]),
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
      startProcessRun: jest.fn().mockResolvedValue(null),
      listCoresaProductsInMercadoLibre: jest
        .fn()
        .mockResolvedValue([
          { sku: 'A', mla: 'MLA1', updatePrice: true, updateStock: true },
        ]),
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
});
