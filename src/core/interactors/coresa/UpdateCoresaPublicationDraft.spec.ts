import { PublicationDraft } from '../../entities/PublicationDraft';
import { UpdateCoresaPublicationDraft } from './UpdateCoresaPublicationDraft';

const draft = {
  sku: 'AEB 35 SC/1',
  title: 'Ángulo de fijación lateral',
  category_id: 'MLA458662',
  price: 2496,
  available_quantity: 1050,
  condition: 'new',
  pictures: ['https://s3.coresagroup.com/img.jpg'],
  attributes: [{ id: 'BRAND', value_name: 'Weidmuller' }],
  shipping: { mode: 'me2', free_shipping: false },
  description: 'Texto plano.',
  listing_types: ['gold_special'],
} as PublicationDraft;

const categoryAttributes = [
  {
    id: 'BRAND',
    name: 'Marca',
    value_type: 'string',
    required: true,
    allowed_values: [],
    allowed_units: [],
    hint: null,
  },
  {
    id: 'MATERIAL',
    name: 'Material',
    value_type: 'string',
    required: true,
    allowed_values: [],
    allowed_units: [],
    hint: null,
  },
];

function buildDeps(status = 'draft') {
  const publications = {
    create: jest.fn(),
    update: jest.fn().mockResolvedValue({ id: 4 }),
    getById: jest
      .fn()
      .mockResolvedValue({ id: 4, sku: 'AEB 35 SC/1', status, draft }),
    getBySku: jest.fn(),
    getHistoryBySku: jest.fn(),
    list: jest.fn(),
  };
  const meliPublish = {
    predictCategories: jest.fn(),
    getCategoryAttributes: jest.fn().mockResolvedValue(categoryAttributes),
    validateItem: jest.fn().mockResolvedValue({
      sku: 'AEB 35 SC/1',
      results: { gold_special: { valid: true } },
    }),
    createItem: jest.fn(),
    updateDescription: jest.fn(),
  };
  return { publications, meliPublish };
}

function buildInteractor(deps: ReturnType<typeof buildDeps>) {
  return new UpdateCoresaPublicationDraft(
    deps.publications as never,
    deps.meliPublish as never,
  );
}

describe('UpdateCoresaPublicationDraft', () => {
  it('mezcla los cambios con el borrador guardado y revalida', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({
      publicationId: 4,
      draft: { price: 2900 },
    });

    expect(deps.meliPublish.validateItem).toHaveBeenCalledWith({
      ...draft,
      price: 2900,
    });
    expect(result.status).toBe('ready');
    expect(result.draft.title).toBe(draft.title);
    expect(result.draft.price).toBe(2900);
  });

  it('nunca llama a OpenAI: no hay enriquecimiento en este camino', async () => {
    const deps = buildDeps();
    const interactor = buildInteractor(deps);

    await interactor.execute({ publicationId: 4, draft: { price: 1 } });

    // El interactor solo recibe dos dependencias; si alguna vez se agrega el
    // enriquecimiento, este test obliga a revisar por qué.
    expect(Object.keys(deps)).toEqual(['publications', 'meliPublish']);
  });

  it('guarda el borrador editado y el estado que dijo ML', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).execute({
      publicationId: 4,
      draft: { title: 'Otro título' },
    });

    expect(deps.publications.update).toHaveBeenCalledWith(4, {
      status: 'ready',
      draft: { ...draft, title: 'Otro título' },
      categoryId: 'MLA458662',
      validation: expect.objectContaining({ sku: 'AEB 35 SC/1' }),
      errorCode: null,
      errorMessage: null,
    });
  });

  it('queda en draft si ML sigue rechazando, con lo que falta', async () => {
    const deps = buildDeps();
    deps.meliPublish.validateItem.mockResolvedValue({
      sku: 'AEB 35 SC/1',
      results: {
        gold_special: {
          valid: false,
          error: { cause: [{ message: 'falta MATERIAL' }] },
        },
      },
    });

    const result = await buildInteractor(deps).execute({
      publicationId: 4,
      draft: { price: 2900 },
    });

    expect(result.status).toBe('draft');
    expect(result.missingRequiredAttributes).toEqual(['MATERIAL']);
  });

  it('pide los atributos de la categoría nueva si el usuario la cambió', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).execute({
      publicationId: 4,
      draft: { category_id: 'MLA417265' },
    });

    expect(deps.meliPublish.getCategoryAttributes).toHaveBeenCalledWith(
      'MLA417265',
    );
  });

  it('reemplaza los atributos enteros, no los mezcla', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({
      publicationId: 4,
      draft: { attributes: [{ id: 'MATERIAL', value_name: 'Sintético' }] },
    });

    expect(result.draft.attributes).toEqual([
      { id: 'MATERIAL', value_name: 'Sintético' },
    ]);
  });

  it('rechaza un body sin cambios', async () => {
    const deps = buildDeps();

    await expect(
      buildInteractor(deps).execute({ publicationId: 4, draft: {} }),
    ).rejects.toThrow(/nada para cambiar/);
  });

  it('no deja editar una publicación ya publicada', async () => {
    const deps = buildDeps('published');

    await expect(
      buildInteractor(deps).execute({ publicationId: 4, draft: { price: 1 } }),
    ).rejects.toThrow(/no se puede editar/);
    expect(deps.meliPublish.validateItem).not.toHaveBeenCalled();
  });

  it('falla con 404 si la publicación no existe', async () => {
    const deps = buildDeps();
    deps.publications.getById.mockResolvedValue(null);

    await expect(
      buildInteractor(deps).execute({ publicationId: 99, draft: { price: 1 } }),
    ).rejects.toThrow(/no existe/);
  });
});
