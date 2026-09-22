import { SyncCoresaProductsToInternalApi } from './SyncCoresaProductsToInternalApi';
import { IInternalApiRepository } from '../../adapters/repositories/IInternalApiRepository';

describe('SyncCoresaProductsToInternalApi', () => {
  it('mapea listings activos y hace upsert del body /bulk', async () => {
    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(),
    };
    const listings = [
      {
        meli_item_id: 'MLA123',
        product: {
          SKU: 'B0XXXX',
          Descripcion: 'Producto ejemplo',
          Precio_Lista_1: 100,
          Disponible: 12,
        },
      },
    ];

    const upserted = await new SyncCoresaProductsToInternalApi(
      internalApi,
    ).execute(listings, 1000, '6863691');

    expect(upserted).toBe(1);
    expect(internalApi.upsertProducts).toHaveBeenCalledWith([
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
    ]);
  });

  it('omite listings sin MLA o sin precio válido', async () => {
    const internalApi: IInternalApiRepository = {
      upsertProducts: jest.fn().mockResolvedValue(undefined),
      getProductBySku: jest.fn(),
    };

    const upserted = await new SyncCoresaProductsToInternalApi(
      internalApi,
    ).execute(
      [
        { meli_item_id: '', product: { SKU: 'NO-MLA', Precio_Lista_1: 100 } },
        {
          meli_item_id: 'MLA9',
          product: { SKU: 'NO-PRICE', Precio_Lista_1: 0 },
        },
      ],
      1000,
      '6863691',
    );

    expect(upserted).toBe(0);
    expect(internalApi.upsertProducts).toHaveBeenCalledWith([]);
  });
});
