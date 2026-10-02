import { CoresaProduct } from '../../entities/CoresaProduct';
import { FinancingCosts } from './FinancingCosts';
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
    buildSearchPhrase: jest
      .fn()
      .mockResolvedValue('paneles led de plafón cuadrado 12w'),
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
    listVariantsBySku: jest.fn().mockResolvedValue([]),
    listFinancingCosts: jest.fn().mockResolvedValue([]),
    updateFinancingCost: jest.fn(),
    createFinancingCost: jest.fn(),
    getMercadoLibreProductByMla: jest.fn(),
    upsertProductInMercadoLibre: jest.fn(),
    startProcessRun: jest.fn(),
    finishProcessRun: jest.fn(),
    recordSyncChanges: jest.fn(),
  };

  const images = {
    // El CDN devuelve la foto redimensionada; sin él, la del proveedor.
    prepareForMercadoLibre: jest
      .fn()
      .mockImplementation((_sku: string, urls: string[]) =>
        Promise.resolve(urls),
      ),
  };

  return {
    coresaRepo,
    meliPublish,
    enrichment,
    images,
    publications,
    internalApi,
    ...overrides,
  };
}

function buildInteractor(deps: ReturnType<typeof buildDeps>) {
  // Sin tabla en internal-api, FinancingCosts cae a los valores compilados:
  // es el mismo camino que sigue producción si internal-api no contesta.
  return new PreviewCoresaPublication(
    deps.coresaRepo,
    deps.meliPublish as never,
    deps.enrichment,
    deps.publications as never,
    deps.internalApi,
    new FinancingCosts(deps.internalApi),
    deps.images,
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

    // La categoría se pregunta con la frase que arma la IA, no con la
    // descripción cruda de Coresa.
    expect(deps.meliPublish.predictCategories).toHaveBeenCalledWith(
      'paneles led de plafón cuadrado 12w',
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

    // La publicación ya estaba en draft, así que no se pide el estado de
    // nuevo: internal-api rechaza draft -> draft como transición inválida.
    const [, cambios] = deps.publications.update.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];
    expect(cambios).not.toHaveProperty('status');
    expect(cambios.validation).toEqual(
      expect.objectContaining({ sku: 'PC12NW' }),
    );
  });

  it('pide el estado nuevo solo cuando de verdad cambió', async () => {
    const deps = buildDeps();
    deps.publications.create.mockResolvedValue({
      id: 7,
      sku: 'PC12NW',
      status: 'draft',
    });

    await buildInteractor(deps).execute({ sku: 'PC12NW' });

    // ML lo validó, así que draft -> ready sí es un cambio real.
    expect(deps.publications.update).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ status: 'ready' }),
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
  it('cotiza la variante a partir del precio base y las unidades del empaque', async () => {
    const deps = buildDeps();
    // Coresa cotiza la caja de 100 a 919209: la unidad sale 9192.
    deps.internalApi.getCoresaProductBySku.mockResolvedValue({
      SKU: 'PC12NW',
      Precio_Convertido: 919209,
      base_units: 100,
      Disponible: 250,
    });

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      unitsPerListing: 6,
      listingType: 'gold_pro',
      modalidad: 'x12',
    });

    // (919209 / 100) x 6 / 0,784, que es el costo de las 12 cuotas.
    expect(result.draft.price).toBe(70348);
    // 250 unidades sueltas son 41 packs de 6.
    expect(result.draft.available_quantity).toBe(41);
    expect(result.draft.listing_types).toEqual(['gold_pro']);
    expect(result.variant).toEqual({
      listingType: 'gold_pro',
      unitsPerListing: 6,
      modalidad: '12_cuotas',
      priceFactor: 1 / 0.784,
    });
  });

  it('saca el recargo de la modalidad: el panel no manda el coeficiente', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      modalidad: 'cuota_promocionada',
    });

    // 9983 / 0,95. El costo de la financiación vive en un solo lugar, así
    // que nadie tipea un 1,0526 a mano.
    expect(result.draft.price).toBe(10508);
    expect(result.variant.priceFactor).toBeCloseTo(1 / 0.95, 6);
  });

  it('no cotiza una modalidad que no conoce', async () => {
    const deps = buildDeps();

    await expect(
      buildInteractor(deps).execute({ sku: 'PC12NW', modalidad: '24_cuotas' }),
    ).rejects.toThrow(/24_cuotas/);
  });

  it('sin variante publica una unidad suelta en clásica al contado', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(result.draft.price).toBe(9983);
    expect(result.draft.available_quantity).toBe(100);
    expect(result.variant).toEqual({
      listingType: 'gold_special',
      unitsPerListing: 1,
      modalidad: 'contado',
      priceFactor: 1,
    });
  });

  it('le dice a la IA cuántas unidades vende la publicación', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).execute({ sku: 'PC12NW', unitsPerListing: 6 });

    // El título se arma sabiendo que es un pack: a 60 caracteres no hay lugar
    // para pegarle un "Pack X 6" después.
    expect(deps.enrichment.buildContent).toHaveBeenCalledWith(
      product,
      categoryAttributes,
      expect.objectContaining({ unitsPerListing: 6 }),
    );
  });

  it('no deja publicar dos veces la misma variante', async () => {
    const deps = buildDeps();
    deps.internalApi.listVariantsBySku.mockResolvedValue([
      {
        sku: 'PC12NW',
        mla: 'MLA333',
        updatePrice: true,
        updateStock: true,
        listingType: 'gold_special',
        unitsPerListing: 1,
        modalidad: 'contado',
        priceFactor: 1,
        origen: 'publicador',
      },
    ]);

    await expect(
      buildInteractor(deps).execute({ sku: 'PC12NW' }),
    ).rejects.toThrow(/MLA333/);
    // Se corta antes de gastar la llamada a OpenAI.
    expect(deps.enrichment.buildContent).not.toHaveBeenCalled();
  });

  it('deja publicar otra variante del mismo SKU', async () => {
    const deps = buildDeps();
    deps.internalApi.listVariantsBySku.mockResolvedValue([
      {
        sku: 'PC12NW',
        mla: 'MLA333',
        updatePrice: true,
        updateStock: true,
        listingType: 'gold_special',
        unitsPerListing: 1,
        modalidad: 'contado',
        priceFactor: 1,
        origen: 'publicador',
      },
    ]);

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      unitsPerListing: 6,
    });

    expect(result.draft.price).toBe(59898);
    expect(result.publishedVariants).toHaveLength(1);
  });

  it('rechaza unidades y recargos imposibles antes de cotizar', async () => {
    const deps = buildDeps();

    await expect(
      buildInteractor(deps).execute({ sku: 'PC12NW', unitsPerListing: 0 }),
    ).rejects.toThrow(/unitsPerListing/);
    await expect(
      buildInteractor(deps).execute({ sku: 'PC12NW', priceFactor: 100 }),
    ).rejects.toThrow(/priceFactor/);
    await expect(
      buildInteractor(deps).execute({ sku: 'PC12NW', listingType: 'gold_x' }),
    ).rejects.toThrow(/listingType/);
    expect(deps.coresaRepo.getProductBySku).not.toHaveBeenCalled();
  });
});

