import { AxiosError, AxiosInstance } from 'axios';
import { APICoresaPublicationRepository } from './APICoresaPublicationRepository';
import { CreateCoresaPublicationInput } from '../../../entities/CoresaPublication';
import { PublicationDraft } from '../../../entities/PublicationDraft';

function buildAxios(request: jest.Mock): AxiosInstance {
  return { request } as unknown as AxiosInstance;
}

function httpError(status: number, data: unknown): AxiosError {
  const error = new AxiosError(`Request failed with status code ${status}`);
  error.response = { status, data } as AxiosError['response'];
  return error;
}

const draft = { sku: 'PC12NW', title: 'Panel' } as PublicationDraft;

const input: CreateCoresaPublicationInput = {
  sku: 'PC12NW',
  coresaSnapshot: { SKU: 'PC12NW' },
  draft,
};

describe('APICoresaPublicationRepository', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      INTERNAL_API_URL: 'https://internal.test',
      INTERNAL_API_KEY: 'k',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('crea la publicación cuando el SKU está libre', async () => {
    const request = jest
      .fn()
      .mockResolvedValue({ data: { id: 9, sku: 'PC12NW', status: 'draft' } });
    const repository = new APICoresaPublicationRepository(buildAxios(request));

    const publication = await repository.create(input);

    expect(publication.id).toBe(9);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('reutiliza la publicación en curso cuando internal-api responde 409', async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(
        httpError(409, { code: 'publication_in_progress', publicationId: 4 }),
      )
      .mockResolvedValueOnce({
        data: { id: 4, sku: 'PC12NW', status: 'draft' },
      });
    const repository = new APICoresaPublicationRepository(buildAxios(request));

    const publication = await repository.create(input);

    expect(publication.id).toBe(4);
    expect(request).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        method: 'PATCH',
        url: 'https://internal.test/internal/coresa/publications/4',
        data: {
          status: 'draft',
          draft,
          errorCode: null,
          errorMessage: null,
        },
      }),
    );
  });

  it('propaga un 409 que no sea de publicación en curso', async () => {
    const request = jest
      .fn()
      .mockRejectedValue(httpError(409, { code: 'otra_cosa' }));
    const repository = new APICoresaPublicationRepository(buildAxios(request));

    await expect(repository.create(input)).rejects.toThrow('409');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('devuelve null cuando el SKU no tiene publicaciones', async () => {
    const request = jest.fn().mockRejectedValue(httpError(404, {}));
    const repository = new APICoresaPublicationRepository(buildAxios(request));

    await expect(repository.getBySku('NO-EXISTE')).resolves.toBeNull();
  });

  it('escapa el SKU en la URL de by-sku', async () => {
    const request = jest.fn().mockResolvedValue({ data: { id: 1 } });
    const repository = new APICoresaPublicationRepository(buildAxios(request));

    await repository.getBySku('AEB 35 SC/1');

    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://internal.test/internal/coresa/publications/by-sku/AEB%2035%20SC%2F1',
      }),
    );
  });
});
