import { CoresaProduct } from '../../entities/CoresaProduct';
import { PreviewCoresaPublication } from './PreviewCoresaPublication';

const product: CoresaProduct = {
  SKU: 'PC12NW',
  Descripcion: 'PANEL PLAFON CUADRADO MACROLED 12W',
  Marca: 'Macroled',
  Disponible: 100,
  CantIntermedia: 0,
  Impuestos: 'IVA_21',
  Precio_Lista_1: 10,
  URL_Imagen: 'https://s3.coresagroup.com/img.jpg',
};

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
    id: 'MODEL',
    name: 'Modelo',
    value_type: 'string',
    required: true,
    allowed_values: [],
    allowed_units: [],
    hint: null,
  },
];

function buildDeps(overrides: Record<string, unknown> = {}) {
  const coresaRepo = {
    getAllProducts: jest.fn(),
    getProductBySku: jest.fn().mockResolvedValue(product),
  };
  const meliPublish = {
    predictCategories: jest
      .fn()
      .mockResolvedValue([
        { category_id: 'MLA1591', category_name: 'Paneles LED' },
      ]),
    getCategoryAttributes: jest.fn().mockResolvedValue(categoryAttributes),
    validateItem: jest.fn().mockResolvedValue({
      sku: 'PC12NW',
      results: { gold_special: { valid: true }, gold_pro: { valid: true } },
    }),
  };
  const enrichment = {
    buildContent: jest.fn().mockResolvedValue({
      title: 'Panel Plafón Cuadrado Macroled 12w Neutro',
      description: 'Descripción generada.',
      model: 'PC12NW',
      attributes: [],
    }),
    completeMissingAttributes: jest.fn().mockResolvedValue([]),
  };
  const publications = {
    create: jest
      .fn()
      .mockResolvedValue({ id: 7, sku: 'PC12NW', status: 'draft' }),
    update: jest
      .fn()
      .mockResolvedValue({ id: 7, sku: 'PC12NW', status: 'ready' }),
    getBySku: jest.fn(),
  };
  const internalApi = {
    upsertCoresaProducts: jest.fn(),
    listCoresaProductsInMercadoLibre: jest.fn(),
    getCoresaProductBySku: jest.fn().mockResolvedValue({
      SKU: 'PC12NW',
      Precio_Convertido: 9983,
      Disponible: 100,
    }),
    getMercadoLibreProductByMla: jest.fn(),
    upsertProductInMercadoLibre: jest.fn(),
    startProcessRun: jest.fn(),
    finishProcessRun: jest.fn(),
    recordSyncChanges: jest.fn(),
  };

  return {
    coresaRepo,
    meliPublish,
    enrichment,
    publications,
    internalApi,
    ...overrides,
  };
}

function buildInteractor(deps: ReturnType<typeof buildDeps>) {
  return new PreviewCoresaPublication(
    deps.coresaRepo as never,
    deps.meliPublish as never,
    deps.enrichment as never,
    deps.publications as never,
    deps.internalApi as never,
  );
}

