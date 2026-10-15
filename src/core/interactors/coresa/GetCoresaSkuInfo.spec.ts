import { empaqueDe, GetCoresaSkuInfo } from './GetCoresaSkuInfo';

const coresa = {
  SKU: 'JDAC1345',
  Descripcion: 'DISCO ABRASIVO PARA CORTE DE METAL',
  Marca: 'Jadever',
  CantIntermedia: 100,
  CantMaster: 400,
  Venta_Unitaria: false,
};

const almacenado = {
  SKU: 'JDAC1345',
  Precio_Convertido: 84771,
  base_units: 100,
  Disponible: 28405,
};

function build(
  overrides: Record<string, unknown> = {},
  producto: Record<string, unknown> = coresa,
) {
  const coresaRepo = {
    getAllProducts: jest.fn(),
    getProductBySku: jest.fn().mockResolvedValue(producto),
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

  it('base_units sin cargar vale 1, no 0', async () => {
    const { interactor } = build({
      getCoresaProductBySku: jest
        .fn()
        .mockResolvedValue({ ...almacenado, base_units: 0 }),
    });

    const info = await interactor.execute('JDAC1345');

    // El empaque sigue saliendo de CantIntermedia; lo que cae a 1 es
    // base_units, que es con lo que se divide el precio.
    expect(info.empaque).toBe(100);
    expect(info.precioUnitario).toBe(84771);
  });
});

describe('empaqueDe', () => {
  it('usa la intermedia cuando Coresa la manda', () => {
    expect(empaqueDe(100, 400)).toEqual({
      empaque: 100,
      empaqueOrigen: 'intermedia',
    });
  });

  it('cae a la master cuando la intermedia viene en 0', () => {
    // CSL-EMERGENCIA: intermedia 0, master 10. Es casi la mitad del catálogo,
    // 2595 de 5544 productos, y para esos sugerir una unidad suelta es
    // sugerir algo que el proveedor no despacha.
    expect(empaqueDe(0, 10)).toEqual({ empaque: 10, empaqueOrigen: 'master' });
    expect(empaqueDe(1, 50)).toEqual({ empaque: 50, empaqueOrigen: 'master' });
  });

  it('sin ninguna de las dos, se vende por unidad', () => {
    expect(empaqueDe(0, 0)).toEqual({ empaque: 1, empaqueOrigen: 'unidad' });
    expect(empaqueDe(1, 1)).toEqual({ empaque: 1, empaqueOrigen: 'unidad' });
  });
});

describe('GetCoresaSkuInfo, empaque sin intermedia', () => {
  it('sugiere la caja master y deja ver los dos números', async () => {
    const { interactor } = build(
      {
        getCoresaProductBySku: jest.fn().mockResolvedValue({
          SKU: 'CSL-EMERGENCIA',
          Precio_Convertido: 39677,
          base_units: 1,
          Disponible: 1887,
        }),
      },
      { SKU: 'CSL-EMERGENCIA', CantIntermedia: 0, CantMaster: 10 },
    );

    const info = await interactor.execute('CSL-EMERGENCIA');

    expect(info.empaque).toBe(10);
    expect(info.empaqueOrigen).toBe('master');
    expect(info.cantidadIntermedia).toBe(0);
    expect(info.cantidadMaster).toBe(10);
    expect(info.unidadesSugeridas).toBe(10);
    expect(info.empaquesDisponibles).toBe(188);
  });

  it('el precio unitario sale de base_units, no del empaque', async () => {
    // Precio_Convertido corresponde a una unidad porque Coresa no manda
    // intermedia. Dividir por la master daría una décima parte del precio.
    const { interactor } = build(
      {
        getCoresaProductBySku: jest.fn().mockResolvedValue({
          SKU: 'CSL-EMERGENCIA',
          Precio_Convertido: 39677,
          base_units: 1,
          Disponible: 1887,
        }),
      },
      { SKU: 'CSL-EMERGENCIA', CantIntermedia: 0, CantMaster: 10 },
    );

    const info = await interactor.execute('CSL-EMERGENCIA');

    expect(info.precioUnitario).toBe(39677);
  });
});
