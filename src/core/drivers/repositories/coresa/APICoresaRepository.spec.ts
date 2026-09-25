import { AxiosError, AxiosInstance } from 'axios';
import { APICoresaRepository } from './APICoresaRepository';

function buildAxios(request: jest.Mock): AxiosInstance {
  return { request } as unknown as AxiosInstance;
}

function notFoundError(): AxiosError {
  const error = new AxiosError('Request failed with status code 404');
  error.response = { status: 404 } as AxiosError['response'];
  return error;
}

describe('APICoresaRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      CORESA_API_URL: 'https://coresa.test/prod',
      CORESA_API_KEY: 'k',
      CORESA_PAGE_SIZE: '2',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('devuelve null cuando Coresa responde 404 por un SKU inexistente', async () => {
    const request = jest.fn().mockRejectedValue(notFoundError());
    const repository = new APICoresaRepository(buildAxios(request));

    await expect(repository.getProductBySku('NO-EXISTE')).resolves.toBeNull();
  });

  it('propaga cualquier otro error', async () => {
    const request = jest.fn().mockRejectedValue(new Error('timeout'));
    const repository = new APICoresaRepository(buildAxios(request));

    await expect(repository.getProductBySku('X')).rejects.toThrow('timeout');
  });

  it('resuelve un producto por SKU', async () => {
    const request = jest.fn().mockResolvedValue({
      data: { meta: { total_items: 1 }, data: [{ SKU: 'PC12NW' }] },
    });
    const repository = new APICoresaRepository(buildAxios(request));

    const product = await repository.getProductBySku('PC12NW');

    expect(product).toEqual({ SKU: 'PC12NW' });
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { sku: 'PC12NW' },
        headers: { 'x-api-key': 'k' },
      }),
    );
  });

  it('pagina getAllProducts hasta que has_next es false', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce({
        data: { meta: { has_next: true }, data: [{ SKU: 'A' }, { SKU: 'B' }] },
      })
      .mockResolvedValueOnce({
        data: { meta: { has_next: false }, data: [{ SKU: 'C' }] },
      });
    const repository = new APICoresaRepository(buildAxios(request));

    const products = await repository.getAllProducts();

    expect(products.map((product) => product.SKU)).toEqual(['A', 'B', 'C']);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