describe('PreviewCoresaPublication', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, PUBLICATIONS_REGISTRY_ENABLED: 'true' };
  });

  afterEach(() => {
    process.env = originalEnv;
    jest.clearAllMocks();
  });

  it('arma el borrador, lo valida y lo registra como ready', async () => {
    const deps = buildDeps();
    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(deps.meliPublish.predictCategories).toHaveBeenCalledWith(
      'PANEL PLAFON CUADRADO MACROLED 12W',
    );
    expect(deps.meliPublish.getCategoryAttributes).toHaveBeenCalledWith(
      'MLA1591',
    );
    expect(result.publicationId).toBe(7);
    expect(result.status).toBe('ready');
    expect(result.draft.price).toBe(9983);
    expect(result.draft.attributes).toEqual([
      { id: 'BRAND', value_name: 'Macroled' },
      { id: 'MODEL', value_name: 'PC12NW' },
    ]);
    expect(deps.publications.update).toHaveBeenCalledWith(7, {
      status: 'ready',
      validation: expect.objectContaining({ sku: 'PC12NW' }),
    });
  });

  it('registra como draft cuando ML rechaza alguno de los dos tipos', async () => {
    const deps = buildDeps();
    deps.meliPublish.validateItem.mockResolvedValue({
      sku: 'PC12NW',
      results: {
        gold_special: { valid: true },
        gold_pro: { valid: false, error: { code: 'x' } },
      },
    });

    await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(deps.publications.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'draft' }),
    );
  });

  it('completa con la IA los obligatorios que faltan y revalida', async () => {
    const deps = buildDeps();
    deps.enrichment.buildContent.mockResolvedValue({
      title: 'Panel Plafón',
      description: 'Descripción.',
      model: '',
      attributes: [],
    });
    deps.enrichment.completeMissingAttributes.mockResolvedValue([
      { id: 'MODEL', value_name: 'PC12NW' },
    ]);

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    // Primero falta MODEL; después de completarlo, no falta nada.
    expect(deps.enrichment.completeMissingAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ SKU: 'PC12NW' }),
      [expect.objectContaining({ id: 'MODEL' })],
      'Panel Plafón',
    );
    expect(deps.meliPublish.validateItem).toHaveBeenCalledTimes(2);
    expect(result.inferredAttributes).toEqual(['MODEL']);
    expect(result.missingRequiredAttributes).toEqual([]);
    expect(result.draft.attributes).toEqual(
      expect.arrayContaining([{ id: 'MODEL', value_name: 'PC12NW' }]),
    );
  });

  it('no llama a la IA de nuevo si no falta ningún obligatorio', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(deps.enrichment.completeMissingAttributes).not.toHaveBeenCalled();
    expect(deps.meliPublish.validateItem).toHaveBeenCalledTimes(1);
    expect(result.inferredAttributes).toEqual([]);
  });

  it('sigue adelante si la IA no puede completar lo que falta', async () => {
    const deps = buildDeps();
    deps.enrichment.buildContent.mockResolvedValue({
      title: 'Panel Plafón',
      description: 'Descripción.',
      model: '',
      attributes: [],
    });
    deps.enrichment.completeMissingAttributes.mockRejectedValue(
      new Error('openai caído'),
    );

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(result.inferredAttributes).toEqual([]);
    expect(result.missingRequiredAttributes).toEqual(['MODEL']);
  });

  it('informa los atributos obligatorios que quedaron sin completar', async () => {
    const deps = buildDeps();
    deps.enrichment.buildContent.mockResolvedValue({
      title: 'Panel Plafón',
      description: 'Descripción.',
      model: '',
      attributes: [],
    });

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(result.missingRequiredAttributes).toEqual(['MODEL']);
  });

  it('usa la categoría que le mandan sin llamar al predictor', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      categoryId: 'MLA9999',
    });

    expect(deps.meliPublish.predictCategories).not.toHaveBeenCalled();
    expect(result.categoryId).toBe('MLA9999');
  });

  it('falla si el SKU no existe en Coresa', async () => {
    const deps = buildDeps();
    deps.coresaRepo.getProductBySku.mockResolvedValue(null);

    await expect(
      buildInteractor(deps).execute({ sku: 'NO-EXISTE' }),
    ).rejects.toThrow(/no existe en el catálogo Coresa/);
  });

  it('falla si ML no sugiere ninguna categoría', async () => {
    const deps = buildDeps();
    deps.meliPublish.predictCategories.mockResolvedValue([]);

    await expect(
      buildInteractor(deps).execute({ sku: 'PC12NW' }),
    ).rejects.toThrow(/No se pudo predecir la categoría/);
  });

  it('no registra nada si el registro está apagado', async () => {
    process.env.PUBLICATIONS_REGISTRY_ENABLED = 'false';
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(deps.publications.create).not.toHaveBeenCalled();
    expect(result.publicationId).toBeNull();
    expect(result.status).toBe('ready');
  });
});
