import { APIMeliApiRepository } from './APIMeliApiRepository';

describe('APIMeliApiRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MERCADOLIBRE_API_URL: 'https://api.meli.example.com',
      MERCADOLIBRE_API_KEY: '_soled',
      MELI_API_INTERNAL_KEY: '_internal',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('no llama a meli-api si el patch está vacío', async () => {
    const request = jest.fn();
    const repo = new APIMeliApiRepository({ request } as never);

    const result = await repo.updateListing('MLA1', {});

    expect(request).not.toHaveBeenCalled();
    expect(result.changed).toBe(false);
  });

  it('manda un PUT con la clave interna y solo los campos del patch', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ status: 200, data: { changed: true } });
    const repo = new APIMeliApiRepository({ request } as never);

    await repo.updateListing('MLA1', { price: 998250 });
    await repo.updateListing('MLA 2', { price: 5600, available_quantity: 900 });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'PUT',
        url: 'https://api.meli.example.com/meli/items/MLA1',
        data: { price: 998250 },
        headers: expect.objectContaining({ 'x-internal-api-key': '_internal' }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'PUT',
        url: 'https://api.meli.example.com/meli/items/MLA%202',
        data: { price: 5600, available_quantity: 900 },
      }),
    );
  });

  it('cae a INTERNAL_API_KEY si no está la específica de meli-api', async () => {
    process.env.MELI_API_INTERNAL_KEY = undefined;
    process.env.INTERNAL_API_KEY = '_fallback';
    const request = jest
      .fn()
      .mockResolvedValue({ status: 200, data: { changed: true } });
    const repo = new APIMeliApiRepository({ request } as never);

    await repo.updateListing('MLA1', { price: 1 });

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'x-internal-api-key': '_fallback' }),
      }),
    );
  });

  it('devuelve changed y applied tal como los manda meli-api', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        meli_item_id: 'MLA1',
        status: 'active',
        sub_status: [],
        requested: { price: 5600 },
        applied: { price: 5600 },
        changed: true,
      },
    });
    const repo = new APIMeliApiRepository({ request } as never);

    const result = await repo.updateListing('MLA1', { price: 5600 });

    expect(result).toEqual({
      meli_item_id: 'MLA1',
      status: 'active',
      sub_status: [],
      requested: { price: 5600 },
      applied: { price: 5600 },
      changed: true,
    });
  });

  it('marca changed en false cuando ML dejó otro valor', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        meli_item_id: 'MLA1',
        applied: { price: 100 },
        changed: false,
      },
    });
    const repo = new APIMeliApiRepository({ request } as never);

    const result = await repo.updateListing('MLA1', { price: 5600 });

    expect(result.changed).toBe(false);
    expect(result.applied).toEqual({ price: 100 });
  });

  it('deja el campo fuera de applied cuando ML no lo devolvió', async () => {
    const request = jest.fn().mockResolvedValue({
      status: 200,
      data: {
        meli_item_id: 'MLA1',
        applied: { price: 5600, available_quantity: null },
        changed: false,
      },
    });
    const repo = new APIMeliApiRepository({ request } as never);

    const result = await repo.updateListing('MLA1', {
      price: 5600,
      available_quantity: 900,
    });

    expect(result.applied).toEqual({ price: 5600 });
    expect(result.changed).toBe(false);
  });

  it('asume que impactó si meli-api todavía no devuelve changed', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ status: 200, data: { status: 'active' } });
    const repo = new APIMeliApiRepository({ request } as never);

    const result = await repo.updateListing('MLA1', { price: 5600 });

    expect(result.changed).toBe(true);
    expect(result.requested).toEqual({ price: 5600 });
  });
});
