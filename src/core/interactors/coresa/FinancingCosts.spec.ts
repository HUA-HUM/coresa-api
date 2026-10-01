import {
  costToFactor,
  factorToCost,
  mapFinancingCosts,
} from '../../entities/FinancingCost';
import { FALLBACK_COSTS, FinancingCosts } from './FinancingCosts';

const tabla = [
  { modalidad: 'contado', etiqueta: 'Contado', costo: 0, activa: true },
  {
    modalidad: '12_cuotas',
    etiqueta: '12 cuotas',
    costo: 0.23,
    activa: true,
  },
  {
    modalidad: '6_cuotas',
    etiqueta: '6 cuotas',
    costo: 0.134,
    activa: false,
  },
];

function build(listFinancingCosts: jest.Mock, escrituras: object = {}) {
  return new FinancingCosts({ listFinancingCosts, ...escrituras } as never);
}

describe('FinancingCosts', () => {
  const env = process.env;
  beforeEach(() => {
    process.env = { ...env };
  });
  afterEach(() => {
    process.env = env;
  });

  it('cotiza con el costo cargado en internal-api, no con el compilado', async () => {
    // En el código el 12 cuotas está en 21,6%; la tabla dice 23%.
    const costs = build(jest.fn().mockResolvedValue(tabla));

    expect(await costs.factorFor('12_cuotas')).toBeCloseTo(1 / 0.77, 6);
  });

  it('acepta los nombres cortos del panel', async () => {
    const costs = build(jest.fn().mockResolvedValue(tabla));

    expect(await costs.factorFor('x12')).toBeCloseTo(1 / 0.77, 6);
  });

  it('no cotiza una modalidad desactivada', async () => {
    const costs = build(jest.fn().mockResolvedValue(tabla));

    expect(await costs.factorFor('6_cuotas')).toBeNull();
  });

  it('guarda la tabla en memoria en vez de pedirla en cada preview', async () => {
    const list = jest.fn().mockResolvedValue(tabla);
    const costs = build(list);

    await costs.list();
    await costs.list();
    await costs.factorFor('contado');

    expect(list).toHaveBeenCalledTimes(1);
  });

  it('vuelve a pedirla cuando vence el caché', async () => {
    process.env.FINANCING_COSTS_TTL_MS = '0';
    const list = jest.fn().mockResolvedValue(tabla);
    const costs = build(list);

    await costs.list();
    await costs.list();

    expect(list).toHaveBeenCalledTimes(2);
  });

  it('usa los valores compilados si internal-api no contesta', async () => {
    // Quedarse sin cotizar sería peor que cotizar con un costo de hace unos
    // días: el publicador tiene que poder seguir trabajando.
    const costs = build(jest.fn().mockRejectedValue(new Error('caído')));

    expect(await costs.list()).toEqual(FALLBACK_COSTS);
    expect(await costs.factorFor('12_cuotas')).toBeCloseTo(1 / 0.784, 6);
  });

  it('usa los compilados si la tabla vuelve vacía', async () => {
    const costs = build(jest.fn().mockResolvedValue([]));

    expect(await costs.list()).toEqual(FALLBACK_COSTS);
  });

  it('sirve la última tabla buena si internal-api se cae después', async () => {
    process.env.FINANCING_COSTS_TTL_MS = '0';
    const list = jest
      .fn()
      .mockResolvedValueOnce(tabla)
      .mockRejectedValue(new Error('caído'));
    const costs = build(list);

    await costs.list();

    expect(await costs.list()).toEqual(tabla);
  });

  it('lista solo las activas para el desplegable del panel', async () => {
    const costs = build(jest.fn().mockResolvedValue(tabla));

    expect((await costs.listActive()).map((c) => c.modalidad)).toEqual([
      'contado',
      '12_cuotas',
    ]);
  });
});

describe('mapFinancingCosts', () => {
  it('lee la respuesta de internal-api', () => {
    expect(
      mapFinancingCosts({
        items: [
          {
            modalidad: '12_cuotas',
            etiqueta: '12 cuotas',
            costo: 0.216,
            activa: true,
          },
        ],
      }),
    ).toEqual([
      {
        modalidad: '12_cuotas',
        etiqueta: '12 cuotas',
        costo: 0.216,
        activa: true,
        campaign: '12x_campaign',
      },
    ]);
  });

  it('descarta un costo fuera de rango en vez de cotizar con él', () => {
    // Un 5 escrito donde va 0.05 haría salir al doble todo lo que se publique
    // después. Se ignora la fila y la modalidad queda sin costo, que obliga a
    // mandar un priceFactor explícito.
    expect(
      mapFinancingCosts({
        items: [
          { modalidad: 'rota', costo: 5, activa: true },
          { modalidad: 'negativa', costo: -1, activa: true },
          { modalidad: 'contado', costo: 0, activa: true },
        ],
      }).map((c) => c.modalidad),
    ).toEqual(['contado']);
  });

  it('acepta el costo como texto, que es como lo manda MySQL', () => {
    expect(
      mapFinancingCosts([{ modalidad: '3_cuotas', costo: '0.0890' }]),
    ).toEqual([
      {
        modalidad: '3_cuotas',
        etiqueta: '3_cuotas',
        costo: 0.089,
        activa: true,
        campaign: '3x_campaign',
      },
    ]);
  });
});

