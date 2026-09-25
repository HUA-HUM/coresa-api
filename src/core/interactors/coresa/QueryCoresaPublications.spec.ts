import { CoresaPublication } from '../../entities/CoresaPublication';
import { PublicationDraft } from '../../entities/PublicationDraft';
import { MAX_LIMIT, QueryCoresaPublications } from './QueryCoresaPublications';

const draft = {
  sku: 'PC12NW',
  title: 'Panel Plafón Cuadrado Macroled 12w',
  category_id: 'MLA1591',
  price: 9983,
  available_quantity: 100,
} as PublicationDraft;

const publication: CoresaPublication = {
  id: 7,
  sku: 'PC12NW',
  status: 'published',
  requestedBy: 'arturo@solediluminacion.com',
  categoryId: 'MLA1591',
  coresaSnapshot: { SKU: 'PC12NW' },
  draft,
  classicItemId: 'MLA111',
  premiumItemId: 'MLA222',
  permalink: 'https://articulo.mercadolibre.com.ar/MLA-111',
  publishedAt: '2026-09-23T21:00:00.000Z',
  createdAt: '2026-09-23T20:00:00.000Z',
  updatedAt: '2026-09-23T21:00:00.000Z',
};

function buildDeps() {
  return {
    create: jest.fn(),
    update: jest.fn(),
    getById: jest.fn().mockResolvedValue(publication),
    getBySku: jest.fn().mockResolvedValue(publication),
    getHistoryBySku: jest.fn().mockResolvedValue([publication]),
    list: jest.fn().mockResolvedValue({
      items: [publication],
      pagination: { limit: 50, offset: 0, total: 1 },
    }),
  };
}

function buildInteractor(deps: ReturnType<typeof buildDeps>) {
  return new QueryCoresaPublications(deps as never);
}

describe('QueryCoresaPublications', () => {
  it('devuelve filas livianas, sin el snapshot ni el borrador completo', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).list({});

    expect(result.pagination).toEqual({ limit: 50, offset: 0, total: 1 });
    expect(result.items[0]).toEqual({
      id: 7,
      sku: 'PC12NW',
      status: 'published',
      title: 'Panel Plafón Cuadrado Macroled 12w',
      categoryId: 'MLA1591',
      price: 9983,
      availableQuantity: 100,
      classicItemId: 'MLA111',
      premiumItemId: 'MLA222',
      permalink: 'https://articulo.mercadolibre.com.ar/MLA-111',
      errorMessage: null,
      requestedBy: 'arturo@solediluminacion.com',
      publishedAt: '2026-09-23T21:00:00.000Z',
      createdAt: '2026-09-23T20:00:00.000Z',
      updatedAt: '2026-09-23T21:00:00.000Z',
    });
  });

  it('pasa los filtros tal cual y completa el paginado por defecto', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).list({ sku: 'PC12NW', status: 'published' });

    expect(deps.list).toHaveBeenCalledWith({
      sku: 'PC12NW',
      status: 'published',
      limit: 50,
      offset: 0,
    });
  });

  it('recorta un limit exagerado y un offset negativo', async () => {
    const deps = buildDeps();

    await buildInteractor(deps).list({ limit: 5000, offset: -10 });

    expect(deps.list).toHaveBeenCalledWith({ limit: MAX_LIMIT, offset: 0 });
  });

  it('devuelve la publicación completa por id', async () => {
    const deps = buildDeps();

    const result = await buildInteractor(deps).getById(7);

    expect(result.coresaSnapshot).toEqual({ SKU: 'PC12NW' });
    expect(result.draft).toEqual(draft);
  });

  it('falla con 404 si el id no existe', async () => {
    const deps = buildDeps();
    deps.getById.mockResolvedValue(null);

    await expect(buildInteractor(deps).getById(99)).rejects.toThrow(
      /no existe/,
    );
  });

  it('falla con 404 si el SKU no tiene publicaciones', async () => {
    const deps = buildDeps();
    deps.getBySku.mockResolvedValue(null);

    await expect(buildInteractor(deps).getBySku('NO-EXISTE')).rejects.toThrow(
      /no tiene publicaciones/,
    );
  });

  it('devuelve el historial en filas livianas', async () => {
    const deps = buildDeps();

    const history = await buildInteractor(deps).getHistoryBySku('PC12NW');

    expect(history).toHaveLength(1);
    expect(history[0].id).toBe(7);
    expect(history[0]).not.toHaveProperty('coresaSnapshot');
  });

  it('tolera una publicación sin borrador', async () => {
    const deps = buildDeps();
    deps.list.mockResolvedValue({
      items: [{ id: 8, sku: 'X', status: 'failed' }],
      pagination: { limit: 50, offset: 0, total: 1 },
    });

    const result = await buildInteractor(deps).list({});

    expect(result.items[0].title).toBeNull();
    expect(result.items[0].price).toBeNull();
  });
});