describe('opciones de venta en una misma publicación', () => {
  it('nunca manda INSTALLMENTS_CAMPAIGN: ML no deja escribirlo', async () => {
    const deps = buildDeps();

    // "Not allowed to modify sale term INSTALLMENTS_CAMPAIGN": lo escribe ML
    // cuando la publicación entra en una campaña, y mandarlo rechaza la
    // publicación entera. Con cuotas no se podía publicar nada.
    const conCuotas = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      modalidad: '12_cuotas',
    });
    const contado = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    for (const result of [conCuotas, contado]) {
      expect(result.draft.sale_terms?.map((t) => t.id)).not.toContain(
        'INSTALLMENTS_CAMPAIGN',
      );
    }
  });

  it('la modalidad sigue definiendo el precio', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      modalidad: '12_cuotas',
    });

    expect(result.draft.price).toBe(12733);
    expect(result.variant.modalidad).toBe('12_cuotas');
  });

  it('reusa el título de la hermana para que ML las agrupe', async () => {
    const deps = buildDeps();
    deps.internalApi.listVariantsBySku.mockResolvedValue([
      {
        sku: 'PC12NW',
        mla: 'MLA333',
        updatePrice: true,
        updateStock: true,
        listingType: 'gold_special',
        unitsPerListing: 1,
        modalidad: 'contado',
        priceFactor: 1,
        origen: 'publicador',
      },
    ]);
    deps.internalApi.getMercadoLibreProductByMla.mockResolvedValue({
      meli_item_id: 'MLA333',
      price: 9983,
      available_quantity: 100,
      title: 'Panel Plafón Cuadrado Macroled 12w',
    });

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      modalidad: '12_cuotas',
    });

    // ML agrupa por family_name, y meli-api manda el título como family_name.
    expect(result.draft.title).toBe('Panel Plafón Cuadrado Macroled 12w');
  });

  it('un pack es otro producto, así que lleva su propio título', async () => {
    const deps = buildDeps();
    deps.internalApi.listVariantsBySku.mockResolvedValue([
      {
        sku: 'PC12NW',
        mla: 'MLA333',
        updatePrice: true,
        updateStock: true,
        listingType: 'gold_special',
        unitsPerListing: 1,
        modalidad: 'contado',
        priceFactor: 1,
        origen: 'publicador',
      },
    ]);

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      unitsPerListing: 6,
    });

    expect(deps.internalApi.getMercadoLibreProductByMla).not.toHaveBeenCalled();
    expect(result.draft.title).toBe(
      'Panel Plafón Cuadrado Macroled 12w Neutro',
    );
  });

  it('si no se puede leer el título de la hermana, publica igual', async () => {
    const deps = buildDeps();
    deps.internalApi.listVariantsBySku.mockResolvedValue([
      {
        sku: 'PC12NW',
        mla: 'MLA333',
        updatePrice: true,
        updateStock: true,
        listingType: 'gold_special',
        unitsPerListing: 1,
        modalidad: 'contado',
        priceFactor: 1,
        origen: 'publicador',
      },
    ]);
    deps.internalApi.getMercadoLibreProductByMla.mockRejectedValue(
      new Error('internal-api caído'),
    );

    const result = await buildInteractor(deps).execute({
      sku: 'PC12NW',
      modalidad: '3_cuotas',
    });

    expect(result.status).toBe('ready');
    expect(result.draft.title).toBe(
      'Panel Plafón Cuadrado Macroled 12w Neutro',
    );
  });
});

