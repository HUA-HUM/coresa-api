import {
  canonicalModalidad,
  priceFactorFor,
  variantPrice,
  variantStock,
} from './PublicationVariant';

describe('PublicationVariant', () => {
  describe('priceFactorFor', () => {
    it('divide por (1 - costo), no multiplica por (1 + costo)', () => {
      // El costo de la financiación se lo lleva ML del precio de venta. Para
      // que queden los mismos pesos en la mano hay que dividir: en 12 cuotas
      // multiplicar por 1,216 dejaría casi seis puntos abajo.
      expect(priceFactorFor('12_cuotas')).toBeCloseTo(1 / 0.784, 6);
      expect(priceFactorFor('12_cuotas')).toBeGreaterThan(1.216);
    });

    it('conoce las cinco modalidades y el contado', () => {
      expect(priceFactorFor('contado')).toBe(1);
      expect(priceFactorFor('cuota_promocionada')).toBeCloseTo(1 / 0.95, 6);
      expect(priceFactorFor('3_cuotas')).toBeCloseTo(1 / 0.911, 6);
      expect(priceFactorFor('6_cuotas')).toBeCloseTo(1 / 0.866, 6);
      expect(priceFactorFor('9_cuotas')).toBeCloseTo(1 / 0.822, 6);
    });

    it('sin modalidad es contado', () => {
      expect(priceFactorFor(null)).toBe(1);
      expect(priceFactorFor('')).toBe(1);
    });

    it('devuelve null si no conoce la modalidad', () => {
      expect(priceFactorFor('24_cuotas')).toBeNull();
    });
  });

  describe('canonicalModalidad', () => {
    it('resuelve los nombres cortos del panel', () => {
      expect(canonicalModalidad('x12')).toBe('12_cuotas');
      expect(canonicalModalidad('Promocionada')).toBe('cuota_promocionada');
      expect(canonicalModalidad(' 6 ')).toBe('6_cuotas');
    });
  });

  describe('variantPrice', () => {
    it('cotiza el ejemplo de Coresa en sus cuatro pasos', () => {
      // USD 100 de lista, 50% de descuento, IVA 21%, 65% de margen, dólar
      // 1000: ((100 - 50%) x 1,21) x 1,65 = 99,825 -> $99.825.
      const base = 99825;

      expect(
        variantPrice(base, 1, {
          listingType: 'gold_special',
          unitsPerListing: 1,
          modalidad: 'contado',
          priceFactor: 1,
        }),
      ).toBe(99825);

      // La misma máquina en cuota promocionada: 99.825 / 0,95.
      expect(
        variantPrice(base, 1, {
          listingType: 'gold_special',
          unitsPerListing: 1,
          modalidad: 'cuota_promocionada',
          priceFactor: priceFactorFor('cuota_promocionada') as number,
        }),
      ).toBe(105079);

      // Y en 12 cuotas: 99.825 / 0,784.
      expect(
        variantPrice(base, 1, {
          listingType: 'gold_special',
          unitsPerListing: 1,
          modalidad: '12_cuotas',
          priceFactor: priceFactorFor('12_cuotas') as number,
        }),
      ).toBe(127328);
    });

    it('divide el precio del empaque de Coresa antes de multiplicar', () => {
      // Coresa cotiza la caja de 100 a 919209; la publicación vende de a 6 en
      // 6 cuotas: (919209 / 100) x 6 / 0,866.
      expect(
        variantPrice(919209, 100, {
          listingType: 'gold_pro',
          unitsPerListing: 6,
          modalidad: '6_cuotas',
          priceFactor: priceFactorFor('6_cuotas') as number,
        }),
      ).toBe(63687);
    });
  });

  describe('variantStock', () => {
    it('un pack de 6 tiene la sexta parte del stock', () => {
      expect(variantStock(250, 6)).toBe(41);
      expect(variantStock(250, 1)).toBe(250);
    });
  });
});
