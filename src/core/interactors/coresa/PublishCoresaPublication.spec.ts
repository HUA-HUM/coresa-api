import { PublicationDraft } from '../../entities/PublicationDraft';
import { PublishCoresaPublication } from './PublishCoresaPublication';

const draft: PublicationDraft = {
  sku: 'PC12NW',
  title: 'Panel Plafón Cuadrado Macroled 12w',
  category_id: 'MLA1591',
  price: 9983,
  available_quantity: 100,
  condition: 'new',
  pictures: ['https://s3.coresagroup.com/img.jpg'],
  attributes: [{ id: 'BRAND', value_name: 'Macroled' }],
  shipping: { mode: 'me2', free_shipping: false },
  description: 'Descripción generada.',
};

function buildDeps() {
  const meliPublish = {
    predictCategories: jest.fn(),
    getCategoryAttributes: jest.fn(),
    validateItem: jest.fn(),
    createItem: jest.fn().mockResolvedValue({
      sku: 'PC12NW',
      results: {
        gold_special: {
          ok: true,
          meli_item_id: 'MLA111',
          permalink: 'https://articulo.mercadolibre.com.ar/MLA-111',
          description_saved: true,
        },
        gold_pro: { ok: true, meli_item_id: 'MLA222', description_saved: true },
      },
    }),
    updateDescription: jest.fn().mockResolvedValue(undefined),
  };
  const publications = {
    create: jest.fn(),
    update: jest
      .fn()
      .mockResolvedValue({ id: 7, sku: 'PC12NW', status: 'published' }),
    getById: jest.fn().mockResolvedValue({
      id: 7,
      sku: 'PC12NW',
      status: 'ready',
      draft,
    }),
    getBySku: jest.fn(),
  };
  return { meliPublish, publications };
}

function buildInteractor(deps: ReturnType<typeof buildDeps>) {
  return new PublishCoresaPublication(
    deps.meliPublish as never,
    deps.publications as never,
  );
}

describe('PublishCoresaPublication', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, PUBLICATIONS_REGISTRY_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('publica los dos tipos y guarda el resultado', async () => {
    const deps = buildDeps();
    const result = await buildInteractor(deps).execute({ publicationId: 7 });

    expect(deps.meliPublish.createItem).toHaveBeenCalledWith(draft);
    expect(result.status).toBe('published');
    expect(result.classicItemId).toBe('MLA111');
    expect(result.premiumItemId).toBe('MLA222');
    expect(deps.publications.update).toHaveBeenNthCalledWith(1, 7, {
      status: 'publishing',
      draft,
    });
    expect(deps.publications.update).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({
        status: 'published',
        classicItemId: 'MLA111',
        premiumItemId: 'MLA222',
        errorCode: null,
      }),
    );
  });

  it('aplica las correcciones del panel sobre el borrador guardado', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).execute({
      publicationId: 7,
      draft: { price: 12000, title: 'Otro título' },
    });

    expect(deps.meliPublish.createItem).toHaveBeenCalledWith({
      ...draft,
      price: 12000,
      title: 'Otro título',
    });
  });

  it('queda en partial si ML rechazó uno de los dos tipos', async () => {
    const deps = buildDeps();
    deps.meliPublish.createItem.mockResolvedValue({
      sku: 'PC12NW',
      results: {
        gold_special: { ok: true, meli_item_id: 'MLA111' },
        gold_pro: {
          ok: false,
          error: {
            message: 'validation_error',
            cause: [{ message: 'The attributes [MODEL] are required' }],
          },
        },
      },
    });

    const result = await buildInteractor(deps).execute({ publicationId: 7 });

    expect(result.status).toBe('partial');
    expect(result.premiumItemId).toBeNull();
    expect(deps.publications.update).toHaveBeenNthCalledWith(
      2,
      7,
      expect.objectContaining({
        status: 'partial',
        errorMessage: 'gold_pro: The attributes [MODEL] are required',
      }),
    );
  });

  it('toma el ID de un conflicto como publicación existente', async () => {
    const deps = buildDeps();
    deps.meliPublish.createItem.mockResolvedValue({
      sku: 'PC12NW',
      results: {
        gold_special: { ok: true, meli_item_id: 'MLA111' },
        gold_pro: { ok: false, conflict: true, meli_item_id: 'MLA999' },
      },
    });

    const result = await buildInteractor(deps).execute({ publicationId: 7 });

    expect(result.status).toBe('published');
    expect(result.premiumItemId).toBe('MLA999');
  });

  it('reintenta la descripción que no se guardó', async () => {
    const deps = buildDeps();
    deps.meliPublish.createItem.mockResolvedValue({
      sku: 'PC12NW',
      results: {
        gold_special: {
          ok: true,
          meli_item_id: 'MLA111',
          description_saved: false,
          description_error: { message: 'timeout' },
        },
        gold_pro: { ok: true, meli_item_id: 'MLA222', description_saved: true },
      },
    });

    const result = await buildInteractor(deps).execute({ publicationId: 7 });

    expect(deps.meliPublish.updateDescription).toHaveBeenCalledWith(
      'MLA111',
      'Descripción generada.',
    );
    expect(result.results.gold_special.description_saved).toBe(true);
  });

  it('registra el fallo si meli-api tira error', async () => {
    const deps = buildDeps();
    deps.meliPublish.createItem.mockRejectedValue(new Error('502 Bad Gateway'));

    await expect(
      buildInteractor(deps).execute({ publicationId: 7 }),
    ).rejects.toThrow('502 Bad Gateway');

    expect(deps.publications.update).toHaveBeenLastCalledWith(7, {
      status: 'failed',
      errorCode: 'MELI_PUBLISH_ERROR',
      errorMessage: '502 Bad Gateway',
    });
  });

  it('no republica una publicación ya publicada', async () => {
    const deps = buildDeps();
    deps.publications.getById.mockResolvedValue({
      id: 7,
      sku: 'PC12NW',
      status: 'published',
      draft,
    });

    await expect(
      buildInteractor(deps).execute({ publicationId: 7 }),
    ).rejects.toThrow(/ya está publicada/);
    expect(deps.meliPublish.createItem).not.toHaveBeenCalled();
  });

  it('falla si la publicación no existe', async () => {
    const deps = buildDeps();
    deps.publications.getById.mockResolvedValue(null);

    await expect(
      buildInteractor(deps).execute({ publicationId: 99 }),
    ).rejects.toThrow(/no existe/);
  });

  it('con el registro apagado exige el borrador completo', async () => {
    process.env.PUBLICATIONS_REGISTRY_ENABLED = 'false';
    const deps = buildDeps();

    await expect(
      buildInteractor(deps).execute({ publicationId: 7, draft: { price: 1 } }),
    ).rejects.toThrow(/borrador completo/);

    const result = await buildInteractor(deps).execute({
      publicationId: 7,
      draft,
    });

    expect(result.status).toBe('published');
    expect(deps.publications.update).not.toHaveBeenCalled();
  });
});