describe('FinancingCosts, escritura', () => {
  it('tira el caché al editar: no puede seguir cotizando con el valor viejo', async () => {
    const list = jest
      .fn()
      .mockResolvedValueOnce([
        { modalidad: '12_cuotas', etiqueta: '12', costo: 0.216, activa: true },
      ])
      .mockResolvedValue([
        { modalidad: '12_cuotas', etiqueta: '12', costo: 0.23, activa: true },
      ]);
    const updateFinancingCost = jest.fn().mockResolvedValue(null);
    const costs = build(list, { updateFinancingCost });

    expect(await costs.factorFor('12_cuotas')).toBeCloseTo(1 / 0.784, 6);
    await costs.update('12_cuotas', { costo: 0.23 });

    expect(await costs.factorFor('12_cuotas')).toBeCloseTo(1 / 0.77, 6);
  });

  it('normaliza el nombre antes de editar', async () => {
    const updateFinancingCost = jest.fn().mockResolvedValue(null);
    const costs = build(jest.fn().mockResolvedValue([]), {
      updateFinancingCost,
    });

    await costs.update('X12', { costo: 0.2 });

    expect(updateFinancingCost).toHaveBeenCalledWith('12_cuotas', {
      costo: 0.2,
    });
  });

  it('crea una modalidad nueva con el nombre normalizado', async () => {
    const createFinancingCost = jest.fn().mockResolvedValue(null);
    const costs = build(jest.fn().mockResolvedValue([]), {
      createFinancingCost,
    });

    await costs.create({
      modalidad: '18 Cuotas',
      etiqueta: '18 cuotas',
      costo: 0.28,
    });

    expect(createFinancingCost).toHaveBeenCalledWith({
      modalidad: '18_cuotas',
      etiqueta: '18 cuotas',
      costo: 0.28,
    });
  });
});

describe('costo y coeficiente', () => {
  it('son el mismo dato ida y vuelta', () => {
    // 21,6% de costo es un coeficiente de 1,2755, y al revés.
    expect(costToFactor(0.216)).toBeCloseTo(1.2755, 4);
    expect(factorToCost(1.2755)).toBeCloseTo(0.216, 4);
    expect(factorToCost(costToFactor(0.089))).toBeCloseTo(0.089, 4);
    expect(factorToCost(1)).toBe(0);
  });

  it('el panel puede editar el coeficiente y se guarda el costo', async () => {
    const updateFinancingCost = jest.fn().mockResolvedValue(null);
    const costs = build(jest.fn().mockResolvedValue([]), {
      updateFinancingCost,
    });

    await costs.update('12_cuotas', { coeficiente: 1.2987 });

    // Se guarda el costo y no las dos columnas: dos versiones del mismo dato
    // se pueden contradecir.
    expect(updateFinancingCost).toHaveBeenCalledWith('12_cuotas', {
      costo: 0.23,
    });
  });

  it('rechaza mandar los dos a la vez', async () => {
    const costs = build(jest.fn().mockResolvedValue([]), {
      updateFinancingCost: jest.fn(),
    });

    await expect(
      costs.update('12_cuotas', { costo: 0.23, coeficiente: 1.5 }),
    ).rejects.toThrow(/no los dos/);
  });

  it('rechaza un coeficiente imposible', async () => {
    const costs = build(jest.fn().mockResolvedValue([]), {
      updateFinancingCost: jest.fn(),
    });

    // Menor a 1 seria regalar plata; mayor a 2 pasa el tope de costo de 0,5.
    await expect(
      costs.update('12_cuotas', { coeficiente: 0.8 }),
    ).rejects.toThrow(/entre 1 y 2/);
    await expect(
      costs.update('12_cuotas', { coeficiente: 12.755 }),
    ).rejects.toThrow(/entre 1 y 2/);
  });
});

describe('campaña de cuotas', () => {
  it('traduce la modalidad al vocabulario de ML', async () => {
    const costs = build(jest.fn().mockResolvedValue([]));

    expect(await costs.campaignFor('12_cuotas')).toBe('12x_campaign');
    expect(await costs.campaignFor('x3')).toBe('3x_campaign');
    expect(await costs.campaignFor('cuota_promocionada')).toBe('pcj-co-funded');
  });

  it('el contado no lleva campaña: es la ausencia del término de venta', async () => {
    const costs = build(jest.fn().mockResolvedValue([]));

    expect(await costs.campaignFor('contado')).toBeNull();
    expect(await costs.campaignFor(null)).toBeNull();
  });

  it('lo que diga internal-api manda sobre el vocabulario del código', async () => {
    const costs = build(
      jest.fn().mockResolvedValue([
        {
          modalidad: '12_cuotas',
          etiqueta: '12 cuotas',
          costo: 0.216,
          activa: true,
          campaign: '12x_campaign_v2',
        },
      ]),
    );

    expect(await costs.campaignFor('12_cuotas')).toBe('12x_campaign_v2');
  });

  it('una modalidad nueva sin campaña cargada no inventa una', async () => {
    const costs = build(
      jest
        .fn()
        .mockResolvedValue([
          { modalidad: '18_cuotas', etiqueta: '18', costo: 0.28, activa: true },
        ]),
    );

    expect(await costs.campaignFor('18_cuotas')).toBeNull();
  });
});