describe('la frase con la que se pregunta la categoría', () => {
  it('usa la frase de la IA y no la descripción de Coresa', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).execute({ sku: 'PC12NW' });

    // "SET 10 PIEZAS CUCHILLAS MULTIUSO, TAMAÑO 61X19MM" hizo que ML
    // contestara "Rulemanes de Ruedas" y ahí terminó una publicación real.
    expect(deps.enrichment.buildSearchPhrase).toHaveBeenCalledWith(product);
    expect(result.categoryQuery).toBe('paneles led de plafón cuadrado 12w');
  });

  it('si la IA falla, cae a la descripción en vez de no publicar', async () => {
    const deps = buildDeps();
    deps.enrichment.buildSearchPhrase.mockRejectedValue(
      new Error('openai caído'),
    );

    await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(deps.meliPublish.predictCategories).toHaveBeenCalledWith(
      'PANEL PLAFON CUADRADO MACROLED 12W',
    );
  });

  it('una frase vacía también cae a la descripción', async () => {
    const deps = buildDeps();
    deps.enrichment.buildSearchPhrase.mockResolvedValue('   ');

    await buildInteractor(deps).execute({ sku: 'PC12NW' });

    expect(deps.meliPublish.predictCategories).toHaveBeenCalledWith(
      'PANEL PLAFON CUADRADO MACROLED 12W',
    );
  });

  it('con categoryId a mano no se le pregunta nada a nadie', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).execute({
      sku: 'PC12NW',
      categoryId: 'MLA105407',
    });

    expect(deps.enrichment.buildSearchPhrase).not.toHaveBeenCalled();
    expect(deps.meliPublish.predictCategories).not.toHaveBeenCalled();
  });
});
