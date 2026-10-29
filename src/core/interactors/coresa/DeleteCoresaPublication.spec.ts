import { DeleteCoresaPublication } from './DeleteCoresaPublication';

function buildDeps(
  publication: Record<string, unknown> | null = {
    id: 34,
    sku: 'JDMK1K61',
    status: 'published',
    classicItemId: 'MLA111',
    premiumItemId: null,
  },
) {
  const publications = {
    getById: jest.fn().mockResolvedValue(publication),
    update: jest.fn().mockResolvedValue({ id: 34 }),
    create: jest.fn(),
    getBySku: jest.fn(),
    getHistoryBySku: jest.fn(),
    list: jest.fn(),
  };
  const meliPublish = {
    deleteItem: jest.fn().mockResolvedValue(undefined),
    predictCategories: jest.fn(),
    getCategoryAttributes: jest.fn(),
    validateItem: jest.fn(),
    createItem: jest.fn(),
    updateDescription: jest.fn(),
  };
  const internalApi = {
    unlinkProductInMercadoLibre: jest.fn().mockResolvedValue(undefined),
  };
  return { publications, meliPublish, internalApi };
}

function build(deps: ReturnType<typeof buildDeps>) {
  return new DeleteCoresaPublication(
    deps.publications,
    deps.meliPublish,
    deps.internalApi as never,
  );
}

describe('DeleteCoresaPublication', () => {
  it('elimina de ML, desvincula del actualizador y descarta el registro', async () => {
    const deps = buildDeps();

    const result = await build(deps).execute({
      publicationId: 34,
      requestedBy: 'arturo@solediluminacion.com',
    });

    expect(deps.meliPublish.deleteItem).toHaveBeenCalledWith('MLA111');
    expect(deps.internalApi.unlinkProductInMercadoLibre).toHaveBeenCalledWith(
      'MLA111',
    );
    expect(deps.publications.update).toHaveBeenCalledWith(
      34,
      expect.objectContaining({ status: 'discarded' }),
    );
    expect(result.listings).toEqual([
      { mla: 'MLA111', deleted: true, unlinked: true },
    ]);
    expect(result.recordDiscarded).toBe(true);
  });

  it('elimina los dos tipos cuando la publicación creó clásica y premium', async () => {
    const deps = buildDeps({
      id: 34,
      sku: 'JDMK1K61',
      status: 'published',
      classicItemId: 'MLA111',
      premiumItemId: 'MLA222',
    });

    await build(deps).execute({ publicationId: 34 });

    expect(deps.meliPublish.deleteItem).toHaveBeenCalledWith('MLA111');
    expect(deps.meliPublish.deleteItem).toHaveBeenCalledWith('MLA222');
  });

  it('desvincula igual aunque ML falle', async () => {
    // Una publicación que se quiso dar de baja no puede seguir recibiendo
    // precio y stock, aunque el borrado en ML no haya salido.
    const deps = buildDeps();
    deps.meliPublish.deleteItem.mockRejectedValue(new Error('403 forbidden'));

    const result = await build(deps).execute({ publicationId: 34 });

    expect(deps.internalApi.unlinkProductInMercadoLibre).toHaveBeenCalledWith(
      'MLA111',
    );
    expect(result.listings[0]).toEqual({
      mla: 'MLA111',
      deleted: false,
      unlinked: true,
      error: '403 forbidden',
    });
  });

  it('avisa si la publicación quedó vinculada al actualizador', async () => {
    const deps = buildDeps();
    deps.internalApi.unlinkProductInMercadoLibre.mockRejectedValue(
      new Error('internal-api caído'),
    );

    const result = await build(deps).execute({ publicationId: 34 });

    expect(result.listings[0].deleted).toBe(true);
    expect(result.listings[0].unlinked).toBe(false);
    expect(result.listings[0].error).toMatch(/internal-api caído/);
  });

  it('no deja borrar algo que nunca llegó a ML', async () => {
    const deps = buildDeps({
      id: 34,
      sku: 'JDMK1K61',
      status: 'ready',
      classicItemId: null,
      premiumItemId: null,
    });

    await expect(build(deps).execute({ publicationId: 34 })).rejects.toThrow(
      /no llegó a crearse/,
    );
    expect(deps.meliPublish.deleteItem).not.toHaveBeenCalled();
  });

  it('falla con 404 si la publicación no existe', async () => {
    const deps = buildDeps(null);

    await expect(build(deps).execute({ publicationId: 99 })).rejects.toThrow(
      /no existe/,
    );
  });
});

describe('DeleteCoresaPublication, el registro no puede tirar abajo el borrado', () => {
  it('no falla si internal-api rechaza descartar el registro', async () => {
    // internal-api trata published como estado terminal, asi que esto falla
    // justo en el caso normal: eliminar algo que estaba publicado. El item ya
    // no esta en ML y la fila ya no esta en el actualizador; un 500 haria
    // creer que no paso nada y que hay que reintentar lo que ya se hizo.
    const deps = buildDeps();
    deps.publications.update.mockRejectedValue(
      new Error('Invalid status transition published -> discarded'),
    );

    const result = await build(deps).execute({ publicationId: 34 });

    expect(result.listings[0]).toEqual({
      mla: 'MLA111',
      deleted: true,
      unlinked: true,
    });
    expect(result.recordDiscarded).toBe(false);
    expect(result.recordError).toMatch(/published -> discarded/);
  });

  it('el borrado en ML y la desvinculacion pasan antes que el registro', async () => {
    const orden: string[] = [];
    const deps = buildDeps();
    deps.meliPublish.deleteItem.mockImplementation(() => {
      orden.push('ml');
      return Promise.resolve(undefined);
    });
    deps.internalApi.unlinkProductInMercadoLibre.mockImplementation(() => {
      orden.push('desvincular');
      return Promise.resolve(undefined);
    });
    deps.publications.update.mockImplementation(() => {
      orden.push('registro');
      return Promise.resolve({ id: 34 });
    });

    await build(deps).execute({ publicationId: 34 });

    expect(orden).toEqual(['ml', 'desvincular', 'registro']);
  });
});
