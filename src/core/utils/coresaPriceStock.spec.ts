import {
  calculateCoresaPriceArs,
  DEFAULT_DISCOUNT_PERCENT,
  formulaForBrand,
  FORMULA_1_MARGIN,
  FORMULA_2_MARGIN,
  FORMULA_3_MARGIN,
  getDiscountPercent,
  marginForFormula,
  parseIvaRate,
  priceCoresaProduct,
  toNumber,
  totalStock,
} from './coresaPriceStock';

describe('coresaPriceStock', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('toNumber', () => {
    it('parsea formatos ES y vacíos como el script', () => {
      expect(toNumber('1.234,56')).toBe(1234.56);
      expect(toNumber('123,45')).toBe(123.45);
      expect(toNumber('1234.56')).toBe(1234.56);
      expect(toNumber('$ 100')).toBe(100);
      expect(toNumber('')).toBe(0);
      expect(toNumber(null)).toBe(0);
      expect(toNumber(12)).toBe(12);
    });
  });

  describe('parseIvaRate', () => {
    it('acepta IVA_21 e IVA_10.5', () => {
      expect(parseIvaRate('IVA_21')).toBe(0.21);
      expect(parseIvaRate('iva_10,5')).toBe(0.105);
      expect(parseIvaRate('IVA_27')).toBeNull();
      expect(parseIvaRate('')).toBeNull();
    });
  });

  describe('formulaForBrand', () => {
    it('usa fórmula 1 si la marca está en esa lista, aunque también esté en otra', () => {
      expect(formulaForBrand('Jadever')).toBe(1);
      expect(formulaForBrand(' chint ')).toBe(1);
      expect(formulaForBrand('MACROLED')).toBe(1);
      expect(formulaForBrand('uniview')).toBe(1);
      expect(marginForFormula(1)).toBe(FORMULA_1_MARGIN);
    });

    // Aparecieron en el feed de Coresa en noviembre de 2026: 316 productos de
    // FORLI, 96 de RONIN y 52 de NOAK que el sync salteaba por no tener
    // margen asignado, asi que no llegaban al publicador.
    it('cotiza las marcas nuevas: FORLI, RONIN y NOAK', () => {
      expect(formulaForBrand('FORLI')).toBe(1);
      expect(formulaForBrand(' ronin ')).toBe(1);
      expect(formulaForBrand('Noak')).toBe(1);
    });

    it('deja la fórmula 2 mapeada y aplica la 3 solo a Wadermuller', () => {
      expect(marginForFormula(2)).toBe(FORMULA_2_MARGIN);
      expect(formulaForBrand('Weidmuller')).toBe(3);
      expect(marginForFormula(3)).toBe(FORMULA_3_MARGIN);
      expect(formulaForBrand('Otra')).toBeNull();
      expect(formulaForBrand('')).toBeNull();
    });
  });

  // El margen lo define comercial, no el codigo, y puede cambiar despues de
  // ver los primeros precios. Sin esto, cada correccion es una release.
  describe('formulaForBrand con CORESA_BRAND_FORMULAS', () => {
    beforeEach(() => {
      process.env = { ...originalEnv };
      delete process.env.CORESA_BRAND_FORMULAS;
    });

    it('el override le gana a la lista compilada', () => {
      process.env.CORESA_BRAND_FORMULAS = 'FORLI:3';

      expect(formulaForBrand('FORLI')).toBe(3);
      expect(marginForFormula(formulaForBrand('FORLI')!)).toBe(
        FORMULA_3_MARGIN,
      );
      // Las demas no se tocan.
      expect(formulaForBrand('RONIN')).toBe(1);
    });

    it('acepta varias marcas y no distingue mayusculas ni espacios', () => {
      process.env.CORESA_BRAND_FORMULAS = ' forli:3 , noak:2 ';

      expect(formulaForBrand('FORLI')).toBe(3);
      expect(formulaForBrand('NOAK')).toBe(2);
    });

    it('da de alta una marca que no esta en ninguna lista', () => {
      process.env.CORESA_BRAND_FORMULAS = 'MARCANUEVA:1';

      expect(formulaForBrand('MarcaNueva')).toBe(1);
    });

    it('una entrada mal escrita se ignora y el resto sigue valiendo', () => {
      process.env.CORESA_BRAND_FORMULAS = 'FORLI:9,NOAK:,:2,RONIN:3';

      // Formula invalida: cae en su lista compilada.
      expect(formulaForBrand('FORLI')).toBe(1);
      expect(formulaForBrand('NOAK')).toBe(1);
      // La entrada valida del final igual se aplica.
      expect(formulaForBrand('RONIN')).toBe(3);
    });

    it('sin la variable, todo queda como esta compilado', () => {
      expect(formulaForBrand('FORLI')).toBe(1);
      expect(formulaForBrand('WEIDMULLER')).toBe(3);
      expect(formulaForBrand('Otra')).toBeNull();
    });
  });

  describe('calculateCoresaPriceArs', () => {
    it('aplica pack, pesos, 50%, IVA y margen 65%', () => {
      // 10 * 100 * 1000 * 0.5 * 1.21 * 1.65 = 998250
      expect(calculateCoresaPriceArs(10, 100, 1000, 0.21, 0.65, 50)).toBe(
        998250,
      );
    });

    it('trata CantIntermedia vacía como 1 y usa descuento default', () => {
      // 100 * 1 * 1000 * 0.5 * 1.21 * 1.65 = 99825
      expect(calculateCoresaPriceArs(100, 0, 1000, 0.21, 0.65)).toBe(99825);
      expect(
        calculateCoresaPriceArs(100, '', 1000, 0.21, FORMULA_3_MARGIN, 50),
      ).toBe(Math.round(100 * 1000 * 0.5 * 1.21 * 1.5));
    });

    it('devuelve null si el USD lista o BNA no son > 0', () => {
      expect(calculateCoresaPriceArs(0, 1, 1000, 0.21, 0.65)).toBeNull();
      expect(
        calculateCoresaPriceArs('no encontrado', 1, 1000, 0.21, 0.65),
      ).toBeNull();
      expect(calculateCoresaPriceArs(100, 1, 0, 0.21, 0.65)).toBeNull();
    });
  });

  describe('totalStock', () => {
    it('guarda el stock total sin dividir por CantIntermedia', () => {
      expect(totalStock(12.9)).toBe(12);
      expect(totalStock('100')).toBe(100);
      expect(totalStock('')).toBe(0);
    });
  });

  describe('priceCoresaProduct', () => {
    it('guarda el precio final en Precio_Convertido y deja lista y moneda de Coresa', () => {
      const priced = priceCoresaProduct(
        {
          SKU: ' B0 ',
          Marca: 'Jadever',
          Impuestos: 'IVA_21',
          Precio_Lista_1: 10,
          Moneda: 'USD',
          CantIntermedia: 100,
          Disponible: 250,
          Descripcion: 'Pack',
        },
        1000,
        50,
      );

      expect(priced).toEqual({
        SKU: 'B0',
        Marca: 'Jadever',
        Impuestos: 'IVA_21',
        Precio_Lista_1: 10,
        Precio_Convertido: 998250,
        // El precio se compone sobre el empaque, así que queda anotado a
        // cuántas unidades corresponde: sin esto no hay precio unitario.
        base_units: 100,
        Moneda: 'USD',
        CantIntermedia: 100,
        Disponible: 250,
        Descripcion: 'Pack',
      });
    });

    it('omite sin SKU, sin IVA, sin fórmula o sin precio', () => {
      const base = {
        SKU: 'A',
        Marca: 'Jadever',
        Impuestos: 'IVA_21',
        Precio_Lista_1: 10,
        CantIntermedia: 1,
      };
      expect(priceCoresaProduct({ ...base, SKU: ' ' }, 1000)).toBeNull();
      expect(
        priceCoresaProduct({ ...base, Impuestos: 'IVA_27' }, 1000),
      ).toBeNull();
      expect(priceCoresaProduct({ ...base, Marca: 'Otra' }, 1000)).toBeNull();
      expect(
        priceCoresaProduct({ ...base, Precio_Lista_1: 0 }, 1000),
      ).toBeNull();
    });
  });

  describe('env helpers', () => {
    it('lee descuento con default 50', () => {
      process.env = { ...originalEnv };
      delete process.env.CORESA_PRICE_DISCOUNT_PERCENT;
      expect(getDiscountPercent()).toBe(DEFAULT_DISCOUNT_PERCENT);

      process.env.CORESA_PRICE_DISCOUNT_PERCENT = '40';
      expect(getDiscountPercent()).toBe(40);
    });
  });
});
