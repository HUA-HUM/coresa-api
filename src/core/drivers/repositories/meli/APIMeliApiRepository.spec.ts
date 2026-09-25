import { APIMeliApiRepository } from './APIMeliApiRepository';

describe('APIMeliApiRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      MERCADOLIBRE_API_URL: 'https://api.meli.example.com',
      MERCADOLIBRE_API_KEY: '_soled',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('no llama a meli-api si el patch está vacío', async () => {
    const request = jest.fn();
    const repo = new APIMeliApiRepository({ request } as never);

    await repo.updateListing('MLA1', {});

    expect(request).not.toHaveBeenCalled();
  });

  it('posta solo los campos presentes del patch', async () => {
    const request = jest.fn().mockResolvedValue({ status: 200, data: {} });
    const repo = new APIMeliApiRepository({ request } as never);

    await repo.updateListing('MLA1', { price: 998250 });
    await repo.updateListing('MLA 2', {
      price: 5600,
      available_quantity: 900,
    });

    expect(request).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.meli.example.com/meli/items/MLA1',
        data: { price: 998250 },
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'POST',
        url: 'https://api.meli.example.com/meli/items/MLA%202',
        data: { price: 5600, available_quantity: 900 },
      }),
    );
  });
});
