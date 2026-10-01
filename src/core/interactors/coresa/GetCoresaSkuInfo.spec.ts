import { GetCoresaSkuInfo } from './GetCoresaSkuInfo';

const coresa = {
  SKU: 'JDAC1345',
  Descripcion: 'DISCO ABRASIVO PARA CORTE DE METAL',
  Marca: 'Jadever',
  Venta_Unitaria: false,
};

const almacenado = {
  SKU: 'JDAC1345',
  Precio_Convertido: 84771,
  base_units: 100,
  Disponible: 28405,
};

function build(overrides: Record<string, unknown> = {}) {
  const coresaRepo = {
    getAllProducts: jest.fn(),
    getProductBySku: jest.fn().mockResolvedValue(coresa),
  };
  const internalApi = {
    getCoresaProductBySku: jest.fn().mockResolvedValue(almacenado),
    listVariantsBySku: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  return {
    interactor: new GetCoresaSkuInfo(coresaRepo, internalApi as never),
    coresaRepo,
    internalApi,
  };
}

describe('GetCoresaSkuInfo', () => {
  it('dice con cuántas unidades viene el empaque y cuánto sale la unidad', async () => {
    const { interactor } = build();

    const info = await interactor.execute('JDAC1345');

    expect(info.empaque).toBe(100);
    expect(info.precioEmpaque).toBe(84771);
    expect(info.precioUnitario).toBe(848);
    expect(info.disponible).toBe(28405);
    // 28405 unidades sueltas son 284 cajas de 100.
    expect(info.empaquesDisponibles).toBe(284);
  });

  it('sugiere publicar por empaque, que es como compra Coresa', async () => {
    const { interactor } = build();

    const info = await interactor.execute('JDAC1345');

    expect(info.unidadesSugeridas).toBe(100);
  });

  it('trae el flag de venta unitaria para que el panel avise', async () => {
    const { interactor } = build();

    expect((await interactor.execute('JDAC1345')).ventaUnitaria).toBe(false);
  });

  it('no llama a OpenAI ni a ML: tiene que responder en el acto', async () => {
    const { interactor, coresaRepo, internalApi } = build();

    await interactor.execute('JDAC1345');

    // Solo el catálogo de Coresa y internal-api.
    expect(coresaRepo.getProductBySku).toHaveBeenCalledTimes(1);
    expect(internalApi.getCoresaProductBySku).toHaveBeenCalledTimes(1);
  });

  it('sigue respondiendo si no se pueden leer las variantes', async () => {
    const { interactor } = build({
      listVariantsBySku: jest.fn().mockRejectedValue(new Error('caído')),
    });

    const info = await interactor.execute('JDAC1345');

    expect(info.variantesPublicadas).toEqual([]);
    expect(info.empaque).toBe(100);
  });

  it('avisa si el SKU todavía no pasó por el sync de catálogo', async () => {
    const { interactor } = build({
      getCoresaProductBySku: jest.fn().mockResolvedValue(null),
    });

    await expect(interactor.execute('JDAC1345')).rejects.toThrow(
      /sync de catálogo/,
    );
  });

  it('un empaque sin cargar vale 1, no 0', async () => {
    const { interactor } = build({
      getCoresaProductBySku: jest
        .fn()
        .mockResolvedValue({ ...almacenado, base_units: 0 }),
    });

    const info = await interactor.execute('JDAC1345');

    expect(info.empaque).toBe(1);
    expect(info.precioUnitario).toBe(84771);
  });
});
